import { createHash, randomUUID } from 'node:crypto';
import type {
  SearchFilterOptions,
  SearchMode,
  SearchProviderHealth,
  SearchResponse,
  SearchSuggestion
} from '@shared/types';
import type { MetricsRegistry } from '../../observability/metrics';
import type { UserDataService } from '../userdata/user-data-service';
import type { AtlasKnowledgeSearchAdapter } from './adapters';
import { SearchCache } from './cache';
import { CitationAnswerPipeline, type ApprovedPageContextInput } from './citation-pipeline';
import type { RawSearchCandidate, SearchProvider } from './provider';
import { QueryUnderstandingEngine } from './query-understanding';
import { SearchRankingPipeline } from './ranking';

export interface AuthorizedTabContext extends ApprovedPageContextInput {
  tabId: string;
  isPrivate: boolean;
}

export interface SearchExecuteInput {
  query: string;
  mode?: SearchMode;
  filters?: SearchFilterOptions;
  userId?: string | null;
  profileId?: string | null;
  isPrivateSession?: boolean;
  authorizedTabs?: AuthorizedTabContext[];
  enableRerank?: boolean;
  fetchFullPagesForCitations?: boolean;
  allowLocalhostForTest?: boolean;
  signal?: AbortSignal;
}

export class SearchOrchestrator {
  private readonly ranking = new SearchRankingPipeline();

  constructor(
    private readonly providers: SearchProvider[],
    private readonly knowledgeAdapter: AtlasKnowledgeSearchAdapter | null,
    private readonly queryUnderstanding: QueryUnderstandingEngine,
    private readonly citationPipeline: CitationAnswerPipeline,
    private readonly cache: SearchCache,
    private readonly userData: UserDataService,
    private readonly metrics: MetricsRegistry,
    private readonly cacheTtlSeconds = 180
  ) {}

  public async executeSearch(input: SearchExecuteInput): Promise<SearchResponse> {
    const requestId = randomUUID();
    const started = Date.now();
    const limit = Math.min(30, Math.max(1, input.filters?.limit ?? 10));

    // 1. Understand query (deterministic always available; optional LLM only if enabled)
    const understanding = await this.queryUnderstanding.understand(input.query, input.mode, false);
    const activeMode = input.mode ?? understanding.recommendedMode;

    // 2. Cache check (never serve cached personal/tab queries across users or when tabs supplied)
    const hasPersonalScope =
      Boolean(input.authorizedTabs?.length) ||
      activeMode === 'current_page' ||
      activeMode === 'cross_tab' ||
      activeMode === 'personal_knowledge';

    const cacheKey = createHash('sha256')
      .update(
        JSON.stringify({
          q: understanding.normalizedQuery,
          mode: activeMode,
          filters: input.filters || {},
          ai: Boolean(input.filters?.includeAiAnswer)
        })
      )
      .digest('hex');

    if (!hasPersonalScope && !input.isPrivateSession) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        const latencyMs = Date.now() - started;
        this.metrics.recordSearch(latencyMs, true);
        return { ...cached, requestId, cacheHit: true, latencyMs };
      }
    }

    // 3. Parallel retrieval across eligible providers + authorized local/knowledge sources
    const providersQueried: string[] = [];
    const providerErrors: Array<{ providerId: string; error: string }> = [];
    const allCandidates: RawSearchCandidate[] = [];

    const tasks: Array<Promise<void>> = [];

    // 3a. Open authorized non-private tabs (never include private tabs!)
    const nonPrivateTabs = (input.authorizedTabs ?? []).filter((t) => !t.isPrivate);
    if (
      nonPrivateTabs.length > 0 &&
      (activeMode === 'current_page' || activeMode === 'cross_tab' || input.filters?.includeOpenTabs)
    ) {
      providersQueried.push('open_tabs');
      for (const tab of nonPrivateTabs) {
        allCandidates.push({
          title: tab.title || tab.url,
          url: tab.url,
          snippet: tab.text.slice(0, 320),
          sourceProvider: 'open_tabs',
          contentType: 'tab',
          rawRank: 1
        });
      }
    }

    // 3b. Authorized user personal hybrid knowledge (if authenticated & not private session)
    if (
      this.knowledgeAdapter &&
      input.userId &&
      input.profileId &&
      !input.isPrivateSession &&
      (activeMode === 'personal_knowledge' ||
        activeMode === 'research' ||
        input.filters?.includePersonalKnowledge)
    ) {
      providersQueried.push(this.knowledgeAdapter.id);
      tasks.push(
        this.knowledgeAdapter
          .searchForUser({
            userId: input.userId,
            profileId: input.profileId,
            query: understanding.originalQuery,
            limit
          })
          .then((res) => {
            allCandidates.push(...res);
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            providerErrors.push({ providerId: this.knowledgeAdapter!.id, error: msg });
          })
      );
    }

    // 3c. Configured external search providers (unless strictly tab/knowledge-only mode)
    const needWebProviders = !['current_page', 'cross_tab', 'personal_knowledge'].includes(activeMode);
    if (needWebProviders) {
      for (const provider of this.providers) {
        if (!provider.isConfigured() || !provider.supportsMode(activeMode)) continue;
        providersQueried.push(provider.id);
        tasks.push(
          provider
            .search({
              query: understanding.rewrittenQueries[0] || understanding.originalQuery,
              mode: activeMode,
              filters: input.filters,
              limit: Math.min(20, limit * 2),
              signal: input.signal
            })
            .then((items) => {
              allCandidates.push(...items);
            })
            .catch((err) => {
              this.metrics.recordProviderError(provider.id);
              providerErrors.push({
                providerId: provider.id,
                error: err instanceof Error ? err.message : String(err)
              });
            })
        );
      }
    }

    await Promise.all(tasks);

    // 4. Normalize, deduplicate, and rank
    const ranked = this.ranking.normalizeAndRank({
      candidates: allCandidates,
      understanding,
      filters: input.filters
    });

    // 5. Optional reranking over retrieved candidates (strictly bounded)
    let finalResults = ranked.results;
    let reranked = false;
    if (input.enableRerank !== false && finalResults.length > 1) {
      const rr = await this.ranking.rerankCandidates(understanding.originalQuery, finalResults, 250);
      finalResults = rr.results;
      reranked = rr.reranked;
    }

    const boundedResults = finalResults.slice(0, limit);

    // 6. Optional AI Answer with Verified Citations (degrades gracefully if unavailable/fails)
    const shouldGenerateAi =
      input.filters?.includeAiAnswer !== false &&
      (activeMode === 'research' || input.filters?.includeAiAnswer === true) &&
      boundedResults.length > 0;

    const aiAnswer = shouldGenerateAi
      ? await this.citationPipeline.answerWithCitations({
          query: understanding.originalQuery,
          candidates: boundedResults,
          approvedTabContexts: nonPrivateTabs,
          fetchFullPages: input.fetchFullPagesForCitations,
          allowLocalhostForTest: input.allowLocalhostForTest
        })
      : null;

    // 7. Suggestions & Related Queries
    const relatedQueries = [
      `${understanding.normalizedQuery} official documentation`,
      `${understanding.normalizedQuery} vs alternatives`,
      ...(understanding.entities[0] ? [`${understanding.entities[0]} architecture security`] : [])
    ].slice(0, 4);

    const suggestions: SearchSuggestion[] = [
      ...understanding.rewrittenQueries
        .filter((q) => q !== input.query)
        .map((q) => ({ text: q, kind: 'refinement' as const })),
      ...relatedQueries.slice(0, 2).map((q) => ({ text: q, kind: 'related' as const }))
    ];

    // 8. Record search history ONLY if user consented and session is not private
    if (input.userId && input.profileId && !input.isPrivateSession) {
      await this.userData.maybeRecordSearchHistory({
        userId: input.userId,
        profileId: input.profileId,
        query: input.query,
        mode: activeMode,
        resultCount: boundedResults.length,
        isPrivate: input.isPrivateSession
      });
    }

    const latencyMs = Date.now() - started;
    this.metrics.recordSearch(latencyMs, false);

    const response: SearchResponse = {
      requestId,
      query: input.query,
      mode: activeMode,
      understanding,
      results: boundedResults,
      totalBeforeDedup: ranked.totalBeforeDedup,
      duplicatesRemoved: ranked.duplicatesRemoved,
      suggestions,
      relatedQueries,
      aiAnswer,
      providersQueried,
      providerErrors,
      cacheHit: false,
      reranked,
      latencyMs,
      sourceMode: 'cloud'
    };

    if (!hasPersonalScope && !input.isPrivateSession && boundedResults.length > 0) {
      await this.cache.set(cacheKey, response, this.cacheTtlSeconds);
    }

    return response;
  }

  public async getProviderHealth(): Promise<SearchProviderHealth[]> {
    const list: SearchProviderHealth[] = [];
    for (const p of this.providers) {
      list.push(await p.healthCheck());
    }
    if (this.knowledgeAdapter) {
      list.push(await this.knowledgeAdapter.healthCheck());
    }
    return list;
  }
}

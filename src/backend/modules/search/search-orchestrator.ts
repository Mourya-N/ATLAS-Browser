import { createHash, randomUUID } from 'node:crypto';
import type {
  LavrayIndexStats,
  SearchFilterOptions,
  SearchMode,
  SearchProviderHealth,
  SearchResponse,
  SearchSuggestion,
  SelfHostedRuntimeStatus
} from '@shared/types';
import type { MetricsRegistry } from '../../observability/metrics';
import type { UserDataService } from '../userdata/user-data-service';
import type { LavrayKnowledgeSearchAdapter } from './adapters';
import { SearchCache } from './cache';
import { CitationAnswerPipeline, type ApprovedPageContextInput } from './citation-pipeline';
import type { FirstPartyIndexProvider } from './first-party-index-provider';
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
  private readonly inflightSearches = new Map<string, Promise<SearchResponse>>();

  constructor(
    private readonly providers: SearchProvider[],
    private readonly knowledgeAdapter: LavrayKnowledgeSearchAdapter | null,
    private readonly queryUnderstanding: QueryUnderstandingEngine,
    private readonly citationPipeline: CitationAnswerPipeline,
    private readonly cache: SearchCache,
    private readonly userData: UserDataService,
    private readonly metrics: MetricsRegistry,
    private readonly cacheTtlSeconds = 180,
    private readonly firstPartyIndex?: FirstPartyIndexProvider | null,
    private readonly getAiStatus?: () => Promise<SelfHostedRuntimeStatus>
  ) {}

  public async executeSearch(input: SearchExecuteInput): Promise<SearchResponse> {
    const requestId = randomUUID();
    const started = Date.now();
    const limit = Math.min(30, Math.max(1, input.filters?.limit ?? 10));
    const page = Math.max(1, input.filters?.page ?? 1);

    // 1. Understand query (deterministic always available; optional LLM only if enabled)
    const understanding = await this.queryUnderstanding.understand(input.query, input.mode, false);
    const activeMode = input.mode ?? understanding.recommendedMode;

    // 2. Cache check (never serve cached personal/tab queries across users or when tabs supplied)
    const hasPersonalScope =
      Boolean(input.authorizedTabs?.length) ||
      activeMode === 'current_page' ||
      activeMode === 'cross_tab' ||
      activeMode === 'personal_knowledge';

    const resultCacheKey = createHash('sha256')
      .update(
        JSON.stringify({
          q: understanding.normalizedQuery,
          mode: activeMode,
          page,
          filters: { ...(input.filters || {}), includeAiAnswer: undefined }
        })
      )
      .digest('hex');

    const aiCacheKey = `${resultCacheKey}:ai`;
    const wantAi =
      input.filters?.includeAiAnswer !== false &&
      (activeMode === 'research' || input.filters?.includeAiAnswer === true);

    if (!hasPersonalScope && !input.isPrivateSession) {
      const cached = await this.cache.get(resultCacheKey);
      if (cached) {
        let aiAnswer = cached.aiAnswer;
        if (wantAi && !aiAnswer && cached.results.length > 0) {
          aiAnswer = await this.cache.getAiAnswer(aiCacheKey);
          if (!aiAnswer) {
            aiAnswer = await this.citationPipeline.answerWithCitations({
              query: understanding.originalQuery,
              candidates: cached.results,
              intent: understanding.intent,
              approvedTabContexts: [],
              fetchFullPages: input.fetchFullPagesForCitations,
              allowLocalhostForTest: input.allowLocalhostForTest
            });
            await this.cache.setAiAnswer(aiCacheKey, aiAnswer, 300);
          }
        }
        const latencyMs = Date.now() - started;
        this.metrics.recordSearch(latencyMs, true);
        return {
          ...cached,
          aiAnswer: wantAi ? aiAnswer : null,
          requestId,
          cacheHit: true,
          latencyMs
        };
      }

      const inflightKey = `${resultCacheKey}:${wantAi ? '1' : '0'}`;
      const existingInflight = this.inflightSearches.get(inflightKey);
      if (existingInflight && !input.signal) {
        return existingInflight;
      }
    }

    const runPipeline = async (): Promise<SearchResponse> => {
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
        filters: input.filters,
        allowLocalTestUrls: Boolean(input.allowLocalhostForTest)
      });

      // 5. Optional reranking over retrieved candidates (strictly bounded)
      let finalResults = ranked.results;
      let reranked = false;
      if (input.enableRerank !== false && finalResults.length > 1) {
        const rr = await this.ranking.rerankCandidates(understanding.originalQuery, finalResults, 200, understanding);
        finalResults = rr.results;
        reranked = rr.reranked;
      }

      const totalResults = finalResults.length;
      const totalPages = Math.max(1, Math.ceil(totalResults / limit));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * limit;
      const boundedResults = finalResults.slice(offset, offset + limit);

      // 6. Optional AI Answer with Verified Citations (degrades gracefully if unavailable/fails)
      const shouldGenerateAi = wantAi && boundedResults.length > 0;

      const aiAnswer = shouldGenerateAi
        ? await this.citationPipeline.answerWithCitations({
            query: understanding.originalQuery,
            candidates: boundedResults,
            intent: understanding.intent,
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

      const indexStats: LavrayIndexStats = this.firstPartyIndex
        ? await this.firstPartyIndex.getStats()
        : {
            totalDocuments: 0,
            uniqueDomains: 0,
            latestCrawlAt: null,
            indexVersion: 'v1',
            limitedCoverage: true,
            notice: 'First-party LAVRAY index not attached to this search instance.'
          };
      const aiRuntimeStatus = this.getAiStatus ? await this.getAiStatus() : undefined;

      const latencyMs = Date.now() - started;
      this.metrics.recordSearch(latencyMs, false);

      const response: SearchResponse = {
        requestId,
        query: input.query,
        mode: activeMode,
        understanding,
        results: boundedResults,
        pagination: {
          page: safePage,
          limit,
          totalResults,
          totalPages,
          hasMore: safePage < totalPages
        },
        totalBeforeDedup: ranked.totalBeforeDedup,
        duplicatesRemoved: ranked.duplicatesRemoved,
        suggestions,
        relatedQueries,
        aiAnswer,
        providersQueried,
        providerErrors,
        indexStatus: {
          indexedDocuments: indexStats.totalDocuments,
          limitedCoverage: indexStats.limitedCoverage,
          notice: indexStats.notice
        },
        aiRuntimeStatus,
        cacheHit: false,
        reranked,
        latencyMs,
        sourceMode: 'cloud'
      };

      if (!hasPersonalScope && !input.isPrivateSession && boundedResults.length > 0) {
        const dynamicTtl =
          understanding.temporalIntent.hasTemporalConstraint || activeMode === 'news'
            ? 30
            : activeMode === 'docs'
            ? 300
            : this.cacheTtlSeconds;
        await this.cache.set(resultCacheKey, { ...response, aiAnswer: null }, dynamicTtl);
        if (aiAnswer) {
          await this.cache.setAiAnswer(aiCacheKey, aiAnswer, 300);
        }
      }

      return response;
    };

    const inflightKey = `${resultCacheKey}:${wantAi ? '1' : '0'}`;
    if (!hasPersonalScope && !input.isPrivateSession && !input.signal) {
      const promise = runPipeline().finally(() => {
        this.inflightSearches.delete(inflightKey);
      });
      this.inflightSearches.set(inflightKey, promise);
      return promise;
    }

    return runPipeline();
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

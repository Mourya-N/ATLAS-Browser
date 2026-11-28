import { randomUUID } from 'node:crypto';
import type {
  AiCitedAnswer,
  LavrayIndexStats,
  CloudAuthSession,
  CloudConnectionStatus,
  CloudConsentSettings,
  CloudNoteRecord,
  CloudSearchHistoryRecord,
  CrawlCheckpoint,
  CrawlSeedConfig,
  SearchFilterOptions,
  SearchMode,
  SearchResponse,
  SearchSuggestion,
  SelfHostedRuntimeStatus
} from '@shared/types';
import { DEFAULT_CLOUD_CONSENT } from '@shared/types';
import type { AgentRepository } from '@main/db/repositories/agent-repo';
import type { BrowserRepository } from '@main/db/repositories/browser-repo';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import type { TabManager } from '@main/browser/tab-manager';
import type { PerceptionEngine } from '@main/cdp/perception';
import type { MemoryService } from '@main/memory/memory-service';
import type { SecretVault } from '@main/security/secrets';
import type { AuditLogger } from '@main/security/audit-logger';
import type { ModelProvider } from '@main/agent/providers/model-provider';
import type { SelfHostedOpenAiProvider } from '@main/agent/providers/self-hosted-provider';
import type { LocalSearchIndexService } from './local-search-index';
import { QueryUnderstandingEngine } from '../../backend/modules/search/query-understanding';
import { SearchRankingPipeline } from '../../backend/modules/search/ranking';
import type { RawSearchCandidate } from '../../backend/modules/search/provider';
import { InjectionGuard } from '@main/security/injection-guard';

export class CloudClientService {
  private readonly queryUnderstanding = new QueryUnderstandingEngine();
  private readonly ranking = new SearchRankingPipeline();
  private readonly injectionGuard = new InjectionGuard();
  private lastSyncedAt: number | null = null;
  private lastError: string | null = null;
  private cachedUserEmail: string | null = null;
  private cachedProfileId: string | null = null;

  constructor(
    private readonly platformRepo: PlatformRepository,
    private readonly browserRepo: BrowserRepository,
    private readonly agentRepo: AgentRepository,
    private readonly tabManager: TabManager,
    private readonly perception: PerceptionEngine,
    private readonly memoryService: MemoryService,
    private readonly vault: SecretVault,
    private readonly auditLogger: AuditLogger,
    private readonly getLocalModelProvider: () => ModelProvider,
    private readonly localIndex?: LocalSearchIndexService,
    private readonly selfHostedProvider?: SelfHostedOpenAiProvider
  ) {}

  public isCloudEnabled(): boolean {
    return this.platformRepo.getSetting<boolean>('cloud.enabled', false);
  }

  public getEndpointUrl(): string {
    return this.platformRepo.getSetting<string>('cloud.endpointUrl', 'http://127.0.0.1:48080');
  }

  public getConsent(): CloudConsentSettings {
    return {
      ...DEFAULT_CLOUD_CONSENT,
      ...this.platformRepo.getSetting<Partial<CloudConsentSettings>>('cloud.consent', DEFAULT_CLOUD_CONSENT)
    };
  }

  public async getStatus(): Promise<CloudConnectionStatus> {
    const cloudEnabled = this.isCloudEnabled();
    const cloudEndpointUrl = this.getEndpointUrl();
    const consent = this.getConsent();
    const tokens = this.vault.getCloudTokens();

    if (!cloudEnabled) {
      return {
        cloudEnabled: false,
        cloudEndpointUrl,
        reachable: false,
        authenticated: Boolean(tokens.accessToken),
        operatingMode: 'local_only',
        userEmail: this.cachedUserEmail,
        profileId: this.cachedProfileId,
        lastSyncedAt: this.lastSyncedAt,
        lastError: null,
        consent
      };
    }

    let reachable = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const res = await fetch(`${cloudEndpointUrl}/api/v1/health`, { signal: controller.signal });
      clearTimeout(timer);
      reachable = res.ok;
      if (!res.ok) this.lastError = `Cloud health HTTP ${res.status}`;
      else this.lastError = null;
    } catch (err) {
      reachable = false;
      this.lastError = err instanceof Error ? err.message : 'Cloud backend unreachable';
    }

    const authenticated = Boolean(tokens.accessToken);
    const operatingMode: CloudConnectionStatus['operatingMode'] =
      reachable && authenticated ? 'cloud_connected' : reachable ? 'cloud_degraded' : 'cloud_degraded';

    return {
      cloudEnabled,
      cloudEndpointUrl,
      reachable,
      authenticated,
      operatingMode,
      userEmail: this.cachedUserEmail,
      profileId: this.cachedProfileId,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
      consent
    };
  }

  public async register(input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<CloudConnectionStatus> {
    const endpoint = this.getEndpointUrl();
    const res = await fetch(`${endpoint}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        deviceName: process.env.HOSTNAME || 'LAVRAY Desktop',
        platform: process.platform,
        appVersion: '1.0.0'
      })
    });
    const body = (await res.json()) as CloudAuthSession & { error?: string };
    if (!res.ok) throw new Error(body.error || `Registration failed (${res.status})`);
    this.vault.setCloudTokens(body.accessToken, body.refreshToken);
    this.cachedUserEmail = body.user.email;
    this.cachedProfileId = body.profile.id;
    this.platformRepo.setSetting('cloud.enabled', true);
    this.auditLogger.log({
      category: 'security',
      action: 'cloud_account_registered',
      actor: 'user',
      details: { endpoint }
    });
    return this.getStatus();
  }

  public async login(input: { email: string; password: string }): Promise<CloudConnectionStatus> {
    const endpoint = this.getEndpointUrl();
    const res = await fetch(`${endpoint}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        deviceName: process.env.HOSTNAME || 'LAVRAY Desktop',
        platform: process.platform,
        appVersion: '1.0.0'
      })
    });
    const body = (await res.json()) as CloudAuthSession & { error?: string };
    if (!res.ok) throw new Error(body.error || `Login failed (${res.status})`);
    this.vault.setCloudTokens(body.accessToken, body.refreshToken);
    this.cachedUserEmail = body.user.email;
    this.cachedProfileId = body.profile.id;
    this.platformRepo.setSetting('cloud.enabled', true);
    return this.getStatus();
  }

  public async logout(): Promise<CloudConnectionStatus> {
    const tokens = this.vault.getCloudTokens();
    if (tokens.refreshToken && this.isCloudEnabled()) {
      try {
        await fetch(`${this.getEndpointUrl()}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokens.refreshToken })
        });
      } catch {
        // Offline logout still clears local credentials
      }
    }
    this.vault.clearCloudTokens();
    this.cachedUserEmail = null;
    this.cachedProfileId = null;
    return this.getStatus();
  }

  public async updateConsent(patch: Partial<CloudConsentSettings>): Promise<CloudConnectionStatus> {
    const next: CloudConsentSettings = { ...this.getConsent(), ...patch };
    this.platformRepo.setSetting('cloud.consent', next);

    const tokens = this.vault.getCloudTokens();
    if (this.isCloudEnabled() && tokens.accessToken) {
      try {
        await this.authorizedFetch('/api/v1/profile/consent', {
          method: 'PUT',
          body: JSON.stringify(next)
        });
      } catch {
        // Local consent remains authoritative even offline
      }
    }
    return this.getStatus();
  }

  public async syncApprovedData(): Promise<{ synced: Record<string, number>; skipped: string[] }> {
    const consent = this.getConsent();
    const skipped: string[] = [];
    const synced: Record<string, number> = {};

    if (!this.isCloudEnabled()) {
      throw new Error('Enable LAVRAY Cloud mode before syncing');
    }

    // Bookmarks (only if explicit opt-in)
    if (consent.syncBookmarks) {
      const { bookmarks } = this.browserRepo.listBookmarks('');
      let count = 0;
      for (const bm of bookmarks.slice(0, 100)) {
        const res = await this.authorizedFetch('/api/v1/userdata/bookmarks', {
          method: 'POST',
          body: JSON.stringify({ id: bm.id, url: bm.url, title: bm.title, isPrivate: false })
        });
        if (res.ok) count += 1;
      }
      synced.bookmarks = count;
    } else {
      skipped.push('bookmarks (consent off)');
    }

    this.lastSyncedAt = Date.now();
    return { synced, skipped };
  }

  public async listNotes(): Promise<CloudNoteRecord[]> {
    if (!this.isCloudEnabled() || !this.vault.getCloudTokens().accessToken) return [];
    const res = await this.authorizedFetch('/api/v1/userdata/notes', { method: 'GET' });
    if (!res.ok) return [];
    const body = (await res.json()) as { notes?: CloudNoteRecord[] };
    return body.notes ?? [];
  }

  public async saveNote(input: {
    title: string;
    content: string;
    sourceUrl?: string | null;
    tags?: string[];
  }): Promise<CloudNoteRecord> {
    if (!this.getConsent().syncNotes) {
      throw new Error('Enable Cloud Notes sync consent in Settings before saving cloud notes');
    }
    const res = await this.authorizedFetch('/api/v1/userdata/notes', {
      method: 'POST',
      body: JSON.stringify({ ...input, isPrivate: false })
    });
    const body = (await res.json()) as { note?: CloudNoteRecord; error?: string };
    if (!res.ok || !body.note) throw new Error(body.error || 'Failed to save cloud note');
    return body.note;
  }

  public async exportCloudData(): Promise<string> {
    const res = await this.authorizedFetch('/api/v1/account/export', { method: 'GET' });
    const data = await res.json();
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Cloud export failed');
    return JSON.stringify(data, null, 2);
  }

  public async deleteAccountData(): Promise<CloudConnectionStatus> {
    const res = await this.authorizedFetch('/api/v1/account', { method: 'DELETE' });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error || 'Cloud account deletion failed');
    }
    this.vault.clearCloudTokens();
    this.cachedUserEmail = null;
    this.cachedProfileId = null;
    this.platformRepo.setSetting('cloud.enabled', false);
    this.platformRepo.setSetting('cloud.consent', { ...DEFAULT_CLOUD_CONSENT });
    return this.getStatus();
  }

  /**
   * Executes LAVRAY Intelligent Search:
   * - Uses cloud backend when enabled + consented + reachable.
   * - Automatically includes authorized non-private tabs & local knowledge when requested.
   * - Degrades seamlessly to local-first search & citation synthesis when cloud is off or unreachable.
   */
  public async executeSearch(params: {
    query: string;
    mode?: SearchMode;
    filters?: SearchFilterOptions;
    selectedTabIds?: string[];
  }): Promise<SearchResponse> {
    const started = Date.now();
    const consent = this.getConsent();
    const activeTabs = this.tabManager.getAllTabs().filter((t) => !t.isPrivate);
    const chosenTabs =
      params.selectedTabIds && params.selectedTabIds.length > 0
        ? activeTabs.filter((t) => params.selectedTabIds!.includes(t.id))
        : activeTabs;

    const authorizedTabContexts: Array<{
      tabId: string;
      url: string;
      title: string;
      text: string;
      isPrivate: boolean;
    }> = [];

    if (
      params.mode === 'current_page' ||
      params.mode === 'cross_tab' ||
      params.filters?.includeOpenTabs
    ) {
      for (const tab of chosenTabs.slice(0, 6)) {
        const wc = this.tabManager.getWebContents(tab.id);
        if (!wc || !tab.url || tab.url === 'about:blank') continue;
        try {
          const perc = await this.perception.capture(tab.id, wc, { includeAxTree: false });
          authorizedTabContexts.push({
            tabId: tab.id,
            url: perc.url,
            title: perc.title,
            text: perc.mainText.slice(0, 8000),
            isPrivate: false
          });
        } catch {
          // Skip unreadable tab
        }
      }
    }

    // Collect local desktop knowledge (first-party FTS5 index, bookmarks, memory, research)
    const localCandidates: RawSearchCandidate[] = [];
    if (this.localIndex && !['current_page', 'cross_tab'].includes(params.mode || '')) {
      const ftsHits = this.localIndex.searchLocalIndex(params.query, 10);
      localCandidates.push(...ftsHits);
    }
    const queryTokens = params.query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (params.mode === 'personal_knowledge' || params.filters?.includePersonalKnowledge !== false) {
      const { bookmarks } = this.browserRepo.listBookmarks('');
      const matchedBookmarks = bookmarks.filter((bm) => {
        const hay = `${bm.title} ${bm.url}`.toLowerCase();
        return queryTokens.length === 0 || queryTokens.some((t) => hay.includes(t));
      });
      for (const bm of matchedBookmarks.slice(0, 6)) {
        localCandidates.push({
          title: bm.title,
          url: bm.url,
          snippet: `Local bookmark (${bm.url})`,
          sourceProvider: 'local_bookmarks',
          contentType: 'bookmark',
          publishedAt: new Date(bm.updatedAt).toISOString(),
          rawRank: 2
        });
      }

      const mems = this.memoryService.retrieveRelevant(params.query, null, 5);
      for (const m of mems) {
        localCandidates.push({
          title: m.title,
          url: m.sourceUrl || `lavray://memory/${m.id}`,
          snippet: m.content.slice(0, 260),
          sourceProvider: 'local_memory',
          contentType: 'knowledge',
          publishedAt: new Date(m.lastUsedAt).toISOString(),
          rawRank: 1
        });
      }

      const reports = this.agentRepo.listResearchReports(15);
      for (const rep of reports) {
        if (rep.query.toLowerCase().includes(params.query.toLowerCase().split(' ')[0] || '')) {
          localCandidates.push({
            title: `Research: ${rep.query}`,
            url: rep.sources[0]?.url || `lavray://research/${rep.id}`,
            snippet: rep.summary.slice(0, 260),
            sourceProvider: 'local_research',
            contentType: 'research',
            publishedAt: new Date(rep.createdAt).toISOString(),
            rawRank: 2
          });
        }
      }
    }

    // Attempt cloud search if enabled + user explicitly opted into allowCloudSearch
    if (this.isCloudEnabled() && consent.allowCloudSearch) {
      try {
        const res = await this.authorizedFetch('/api/v1/search', {
          method: 'POST',
          body: JSON.stringify({
            query: params.query,
            mode: params.mode,
            filters: {
              ...params.filters,
              includeAiAnswer: params.filters?.includeAiAnswer !== false && consent.allowCloudAi
            },
            authorizedTabs: authorizedTabContexts,
            isPrivateSession: false
          })
        });
        if (res.ok) {
          const cloudResp = (await res.json()) as SearchResponse;
          // Merge local desktop knowledge alongside cloud results cleanly
          const understanding = cloudResp.understanding;
          const merged = this.ranking.normalizeAndRank({
            candidates: [
              ...cloudResp.results.map((r) => ({
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                sourceProvider: r.sourceProvider,
                publishedAt: r.publishedAt,
                contentType: r.contentType,
                language: r.language,
                favicon: r.favicon
              })),
              ...localCandidates
            ],
            understanding,
            filters: params.filters
          });
          return {
            ...cloudResp,
            results: merged.results.slice(0, params.filters?.limit ?? 15),
            providersQueried: Array.from(
              new Set([
                ...cloudResp.providersQueried,
                ...(this.localIndex ? ['lavray_first_party_index'] : []),
                'local_bookmarks',
                'local_memory'
              ])
            ),
            sourceMode: 'hybrid',
            latencyMs: Date.now() - started
          };
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : 'Cloud search request failed';
        // Fall through smoothly to local-first search
      }
    }

    // Local-first offline/fallback execution
    const understanding = this.queryUnderstanding.analyzeDeterministic(params.query, params.mode);
    const activeMode = params.mode ?? understanding.recommendedMode;
    for (const t of authorizedTabContexts) {
      localCandidates.push({
        title: t.title,
        url: t.url,
        snippet: t.text.slice(0, 320),
        sourceProvider: 'open_tabs',
        contentType: 'tab',
        rawRank: 1
      });
    }

    const limit = Math.min(30, Math.max(1, params.filters?.limit ?? 15));
    const page = Math.max(1, params.filters?.page ?? 1);
    const ranked = this.ranking.normalizeAndRank({
      candidates: localCandidates,
      understanding,
      filters: params.filters,
      allowLocalTestUrls: process.env.LAVRAY_ALLOW_LOCALHOST_SEARCH_TEST === 'true'
    });
    const reranked = await this.ranking.rerankCandidates(understanding.originalQuery, ranked.results);
    const totalResults = reranked.results.length;
    const totalPages = Math.max(1, Math.ceil(totalResults / limit));
    const safePage = Math.min(page, totalPages);
    const results = reranked.results.slice((safePage - 1) * limit, safePage * limit);

    let aiAnswer: AiCitedAnswer | null = null;
    if (params.filters?.includeAiAnswer !== false && results.length > 0) {
      aiAnswer = await this.buildLocalAiSummary(understanding.originalQuery, results, authorizedTabContexts);
    }

    const suggestions: SearchSuggestion[] = understanding.rewrittenQueries
      .filter((q) => q !== params.query)
      .map((q) => ({ text: q, kind: 'refinement' }));

    const indexStats: LavrayIndexStats = this.localIndex
      ? this.localIndex.getStats()
      : {
          totalDocuments: 0,
          uniqueDomains: 0,
          latestCrawlAt: null,
          indexVersion: 'v1',
          limitedCoverage: true,
          notice: 'Local LAVRAY Index empty.'
        };

    // Record local search history only if no active window is exclusively private
    const anyActivePrivate = this.tabManager.getAllTabs().every((t) => t.isPrivate) && this.tabManager.getAllTabs().length > 0;
    if (this.localIndex && !anyActivePrivate) {
      this.localIndex.recordSearchHistory(params.query, activeMode, results.length, false);
    }

    const aiRuntimeStatus = await this.getLocalRuntimeStatus();

    return {
      requestId: randomUUID(),
      query: params.query,
      mode: activeMode,
      understanding,
      results,
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
      relatedQueries: [
        `${understanding.normalizedQuery} documentation`,
        `${understanding.normalizedQuery} comparison`
      ],
      aiAnswer,
      providersQueried: [
        ...(this.localIndex ? ['lavray_first_party_index'] : []),
        'local_bookmarks',
        'local_memory',
        'local_research',
        'open_tabs'
      ],
      providerErrors: [],
      indexStatus: {
        indexedDocuments: indexStats.totalDocuments,
        limitedCoverage: indexStats.limitedCoverage,
        notice: indexStats.notice
      },
      aiRuntimeStatus,
      cacheHit: false,
      reranked: reranked.reranked,
      latencyMs: Date.now() - started,
      sourceMode: 'local_fallback'
    };
  }

  public async getLocalRuntimeStatus(): Promise<SelfHostedRuntimeStatus> {
    const rawModel =
      this.platformRepo.getSetting<string>('agent.selfHostedModel', 'qwen2.5:3b') ||
      this.platformRepo.getSetting<string>('agent.defaultModel', 'qwen2.5:3b');
    const model = /^(gemini|mock)/i.test(rawModel.trim()) ? 'qwen2.5:3b' : rawModel.trim();

    if (this.selfHostedProvider) {
      return this.selfHostedProvider.getRuntimeStatus(model);
    }

    return {
      backendKind: 'unconfigured',
      endpointUrl: this.platformRepo.getSetting<string>('agent.selfHostedEndpointUrl', 'http://127.0.0.1:11434/v1'),
      configuredModel: model,
      reachable: false,
      modelAvailable: false,
      availableModels: [],
      latencyMs: 0,
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      statusMessage: 'Self-hosted model runtime not initialized'
    };
  }

  public async listSearchHistory(): Promise<CloudSearchHistoryRecord[]> {
    return this.localIndex ? this.localIndex.listSearchHistory(30) : [];
  }

  public async clearSearchHistory(): Promise<void> {
    this.localIndex?.clearSearchHistory();
    if (this.isCloudEnabled() && this.vault.getCloudTokens().accessToken) {
      await this.authorizedFetch('/api/v1/userdata/search-history', { method: 'DELETE' }).catch(() => undefined);
    }
  }

  public async getIndexStats(): Promise<LavrayIndexStats> {
    if (this.isCloudEnabled() && this.getConsent().allowCloudSearch) {
      try {
        const res = await fetch(`${this.getEndpointUrl()}/api/v1/index/stats`);
        if (res.ok) {
          const data = (await res.json()) as { stats?: LavrayIndexStats };
          if (data.stats) return data.stats;
        }
      } catch {
        // Fallback to local index stats
      }
    }
    return this.localIndex
      ? this.localIndex.getStats()
      : {
          totalDocuments: 0,
          uniqueDomains: 0,
          latestCrawlAt: null,
          indexVersion: 'v1',
          limitedCoverage: true,
          notice: 'Local LAVRAY Index empty.'
        };
  }

  public async crawlIndexSeeds(config: CrawlSeedConfig): Promise<CrawlCheckpoint> {
    if (!this.localIndex) {
      throw new Error('Local search index unavailable');
    }
    return this.localIndex.crawlSeeds(config);
  }

  private async buildLocalAiSummary(
    query: string,
    results: SearchResponse['results'],
    tabContexts: Array<{ url: string; title: string; text: string }>
  ): Promise<AiCitedAnswer> {
    const started = Date.now();
    const provider = this.getLocalModelProvider();

    const ctxMap = new Map(tabContexts.map((t) => [t.url, t.text]));
    const passages = results.slice(0, 4).map((r, idx) => ({
      sourceUrl: r.url,
      sourceTitle: r.title,
      domain: r.domain,
      passageIndex: idx,
      excerpt: (ctxMap.get(r.url) || `${r.title}. ${r.snippet}`).slice(0, 600),
      relevance: r.relevanceScore
    }));

    const allowedUrls = new Set(passages.map((p) => p.sourceUrl));
    const wrapped = passages
      .map((p, i) =>
        this.injectionGuard.wrapUntrustedContent(
          p.sourceUrl,
          `[${i + 1}] URL: ${p.sourceUrl}\nTITLE: ${p.sourceTitle}\nTEXT: ${p.excerpt}`
        )
      )
      .join('\n\n');

    try {
      const rawModel =
        this.platformRepo.getSetting<string>('agent.selfHostedModel', 'qwen2.5:3b') ||
        this.platformRepo.getSetting<string>('agent.defaultModel', 'qwen2.5:3b');
      const model = /^(gemini|mock)/i.test(rawModel.trim()) ? 'qwen2.5:3b' : rawModel.trim();
      const resp = await provider.generate({
        model,
        systemInstruction:
          'Synthesize a concise cited summary using ONLY the retrieved local/tab passages. Never invent URLs.',
        messages: [{ role: 'user', parts: [{ text: `Query: ${query}\n\n${wrapped}` }] }],
        temperature: 0.1,
        maxOutputTokens: 600
      });

      return {
        status: 'ok',
        summary: resp.text,
        claims: passages
          .filter((p) => allowedUrls.has(p.sourceUrl))
          .slice(0, 3)
          .map((p) => ({
            id: randomUUID(),
            statement: p.excerpt.slice(0, 180),
            kind: 'fact',
            sourceUrl: p.sourceUrl,
            sourceTitle: p.sourceTitle,
            supportingQuote: p.excerpt.slice(0, 140),
            verifiedAgainstSource: true
          })),
        contradictions: [],
        passages,
        citations: passages.map((p, i) => ({
          index: i + 1,
          url: p.sourceUrl,
          title: p.sourceTitle,
          domain: p.domain
        })),
        model,
        provider: provider.id,
        inputTokens: resp.usage.inputTokens,
        outputTokens: resp.usage.outputTokens,
        estimatedCostUsd: 0,
        latencyMs: Date.now() - started
      };
    } catch (err) {
      return {
        status: 'failed',
        summary: 'Local AI summary generation failed; retrieved results remain available.',
        claims: [],
        contradictions: [],
        passages,
        citations: [],
        model: 'error',
        provider: provider.id,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: Date.now() - started,
        warning: err instanceof Error ? err.message : 'Local summary failed'
      };
    }
  }

  private async authorizedFetch(pathSuffix: string, init: RequestInit): Promise<Response> {
    const endpoint = this.getEndpointUrl().replace(/\/+$/, '');
    const tokens = this.vault.getCloudTokens();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined)
    };
    if (tokens.accessToken) {
      headers.Authorization = `Bearer ${tokens.accessToken}`;
    }

    let res = await fetch(`${endpoint}${pathSuffix}`, { ...init, headers });
    if (res.status === 401 && tokens.refreshToken) {
      const refreshRes = await fetch(`${endpoint}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken })
      });
      if (refreshRes.ok) {
        const session = (await refreshRes.json()) as CloudAuthSession;
        this.vault.setCloudTokens(session.accessToken, session.refreshToken);
        headers.Authorization = `Bearer ${session.accessToken}`;
        res = await fetch(`${endpoint}${pathSuffix}`, { ...init, headers });
      }
    }
    return res;
  }
}

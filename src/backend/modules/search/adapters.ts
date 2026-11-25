import type { SearchMode, SearchProviderHealth } from '@shared/types';
import type { HybridIndexService } from '../knowledge/hybrid-index-service';
import {
  withProviderTimeout,
  type ProviderSearchParams,
  type RawSearchCandidate,
  type SearchProvider
} from './provider';

export class BraveSearchAdapter implements SearchProvider {
  public readonly id = 'brave';
  public readonly name = 'Brave Search API';
  public readonly isMock = false;
  private avgLatencyMs = 0;
  private lastError: string | null = null;

  constructor(private readonly apiKey: string | null) {}

  public isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  public supportsMode(mode: SearchMode): boolean {
    return ['web', 'news', 'docs', 'research'].includes(mode);
  }

  public async search(params: ProviderSearchParams): Promise<RawSearchCandidate[]> {
    if (!this.apiKey) throw new Error('Brave Search API key not configured');
    const started = Date.now();
    const endpoint =
      params.mode === 'news'
        ? 'https://api.search.brave.com/res/v1/news/search'
        : 'https://api.search.brave.com/res/v1/web/search';

    const url = new URL(endpoint);
    url.searchParams.set('q', params.query);
    url.searchParams.set('count', String(Math.min(20, params.limit)));
    if (params.filters?.timeRange && params.filters.timeRange !== 'any') {
      const freshnessMap: Record<string, string> = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };
      if (freshnessMap[params.filters.timeRange]) {
        url.searchParams.set('freshness', freshnessMap[params.filters.timeRange]);
      }
    }

    try {
      const data = await withProviderTimeout(async (signal) => {
        const res = await fetch(url.toString(), {
          signal,
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': this.apiKey!
          }
        });
        if (!res.ok) {
          throw new Error(`Brave Search HTTP ${res.status}`);
        }
        return (await res.json()) as {
          web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> };
          results?: Array<{ title?: string; url?: string; description?: string; age?: string }>;
        };
      }, 6000, params.signal);

      this.avgLatencyMs = Date.now() - started;
      this.lastError = null;
      const items = data.web?.results ?? data.results ?? [];
      return items
        .filter((r) => Boolean(r.url && r.title))
        .map((r, idx) => ({
          title: r.title || '',
          url: r.url || '',
          snippet: r.description || '',
          sourceProvider: this.id,
          publishedAt: r.age ?? null,
          contentType: params.mode === 'news' ? 'news' : params.mode === 'docs' ? 'docs' : 'web',
          rawRank: idx + 1
        }));
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  public async healthCheck(): Promise<SearchProviderHealth> {
    return {
      providerId: this.id,
      name: this.name,
      configured: this.isConfigured(),
      healthy: this.isConfigured() && !this.lastError,
      isMock: false,
      lastError: this.lastError,
      avgLatencyMs: this.avgLatencyMs
    };
  }
}

export class GoogleCseSearchAdapter implements SearchProvider {
  public readonly id = 'google_cse';
  public readonly name = 'Google Programmable Search';
  public readonly isMock = false;
  private avgLatencyMs = 0;
  private lastError: string | null = null;

  constructor(
    private readonly apiKey: string | null,
    private readonly cx: string | null
  ) {}

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.cx);
  }

  public supportsMode(mode: SearchMode): boolean {
    return ['web', 'docs', 'research', 'news'].includes(mode);
  }

  public async search(params: ProviderSearchParams): Promise<RawSearchCandidate[]> {
    if (!this.apiKey || !this.cx) throw new Error('Google CSE credentials not configured');
    const started = Date.now();
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('cx', this.cx);
    url.searchParams.set('q', params.query);
    url.searchParams.set('num', String(Math.min(10, params.limit)));
    if (params.filters?.timeRange && params.filters.timeRange !== 'any') {
      const map: Record<string, string> = { day: 'd1', week: 'w1', month: 'm1', year: 'y1' };
      if (map[params.filters.timeRange]) url.searchParams.set('dateRestrict', map[params.filters.timeRange]);
    }

    try {
      const data = await withProviderTimeout(async (signal) => {
        const res = await fetch(url.toString(), { signal });
        if (!res.ok) throw new Error(`Google CSE HTTP ${res.status}`);
        return (await res.json()) as {
          items?: Array<{ title?: string; link?: string; snippet?: string }>;
        };
      }, 6000, params.signal);

      this.avgLatencyMs = Date.now() - started;
      this.lastError = null;
      return (data.items ?? [])
        .filter((r) => Boolean(r.link && r.title))
        .map((r, idx) => ({
          title: r.title || '',
          url: r.link || '',
          snippet: r.snippet || '',
          sourceProvider: this.id,
          contentType: params.mode === 'docs' ? 'docs' : 'web',
          rawRank: idx + 1
        }));
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  public async healthCheck(): Promise<SearchProviderHealth> {
    return {
      providerId: this.id,
      name: this.name,
      configured: this.isConfigured(),
      healthy: this.isConfigured() && !this.lastError,
      isMock: false,
      lastError: this.lastError,
      avgLatencyMs: this.avgLatencyMs
    };
  }
}

export class BingSearchAdapter implements SearchProvider {
  public readonly id = 'bing';
  public readonly name = 'Bing Web Search API';
  public readonly isMock = false;
  private avgLatencyMs = 0;
  private lastError: string | null = null;

  constructor(private readonly apiKey: string | null) {}

  public isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  public supportsMode(mode: SearchMode): boolean {
    return ['web', 'news', 'docs', 'research'].includes(mode);
  }

  public async search(params: ProviderSearchParams): Promise<RawSearchCandidate[]> {
    if (!this.apiKey) throw new Error('Bing Search API key not configured');
    const started = Date.now();
    const url = new URL('https://api.bing.microsoft.com/v7.0/search');
    url.searchParams.set('q', params.query);
    url.searchParams.set('count', String(Math.min(20, params.limit)));

    try {
      const data = await withProviderTimeout(async (signal) => {
        const res = await fetch(url.toString(), {
          signal,
          headers: { 'Ocp-Apim-Subscription-Key': this.apiKey! }
        });
        if (!res.ok) throw new Error(`Bing Search HTTP ${res.status}`);
        return (await res.json()) as {
          webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string; dateLastCrawled?: string }> };
        };
      }, 6000, params.signal);

      this.avgLatencyMs = Date.now() - started;
      this.lastError = null;
      return (data.webPages?.value ?? [])
        .filter((r) => Boolean(r.url && r.name))
        .map((r, idx) => ({
          title: r.name || '',
          url: r.url || '',
          snippet: r.snippet || '',
          sourceProvider: this.id,
          publishedAt: r.dateLastCrawled ?? null,
          contentType: params.mode === 'news' ? 'news' : 'web',
          rawRank: idx + 1
        }));
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  public async healthCheck(): Promise<SearchProviderHealth> {
    return {
      providerId: this.id,
      name: this.name,
      configured: this.isConfigured(),
      healthy: this.isConfigured() && !this.lastError,
      isMock: false,
      lastError: this.lastError,
      avgLatencyMs: this.avgLatencyMs
    };
  }
}

export class AtlasKnowledgeSearchAdapter implements SearchProvider {
  public readonly id = 'atlas_knowledge';
  public readonly name = 'Atlas Personal Knowledge Hybrid Index';
  public readonly isMock = false;

  constructor(private readonly hybridIndex: HybridIndexService) {}

  public isConfigured(): boolean {
    return true;
  }

  public supportsMode(mode: SearchMode): boolean {
    return ['personal_knowledge', 'research', 'web', 'docs'].includes(mode);
  }

  public async search(_params: ProviderSearchParams): Promise<RawSearchCandidate[]> {
    // User-scoped search uses searchForUser directly so profile isolation is enforced
    return [];
  }

  public async searchForUser(params: {
    userId: string;
    profileId: string;
    query: string;
    limit: number;
  }): Promise<RawSearchCandidate[]> {
    const hits = await this.hybridIndex.search({
      userId: params.userId,
      profileId: params.profileId,
      query: params.query,
      limit: params.limit
    });
    return hits.map((h, idx) => ({
      title: h.document.title,
      url: h.document.url || `atlas://knowledge/${h.document.sourceType}/${h.document.sourceId}`,
      snippet: h.document.content.slice(0, 320),
      sourceProvider: this.id,
      publishedAt: new Date(h.document.updatedAt).toISOString(),
      contentType:
        h.document.sourceType === 'bookmark'
          ? 'bookmark'
          : h.document.sourceType === 'research'
            ? 'research'
            : 'knowledge',
      rawRank: idx + 1
    }));
  }

  public async healthCheck(): Promise<SearchProviderHealth> {
    return {
      providerId: this.id,
      name: this.name,
      configured: true,
      healthy: true,
      isMock: false,
      avgLatencyMs: 2
    };
  }
}

export interface DeterministicSearchFixture {
  title: string;
  url: string;
  snippet: string;
  contentType?: RawSearchCandidate['contentType'];
  publishedAt?: string;
}

export class MockSearchProvider implements SearchProvider {
  public readonly id = 'mock_search';
  public readonly name = 'Deterministic Test Search Provider';
  public readonly isMock = true;

  constructor(private readonly corpus: DeterministicSearchFixture[] = DEFAULT_MOCK_CORPUS) {}

  public isConfigured(): boolean {
    return true;
  }

  public supportsMode(): boolean {
    return true;
  }

  public async search(params: ProviderSearchParams): Promise<RawSearchCandidate[]> {
    const tokens = params.query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    const matched = this.corpus
      .map((item) => {
        const hay = `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
        const hits = tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
        return { item, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, params.limit);

    return matched.map((m, idx) => ({
      title: m.item.title,
      url: m.item.url,
      snippet: m.item.snippet,
      sourceProvider: this.id,
      publishedAt: m.item.publishedAt ?? null,
      contentType: m.item.contentType ?? 'web',
      rawRank: idx + 1
    }));
  }

  public async healthCheck(): Promise<SearchProviderHealth> {
    return {
      providerId: this.id,
      name: this.name,
      configured: true,
      healthy: true,
      isMock: true,
      avgLatencyMs: 1
    };
  }
}

const DEFAULT_MOCK_CORPUS: DeterministicSearchFixture[] = [
  {
    title: 'PostgreSQL Documentation: Full Text Search & GIN Indexes',
    url: 'https://www.postgresql.org/docs/current/textsearch.html',
    snippet: 'PostgreSQL tsvector and tsquery provide native stemming, ranking (ts_rank_cd), and GIN index acceleration for low-latency keyword retrieval.',
    contentType: 'docs',
    publishedAt: '2026-06-01T00:00:00Z'
  },
  {
    title: 'Electron Security Guidelines & WebContentsView Isolation',
    url: 'https://www.electronjs.org/docs/latest/tutorial/security',
    snippet: 'Isolate untrusted remote origins in sandboxed WebContentsView instances with strict contextIsolation, CSP, and Zod-validated IPC.',
    contentType: 'docs',
    publishedAt: '2026-08-15T00:00:00Z'
  },
  {
    title: 'OWASP Server-Side Request Forgery (SSRF) Prevention Cheat Sheet',
    url: 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
    snippet: 'Validate URL schemes, resolve DNS before connecting, block RFC1918/loopback/link-local CIDRs and cloud metadata endpoints, and inspect redirects.',
    contentType: 'docs',
    publishedAt: '2026-05-10T00:00:00Z'
  },
  {
    title: 'Hybrid Search Architecture: Combining BM25 and Dense Vector Retrieval',
    url: 'https://atlas-docs.example.org/hybrid-search-bm25-vectors',
    snippet: 'Combining lexical exact matching (BM25/tsvector) with vector cosine similarity improves recall on synonyms while preserving exact identifier precision.',
    contentType: 'research',
    publishedAt: '2026-09-20T00:00:00Z'
  }
];

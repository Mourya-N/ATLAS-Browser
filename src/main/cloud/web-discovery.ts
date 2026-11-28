import type { SearchFilterOptions, SearchMode, SearchQueryUnderstanding } from '@shared/types';
import type { RawSearchCandidate } from '../../backend/modules/search/provider';
import { evaluateInstantTool, type InstantAnswerPayload } from './instant-tools';

const TECH_QUERY_RE =
  /\b(api|sdk|docs|documentation|code|error|bug|exception|typescript|javascript|python|rust|golang|java|postgres|postgresql|sqlite|kubernetes|k8s|docker|react|electron|http|quic|ssrf|oauth|jwt|fts5|bm25|sql|css|html|git|linux|npm|node)\b|[a-z]+_[a-z]+|::|->|\bc\+\+|\bc#/i;

const ACADEMIC_QUERY_RE =
  /\b(paper|study|research|arxiv|theorem|algorithm|neural|transformer|quantum|benchmark|survey|citation|clinical|genome|physics)\b/i;

const DEFINE_QUERY_RE = /^(?:define|definition\s+of|meaning\s+of)\s+([a-z][a-z-]{1,30})$/i;

export interface WebDiscoveryResult {
  candidates: RawSearchCandidate[];
  providersQueried: string[];
  providerErrors: Array<{ providerId: string; error: string }>;
  instantAnswer?: InstantAnswerPayload | null;
}

export interface StarterIndexPack {
  id: string;
  label: string;
  description: string;
  seedUrls: string[];
  allowedDomains: string[];
}

export const STARTER_INDEX_PACKS: StarterIndexPack[] = [
  {
    id: 'web-mdn',
    label: 'MDN Web Docs',
    description: 'Core JavaScript, Web APIs, HTML & CSS reference',
    seedUrls: [
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
      'https://developer.mozilla.org/en-US/docs/Web/API'
    ],
    allowedDomains: ['developer.mozilla.org']
  },
  {
    id: 'postgres',
    label: 'PostgreSQL Docs',
    description: 'Full-text search, SQL indexing & architecture docs',
    seedUrls: ['https://www.postgresql.org/docs/current/textsearch.html'],
    allowedDomains: ['postgresql.org']
  },
  {
    id: 'electron',
    label: 'Electron & Security',
    description: 'Electron security guidelines & WebContentsView docs',
    seedUrls: ['https://www.electronjs.org/docs/latest/tutorial/security'],
    allowedDomains: ['electronjs.org']
  },
  {
    id: 'owasp',
    label: 'OWASP Security',
    description: 'SSRF, XSS, and web application security cheat sheets',
    seedUrls: [
      'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html'
    ],
    allowedDomains: ['cheatsheetseries.owasp.org', 'owasp.org']
  },
  {
    id: 'nodejs',
    label: 'Node.js Docs',
    description: 'Node.js runtime & standard library API guides',
    seedUrls: ['https://nodejs.org/en/learn/getting-started/introduction-to-nodejs'],
    allowedDomains: ['nodejs.org']
  }
];

function stripHtmlAndEntities(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapCdata(input: string): string {
  return input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function extractXmlTag(block: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  return m ? unwrapCdata(m[1]).trim() : '';
}

function getTimeCutoffUnixSeconds(timeRange?: SearchFilterOptions['timeRange']): number | null {
  const nowSec = Math.floor(Date.now() / 1000);
  switch (timeRange) {
    case 'day':
      return nowSec - 86_400;
    case 'week':
      return nowSec - 7 * 86_400;
    case 'month':
      return nowSec - 30 * 86_400;
    case 'year':
      return nowSec - 365 * 86_400;
    default:
      return null;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const USER_AGENT = 'LAVRAY-Search/1.0 (+https://github.com/Mourya-N/LAVRAY)';

/**
 * Provider-independent Open Web Discovery Engine.
 * Queries official public JSON/Atom search APIs (Wikipedia, DuckDuckGo Instant Answer,
 * MDN Web Docs, Hacker News Algolia, StackOverflow, GitHub, arXiv) plus optional
 * self-hosted SearXNG endpoints—without scraping proprietary SERPs.
 */
export class WebDiscoveryEngine {
  private readonly providerCooldownUntil = new Map<string, number>();

  constructor(private readonly fetchFn: FetchLike = globalThis.fetch.bind(globalThis)) {}

  public async discover(params: {
    query: string;
    mode: SearchMode;
    filters?: SearchFilterOptions;
    understanding?: SearchQueryUnderstanding;
    searxngEndpointUrl?: string;
    braveApiKey?: string;
    timeoutMs?: number;
  }): Promise<WebDiscoveryResult> {
    const query = (params.understanding?.normalizedQuery || params.query).trim() || params.query.trim();
    if (!query || ['current_page', 'cross_tab', 'personal_knowledge'].includes(params.mode)) {
      return { candidates: [], providersQueried: [], providerErrors: [], instantAnswer: null };
    }

    const timeoutMs = Math.max(1000, Math.min(8000, params.timeoutMs ?? 3800));
    const providersQueried: string[] = [];
    const providerErrors: Array<{ providerId: string; error: string }> = [];
    const candidates: RawSearchCandidate[] = [];
    // Zero-latency instant tools (calculator, unit converter, color inspector)
    let instantAnswer: WebDiscoveryResult['instantAnswer'] = evaluateInstantTool(params.query);
    const now = Date.now();

    const tasks: Array<Promise<void>> = [];

    const runSource = (providerId: string, fn: (signal: AbortSignal) => Promise<RawSearchCandidate[]>) => {
      const cooldown = this.providerCooldownUntil.get(providerId) ?? 0;
      if (cooldown > now) {
        providerErrors.push({ providerId, error: 'Provider temporarily cooled down after upstream error' });
        return;
      }
      providersQueried.push(providerId);
      tasks.push(
        (async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const hits = await fn(controller.signal);
            this.providerCooldownUntil.delete(providerId);
            candidates.push(...hits);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/HTTP (429|5\d\d)/i.test(msg)) {
              this.providerCooldownUntil.set(providerId, Date.now() + 30_000);
            }
            providerErrors.push({ providerId, error: msg });
          } finally {
            clearTimeout(timer);
          }
        })()
      );
    };

    const isNavigational = params.understanding?.intent === 'navigational';
    const isTechnical =
      params.mode === 'docs' ||
      params.understanding?.intent === 'technical_docs' ||
      (params.understanding?.technicalTokens?.length ?? 0) > 0 ||
      TECH_QUERY_RE.test(params.query);
    const isAcademic =
      params.mode === 'research' || ACADEMIC_QUERY_RE.test(params.query);

    const effectiveDomains = [
      ...(params.filters?.domains ?? []),
      ...(params.understanding?.siteFilters ?? [])
    ];
    const queryWithSites =
      effectiveDomains.length > 0
        ? `${query} ${effectiveDomains.map((d) => `site:${d}`).join(' OR ')}`
        : query;

    const braveKey = params.braveApiKey?.trim();
    const searxUrl = params.searxngEndpointUrl?.trim();

    // Specialized verticals: Images, Videos, Maps, Shopping
    if (params.mode === 'images') {
      if (braveKey) runSource('brave_images_api', (s) => this.queryBraveImages(braveKey, queryWithSites, s));
      runSource('wikimedia_images', (s) => this.queryWikimediaImages(query, s));
      runSource('wikipedia_images', (s) => this.queryWikipediaImages(query, s));
      await Promise.allSettled(tasks);
      return { candidates, providersQueried, providerErrors, instantAnswer: null };
    }

    if (params.mode === 'videos') {
      if (braveKey) runSource('brave_videos_api', (s) => this.queryBraveVideos(braveKey, queryWithSites, s));
      runSource('dailymotion_api', (s) => this.queryDailymotionVideos(query, s));
      runSource('archive_videos_api', (s) => this.queryArchiveVideos(query, s));
      await Promise.allSettled(tasks);
      return { candidates, providersQueried, providerErrors, instantAnswer: null };
    }

    if (params.mode === 'maps') {
      runSource('osm_nominatim', (s) => this.queryOsmNominatim(query, s));
      await Promise.allSettled(tasks);
      return { candidates, providersQueried, providerErrors, instantAnswer: null };
    }

    if (params.mode === 'shopping') {
      if (braveKey) runSource('brave_web_api', (s) => this.queryBraveWeb(braveKey, `${queryWithSites} price buy`, 'web', params.filters, s));
      if (searxUrl && /^https?:\/\//i.test(searxUrl)) {
        runSource('searxng_custom', (s) => this.querySearxng(searxUrl, `${queryWithSites} price buy`, 'web', params.filters, s));
      }
      runSource('bing_shopping_rss', (s) => this.queryShoppingRss(queryWithSites, s));
      await Promise.allSettled(tasks);
      return { candidates, providersQueried, providerErrors, instantAnswer: null };
    }

    // 1. Optional Brave Search API (if user configured an API key in Settings)
    if (braveKey) {
      runSource('brave_web_api', (signal) =>
        this.queryBraveWeb(braveKey, queryWithSites, params.mode, params.filters, signal)
      );
    }

    // 2. Optional user-configured SearXNG instance (full metasearch when provided)
    if (searxUrl && /^https?:\/\//i.test(searxUrl)) {
      runSource('searxng_custom', (signal) =>
        this.querySearxng(searxUrl, queryWithSites, params.mode, params.filters, signal)
      );
    }

    // 3. Bing Web Search RSS (live commercial, price, local & general web results without API key)
    if (params.mode !== 'news') {
      runSource('bing_web_rss', (signal) => this.queryBingRss(queryWithSites, signal));
    }

    // 3b. Google News RSS (live breaking news, rates, releases & temporal queries)
    if (
      params.mode === 'news' ||
      params.understanding?.temporalIntent?.hasTemporalConstraint ||
      /\b(today|rate|price|latest|news|live|weather|score)\b/i.test(params.query)
    ) {
      runSource('google_news_rss', (signal) => this.queryGoogleNewsRss(queryWithSites, signal));
    }

    // 4. Wikipedia Official Open API (encyclopedic / general / research / docs)
    let topWikiTitle: string | null = null;
    runSource('wikipedia_api', async (signal) => {
      const wikiHits = await this.queryWikipedia(query, signal);
      if (wikiHits[0]?.title) {
        topWikiTitle = wikiHits[0].title.replace(/\s+—\s+Wikipedia$/, '');
      }
      return wikiHits;
    });

    // 4b. Independent Web Crawler Index (Marginalia Search API) for broad general/web queries
    if (!isNavigational && (params.mode === 'web' || params.mode === 'research')) {
      runSource('marginalia_api', (signal) => this.queryMarginalia(query, signal));
    }

    // 3c. Dictionary definition instant answer for "define <word>"
    const defineMatch = DEFINE_QUERY_RE.exec(params.query.trim());
    if (defineMatch && !instantAnswer) {
      const word = defineMatch[1];
      runSource('dictionary_api', async (signal) => {
        const res = await this.queryDictionary(word, signal);
        if (res.instant && !instantAnswer) instantAnswer = res.instant;
        return res.candidates;
      });
    }

    // 4. DuckDuckGo Instant Answer JSON API (abstracts + entity links; skip for news)
    if (params.mode !== 'news') {
      runSource('duckduckgo_instant', async (signal) => {
        const res = await this.queryDuckDuckGoInstant(query, signal);
        if (res.instant && !instantAnswer) instantAnswer = res.instant;
        return res.candidates;
      });
    }

    // 5. Hacker News Algolia API (news, tech, research, and general non-navigational queries)
    if (!isNavigational && (params.mode === 'news' || params.mode === 'research' || isTechnical || params.mode === 'web')) {
      runSource('hackernews_algolia', (signal) =>
        this.queryHackerNews(query, params.mode, params.filters?.timeRange, signal)
      );
    }

    // 6. Technical & Developer APIs ONLY when query has technical/docs intent (prevents noise on general queries)
    if (isTechnical) {
      runSource('mdn_docs_api', (signal) => this.queryMdn(query, signal));
      runSource('stackoverflow_api', (signal) => this.queryStackOverflow(query, signal));
      runSource('github_repos_api', (signal) => this.queryGitHubRepos(query, signal));
    }

    // 7. arXiv + OpenAlex Open Research APIs ONLY for research mode or academic/scientific queries
    if (isAcademic) {
      runSource('arxiv_api', (signal) => this.queryArxiv(query, signal));
      runSource('openalex_api', (signal) => this.queryOpenAlex(query, signal));
    }

    await Promise.allSettled(tasks);

    // Enrich Knowledge Panel with Wikipedia REST Summary (thumbnail + concise description) if no higher-priority instant card exists or if DDG lacked thumbnail
    if (
      topWikiTitle &&
      params.mode !== 'news' &&
      (!instantAnswer || (instantAnswer.kind === 'entity' && !instantAnswer.thumbnailUrl))
    ) {
      try {
        const summaryCtrl = new AbortController();
        const t = setTimeout(() => summaryCtrl.abort(), 1400);
        const summary = await this.queryWikipediaSummary(topWikiTitle, summaryCtrl.signal);
        clearTimeout(t);
        if (summary) {
          instantAnswer = summary;
        }
      } catch {
        // Non-blocking enrichment
      }
    }

    return {
      candidates,
      providersQueried,
      providerErrors,
      instantAnswer
    };
  }

  private async fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
    const res = await this.fetchFn(url, {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private async queryWikipedia(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('utf8', '1');
    url.searchParams.set('format', 'json');
    url.searchParams.set('srlimit', '6');

    const data = await this.fetchJson<{
      query?: {
        search?: Array<{ title: string; snippet: string; timestamp?: string }>;
      };
    }>(url.toString(), signal);

    return (data.query?.search ?? []).map((item, idx) => ({
      title: `${item.title} — Wikipedia`,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
      snippet: stripHtmlAndEntities(item.snippet || item.title),
      sourceProvider: 'wikipedia_api',
      publishedAt: item.timestamp ?? null,
      contentType: 'web',
      language: 'en',
      rawRank: idx + 1
    }));
  }

  private async queryDuckDuckGoInstant(
    query: string,
    signal: AbortSignal
  ): Promise<{
    candidates: RawSearchCandidate[];
    instant: WebDiscoveryResult['instantAnswer'];
  }> {
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');

    const data = await this.fetchJson<{
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      Results?: Array<{ FirstURL?: string; Text?: string }>;
      RelatedTopics?: Array<{
        FirstURL?: string;
        Text?: string;
        Topics?: Array<{ FirstURL?: string; Text?: string }>;
      }>;
    }>(url.toString(), signal);

    const candidates: RawSearchCandidate[] = [];
    let instant: WebDiscoveryResult['instantAnswer'] = null;

    if (data.AbstractText && data.AbstractURL) {
      const cleanAbstract = stripHtmlAndEntities(data.AbstractText);
      const heading = data.Heading || query;
      instant = {
        kind: 'entity',
        title: heading,
        summary: cleanAbstract,
        url: data.AbstractURL,
        source: data.AbstractSource || 'Instant Answer'
      };
      candidates.push({
        title: heading,
        url: data.AbstractURL,
        snippet: cleanAbstract.slice(0, 320),
        sourceProvider: 'duckduckgo_instant',
        contentType: 'web',
        rawRank: 1
      });
    }

    for (const r of data.Results ?? []) {
      if (r.FirstURL && r.Text) {
        candidates.push({
          title: stripHtmlAndEntities(r.Text).slice(0, 100),
          url: r.FirstURL,
          snippet: stripHtmlAndEntities(r.Text).slice(0, 300),
          sourceProvider: 'duckduckgo_instant',
          contentType: 'web',
          rawRank: candidates.length + 1
        });
      }
    }

    const flatTopics = (data.RelatedTopics ?? []).flatMap((t) => (t.Topics ? t.Topics : [t]));
    for (const topic of flatTopics.slice(0, 5)) {
      if (!topic.FirstURL || !topic.Text) continue;
      const clean = stripHtmlAndEntities(topic.Text);
      const dashIdx = clean.indexOf(' - ');
      const title = dashIdx > 0 ? clean.slice(0, dashIdx) : clean.slice(0, 80);
      candidates.push({
        title,
        url: topic.FirstURL,
        snippet: clean.slice(0, 300),
        sourceProvider: 'duckduckgo_instant',
        contentType: 'web',
        rawRank: candidates.length + 1
      });
    }

    return { candidates, instant };
  }

  private async queryHackerNews(
    query: string,
    mode: SearchMode,
    timeRange: SearchFilterOptions['timeRange'],
    signal: AbortSignal
  ): Promise<RawSearchCandidate[]> {
    const endpoint =
      mode === 'news' ? 'https://hn.algolia.com/api/v1/search_by_date' : 'https://hn.algolia.com/api/v1/search';
    const url = new URL(endpoint);
    url.searchParams.set('query', query);
    url.searchParams.set('tags', 'story');
    url.searchParams.set('hitsPerPage', '6');

    const cutoff = getTimeCutoffUnixSeconds(timeRange);
    if (cutoff) {
      url.searchParams.set('numericFilters', `created_at_i>${cutoff}`);
    }

    const data = await this.fetchJson<{
      hits?: Array<{
        objectID: string;
        title?: string;
        url?: string;
        points?: number;
        num_comments?: number;
        created_at?: string;
        author?: string;
      }>;
    }>(url.toString(), signal);

    return (data.hits ?? [])
      .filter((h) => Boolean(h.title))
      .map((h, idx) => ({
        title: stripHtmlAndEntities(h.title || ''),
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        snippet: `Hacker News discussion (${h.points ?? 0} points, ${h.num_comments ?? 0} comments${h.author ? `, by ${h.author}` : ''}).`,
        sourceProvider: 'hackernews_algolia',
        publishedAt: h.created_at ?? null,
        contentType: mode === 'news' ? 'news' : 'web',
        rawRank: idx + 1
      }));
  }

  private async queryMdn(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://developer.mozilla.org/api/v1/search');
    url.searchParams.set('q', query);
    url.searchParams.set('locale', 'en-US');

    const data = await this.fetchJson<{
      documents?: Array<{
        title?: string;
        mdn_url?: string;
        summary?: string;
      }>;
    }>(url.toString(), signal);

    return (data.documents ?? [])
      .slice(0, 5)
      .filter((d) => Boolean(d.title && d.mdn_url))
      .map((d, idx) => ({
        title: `${d.title} — MDN Web Docs`,
        url: `https://developer.mozilla.org${d.mdn_url}`,
        snippet: stripHtmlAndEntities(d.summary || d.title || ''),
        sourceProvider: 'mdn_docs_api',
        contentType: 'docs',
        language: 'en',
        rawRank: idx + 1
      }));
  }

  private async queryStackOverflow(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://api.stackexchange.com/2.3/search/advanced');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('sort', 'relevance');
    url.searchParams.set('site', 'stackoverflow');
    url.searchParams.set('pagesize', '5');
    url.searchParams.set('q', query);

    const data = await this.fetchJson<{
      items?: Array<{
        title?: string;
        link?: string;
        score?: number;
        answer_count?: number;
        is_answered?: boolean;
        tags?: string[];
        last_activity_date?: number;
      }>;
    }>(url.toString(), signal);

    return (data.items ?? [])
      .filter((item) => Boolean(item.title && item.link))
      .map((item, idx) => ({
        title: stripHtmlAndEntities(item.title || ''),
        url: item.link || '',
        snippet: `Stack Overflow Q&A • ${item.answer_count ?? 0} answer(s)${item.is_answered ? ' (accepted/answered)' : ''} • Score ${item.score ?? 0}${item.tags?.length ? ` • Tags: ${item.tags.slice(0, 4).join(', ')}` : ''}`,
        sourceProvider: 'stackoverflow_api',
        publishedAt: item.last_activity_date ? new Date(item.last_activity_date * 1000).toISOString() : null,
        contentType: 'docs',
        rawRank: idx + 1
      }));
  }

  private async queryGitHubRepos(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://api.github.com/search/repositories');
    url.searchParams.set('q', query);
    url.searchParams.set('per_page', '5');

    const data = await this.fetchJson<{
      items?: Array<{
        full_name?: string;
        html_url?: string;
        description?: string | null;
        stargazers_count?: number;
        language?: string | null;
        updated_at?: string;
      }>;
    }>(url.toString(), signal);

    return (data.items ?? [])
      .filter((r) => Boolean(r.full_name && r.html_url))
      .map((r, idx) => ({
        title: `${r.full_name} — GitHub`,
        url: r.html_url || '',
        snippet: `${stripHtmlAndEntities(r.description || 'Open-source repository on GitHub.')} (${r.stargazers_count ?? 0} stars${r.language ? `, ${r.language}` : ''})`,
        sourceProvider: 'github_repos_api',
        publishedAt: r.updated_at ?? null,
        contentType: 'docs',
        rawRank: idx + 1
      }));
  }

  private async queryArxiv(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://export.arxiv.org/api/query');
    url.searchParams.set('search_query', `all:${query}`);
    url.searchParams.set('start', '0');
    url.searchParams.set('max_results', '5');

    const res = await this.fetchFn(url.toString(), {
      signal,
      headers: {
        Accept: 'application/atom+xml, text/xml',
        'User-Agent': USER_AGENT
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    const entries: RawSearchCandidate[] = [];
    const entryRx = /<entry>([\s\S]*?)<\/entry>/gi;
    let m: RegExpExecArray | null;
    while ((m = entryRx.exec(xml)) !== null) {
      const block = m[1];
      const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(block);
      const idMatch = /<id>([\s\S]*?)<\/id>/i.exec(block);
      const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(block);
      const publishedMatch = /<published>([\s\S]*?)<\/published>/i.exec(block);
      if (!titleMatch || !idMatch) continue;
      entries.push({
        title: `${stripHtmlAndEntities(titleMatch[1])} — arXiv`,
        url: idMatch[1].trim().replace(/^http:\/\//, 'https://'),
        snippet: stripHtmlAndEntities(summaryMatch?.[1] || '').slice(0, 320),
        sourceProvider: 'arxiv_api',
        publishedAt: publishedMatch?.[1]?.trim() ?? null,
        contentType: 'research',
        rawRank: entries.length + 1
      });
    }
    return entries;
  }

  private async querySearxng(
    endpointBase: string,
    query: string,
    mode: SearchMode,
    filters: SearchFilterOptions | undefined,
    signal: AbortSignal
  ): Promise<RawSearchCandidate[]> {
    const cleanBase = endpointBase.replace(/\/+$/, '');
    const url = new URL(cleanBase.endsWith('/search') ? cleanBase : `${cleanBase}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    if (mode === 'news') url.searchParams.set('categories', 'news');
    if (filters?.timeRange && filters.timeRange !== 'any') {
      url.searchParams.set('time_range', filters.timeRange);
    }

    const data = await this.fetchJson<{
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        publishedDate?: string | null;
      }>;
    }>(url.toString(), signal);

    return (data.results ?? [])
      .slice(0, 12)
      .filter((r) => Boolean(r.title && r.url))
      .map((r, idx) => ({
        title: stripHtmlAndEntities(r.title || ''),
        url: r.url || '',
        snippet: stripHtmlAndEntities(r.content || r.title || '').slice(0, 320),
        sourceProvider: 'searxng_custom',
        publishedAt: r.publishedDate ?? null,
        contentType: mode === 'news' ? 'news' : mode === 'docs' ? 'docs' : 'web',
        rawRank: idx + 1
      }));
  }

  private async queryBraveWeb(
    apiKey: string,
    query: string,
    mode: SearchMode,
    filters: SearchFilterOptions | undefined,
    signal: AbortSignal
  ): Promise<RawSearchCandidate[]> {
    const endpoint =
      mode === 'news'
        ? 'https://api.search.brave.com/res/v1/news/search'
        : 'https://api.search.brave.com/res/v1/web/search';
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', '15');
    if (filters?.timeRange && filters.timeRange !== 'any') {
      const freshnessMap: Record<string, string> = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };
      if (freshnessMap[filters.timeRange]) url.searchParams.set('freshness', freshnessMap[filters.timeRange]);
    }
    const res = await this.fetchFn(url.toString(), {
      signal,
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> };
      results?: Array<{ title?: string; url?: string; description?: string; age?: string }>;
    };
    const items = data.web?.results ?? data.results ?? [];
    return items
      .filter((r) => Boolean(r.url && r.title))
      .map((r, idx) => ({
        title: stripHtmlAndEntities(r.title || ''),
        url: r.url || '',
        snippet: stripHtmlAndEntities(r.description || ''),
        sourceProvider: 'brave_web_api',
        publishedAt: r.age ?? null,
        contentType: mode === 'news' ? 'news' : mode === 'docs' ? 'docs' : 'web',
        rawRank: idx + 1
      }));
  }

  private async queryWikipediaSummary(title: string, signal: AbortSignal): Promise<InstantAnswerPayload | null> {
    const slug = encodeURIComponent(title.replace(/ /g, '_'));
    const data = await this.fetchJson<{
      title?: string;
      description?: string;
      extract?: string;
      thumbnail?: { source?: string };
      content_urls?: { desktop?: { page?: string } };
      type?: string;
    }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, signal);

    if (!data.extract || data.type === 'disambiguation') return null;
    return {
      kind: 'entity',
      title: data.title || title,
      subtitle: data.description,
      summary: data.extract.slice(0, 420),
      url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${slug}`,
      source: 'Wikipedia',
      thumbnailUrl: data.thumbnail?.source
    };
  }

  private async queryMarginalia(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = `https://api.marginalia.nu/public/search/${encodeURIComponent(query)}?count=8`;
    const data = await this.fetchJson<{
      results?: Array<{ url?: string; title?: string; description?: string }>;
    }>(url, signal);

    return (data.results ?? [])
      .filter((r) => Boolean(r.url && r.title))
      .map((r, idx) => ({
        title: stripHtmlAndEntities(r.title || ''),
        url: r.url || '',
        snippet: stripHtmlAndEntities(r.description || r.title || '').slice(0, 320),
        sourceProvider: 'marginalia_api',
        contentType: 'web',
        rawRank: idx + 1
      }));
  }

  private async queryOpenAlex(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://api.openalex.org/works');
    url.searchParams.set('search', query);
    url.searchParams.set('per-page', '5');

    const data = await this.fetchJson<{
      results?: Array<{
        id?: string;
        doi?: string | null;
        title?: string;
        publication_date?: string;
        cited_by_count?: number;
        abstract_inverted_index?: Record<string, number[]> | null;
      }>;
    }>(url.toString(), signal);

    return (data.results ?? [])
      .filter((w) => Boolean(w.title && (w.doi || w.id)))
      .map((w, idx) => {
        let abstractText = '';
        if (w.abstract_inverted_index) {
          const words: string[] = [];
          for (const [word, positions] of Object.entries(w.abstract_inverted_index)) {
            for (const pos of positions) {
              if (pos < 80) words[pos] = word;
            }
          }
          abstractText = words.filter(Boolean).join(' ');
        }
        return {
          title: `${stripHtmlAndEntities(w.title || '')} — OpenAlex`,
          url: w.doi || w.id || '',
          snippet:
            abstractText ||
            `Scholarly work (${w.cited_by_count ?? 0} citations${w.publication_date ? `, ${w.publication_date}` : ''}).`,
          sourceProvider: 'openalex_api',
          publishedAt: w.publication_date ?? null,
          contentType: 'research',
          rawRank: idx + 1
        };
      });
  }

  private async queryDictionary(
    word: string,
    signal: AbortSignal
  ): Promise<{ candidates: RawSearchCandidate[]; instant: InstantAnswerPayload | null }> {
    const clean = encodeURIComponent(word.toLowerCase());
    const data = await this.fetchJson<
      Array<{
        word?: string;
        phonetic?: string;
        meanings?: Array<{
          partOfSpeech?: string;
          definitions?: Array<{ definition?: string; example?: string }>;
        }>;
      }>
    >(`https://api.dictionaryapi.dev/api/v2/entries/en/${clean}`, signal);

    const entry = data?.[0];
    const firstMeaning = entry?.meanings?.[0];
    const firstDef = firstMeaning?.definitions?.[0]?.definition;
    if (!entry || !firstDef) return { candidates: [], instant: null };

    const facts = (entry.meanings ?? []).slice(0, 3).map((m) => ({
      label: m.partOfSpeech || 'meaning',
      value: m.definitions?.[0]?.definition || ''
    })).filter((f) => Boolean(f.value));

    const instant: InstantAnswerPayload = {
      kind: 'definition',
      title: entry.word || word,
      subtitle: [entry.phonetic, firstMeaning?.partOfSpeech].filter(Boolean).join(' • '),
      summary: firstDef,
      url: `https://en.wiktionary.org/wiki/${clean}`,
      source: 'Dictionary',
      facts
    };
    return {
      instant,
      candidates: [
        {
          title: `${entry.word} — Wiktionary / Definition`,
          url: `https://en.wiktionary.org/wiki/${clean}`,
          snippet: `${firstMeaning?.partOfSpeech ? `(${firstMeaning.partOfSpeech}) ` : ''}${firstDef}`,
          sourceProvider: 'dictionary_api',
          contentType: 'web',
          rawRank: 1
        }
      ]
    };
  }

  private async queryBingRss(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://www.bing.com/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'rss');

    const res = await this.fetchFn(url.toString(), {
      signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': USER_AGENT
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    const items: RawSearchCandidate[] = [];
    const itemRx = /<item>([\s\S]*?)<\/item>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRx.exec(xml)) !== null) {
      const block = m[1];
      const title = stripHtmlAndEntities(extractXmlTag(block, 'title'));
      const link = stripHtmlAndEntities(extractXmlTag(block, 'link'));
      const desc = stripHtmlAndEntities(extractXmlTag(block, 'description'));
      const pubDate = extractXmlTag(block, 'pubDate');
      if (!title || !link || !/^https?:\/\//i.test(link)) continue;
      items.push({
        title,
        url: link,
        snippet: desc || title,
        sourceProvider: 'bing_web_rss',
        publishedAt: pubDate || null,
        contentType: 'web',
        rawRank: items.length + 1
      });
      if (items.length >= 10) break;
    }
    return items;
  }

  private async queryGoogleNewsRss(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://news.google.com/rss/search');
    url.searchParams.set('q', query);
    url.searchParams.set('hl', 'en');
    url.searchParams.set('gl', 'US');
    url.searchParams.set('ceid', 'US:en');

    const res = await this.fetchFn(url.toString(), {
      signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': USER_AGENT
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    const items: RawSearchCandidate[] = [];
    const itemRx = /<item>([\s\S]*?)<\/item>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRx.exec(xml)) !== null) {
      const block = m[1];
      const title = stripHtmlAndEntities(extractXmlTag(block, 'title'));
      const link = stripHtmlAndEntities(extractXmlTag(block, 'link'));
      const sourceName = stripHtmlAndEntities(extractXmlTag(block, 'source'));
      const desc = stripHtmlAndEntities(extractXmlTag(block, 'description'));
      const pubDate = extractXmlTag(block, 'pubDate');
      if (!title || !link || !/^https?:\/\//i.test(link)) continue;
      items.push({
        title,
        url: link,
        snippet: desc && desc !== title ? desc : `${sourceName ? `${sourceName} — ` : ''}${title}`,
        sourceProvider: 'google_news_rss',
        publishedAt: pubDate || null,
        contentType: 'news',
        rawRank: items.length + 1
      });
      if (items.length >= 8) break;
    }
    return items;
  }

  private async queryWikimediaImages(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', query);
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', '16');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|mime');
    url.searchParams.set('iiurlwidth', '480');
    url.searchParams.set('format', 'json');

    const data = await this.fetchJson<{
      query?: {
        pages?: Record<string, {
          title?: string;
          imageinfo?: Array<{ thumburl?: string; url?: string; descriptionurl?: string; mime?: string }>;
        }>;
      };
    }>(url.toString(), signal);

    const pages = Object.values(data.query?.pages ?? {});
    const out: RawSearchCandidate[] = [];
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      const thumb = info?.thumburl || info?.url;
      const mime = info?.mime || '';
      if (!thumb || !/^image\/(jpeg|png|webp|gif)/i.test(mime)) continue;
      const cleanTitle = (p.title || 'Image').replace(/^File:/i, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      out.push({
        title: cleanTitle,
        url: info?.descriptionurl || info?.url || thumb,
        snippet: `Wikimedia Commons (${mime.replace('image/', '').toUpperCase()})`,
        sourceProvider: 'wikimedia_images',
        thumbnailUrl: thumb,
        mediaUrl: info?.url || thumb,
        contentType: 'web',
        rawRank: out.length + 1
      });
    }
    return out;
  }

  private async queryWikipediaImages(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', query);
    url.searchParams.set('gsrlimit', '10');
    url.searchParams.set('prop', 'pageimages|info');
    url.searchParams.set('piprop', 'thumbnail');
    url.searchParams.set('pithumbsize', '480');
    url.searchParams.set('inprop', 'url');
    url.searchParams.set('format', 'json');

    const data = await this.fetchJson<{
      query?: {
        pages?: Record<string, { title?: string; fullurl?: string; thumbnail?: { source?: string } }>;
      };
    }>(url.toString(), signal);

    const pages = Object.values(data.query?.pages ?? {});
    const out: RawSearchCandidate[] = [];
    for (const p of pages) {
      if (!p.thumbnail?.source || !p.title) continue;
      out.push({
        title: `${p.title} — Wikipedia`,
        url: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
        snippet: `Article image from Wikipedia`,
        sourceProvider: 'wikipedia_images',
        thumbnailUrl: p.thumbnail.source,
        mediaUrl: p.thumbnail.source,
        contentType: 'web',
        rawRank: out.length + 1
      });
    }
    return out;
  }

  private async queryBraveImages(apiKey: string, query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://api.search.brave.com/res/v1/images/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '15');
    const res = await this.fetchFn(url.toString(), {
      signal,
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; source?: string; thumbnail?: { src?: string }; properties?: { url?: string } }>;
    };
    return (data.results ?? [])
      .filter((r) => Boolean(r.thumbnail?.src && r.url))
      .map((r, idx) => ({
        title: stripHtmlAndEntities(r.title || r.source || 'Image'),
        url: r.url || '',
        snippet: r.source || '',
        sourceProvider: 'brave_images_api',
        thumbnailUrl: r.thumbnail?.src || null,
        mediaUrl: r.properties?.url || r.thumbnail?.src || null,
        contentType: 'web',
        rawRank: idx + 1
      }));
  }

  private async queryDailymotionVideos(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://api.dailymotion.com/videos');
    url.searchParams.set('search', query);
    url.searchParams.set('fields', 'id,title,url,thumbnail_480_url,duration,owner.screenname,created_time,description');
    url.searchParams.set('limit', '12');

    const data = await this.fetchJson<{
      list?: Array<{
        id: string;
        title?: string;
        url?: string;
        thumbnail_480_url?: string;
        duration?: number;
        'owner.screenname'?: string;
        created_time?: number;
        description?: string;
      }>;
    }>(url.toString(), signal);

    return (data.list ?? [])
      .filter((v) => Boolean(v.title && v.url))
      .map((v, idx) => ({
        title: stripHtmlAndEntities(v.title || ''),
        url: v.url || '',
        snippet: stripHtmlAndEntities(v.description || `${v['owner.screenname'] || 'Dailymotion'} video`).slice(0, 240),
        sourceProvider: 'dailymotion_api',
        thumbnailUrl: v.thumbnail_480_url || null,
        mediaUrl: v.url || null,
        durationSeconds: typeof v.duration === 'number' ? v.duration : null,
        publishedAt: v.created_time ? new Date(v.created_time * 1000).toISOString() : null,
        contentType: 'web',
        rawRank: idx + 1
      }));
  }

  private async queryArchiveVideos(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://archive.org/advancedsearch.php');
    url.searchParams.set('q', `(${query}) AND mediatype:movies`);
    url.searchParams.set('rows', '6');
    url.searchParams.set('output', 'json');

    const data = await this.fetchJson<{
      response?: {
        docs?: Array<{ identifier?: string; title?: string; description?: string; publicdate?: string; creator?: string }>;
      };
    }>(url.toString(), signal);

    return (data.response?.docs ?? [])
      .filter((d) => Boolean(d.identifier && d.title))
      .map((d, idx) => ({
        title: stripHtmlAndEntities(String(d.title || '')),
        url: `https://archive.org/details/${encodeURIComponent(d.identifier!)}`,
        snippet: stripHtmlAndEntities(String(d.description || d.creator || 'Internet Archive video')).slice(0, 240),
        sourceProvider: 'archive_videos_api',
        thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(d.identifier!)}`,
        publishedAt: d.publicdate ?? null,
        contentType: 'web',
        rawRank: idx + 1
      }));
  }

  private async queryBraveVideos(apiKey: string, query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://api.search.brave.com/res/v1/videos/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '12');
    const res = await this.fetchFn(url.toString(), {
      signal,
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; description?: string; age?: string; thumbnail?: { src?: string }; video?: { duration?: string } }>;
    };
    return (data.results ?? [])
      .filter((v) => Boolean(v.title && v.url))
      .map((v, idx) => ({
        title: stripHtmlAndEntities(v.title || ''),
        url: v.url || '',
        snippet: stripHtmlAndEntities(v.description || '').slice(0, 240),
        sourceProvider: 'brave_videos_api',
        thumbnailUrl: v.thumbnail?.src || null,
        publishedAt: v.age ?? null,
        contentType: 'web',
        rawRank: idx + 1
      }));
  }

  private async queryOsmNominatim(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '10');

    const data = await this.fetchJson<
      Array<{
        place_id: number;
        lat: string;
        lon: string;
        display_name: string;
        name?: string;
        category?: string;
        type?: string;
      }>
    >(url.toString(), signal);

    return (data ?? [])
      .filter((p) => Boolean(p.lat && p.lon && p.display_name))
      .map((p, idx) => {
        const lat = Number(p.lat);
        const lon = Number(p.lon);
        const title = p.name || p.display_name.split(',')[0] || query;
        return {
          title,
          url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`,
          snippet: p.display_name,
          sourceProvider: 'osm_nominatim',
          coordinates: {
            lat,
            lon,
            displayName: p.display_name,
            category: [p.category, p.type].filter(Boolean).join(' • ')
          },
          contentType: 'web',
          rawRank: idx + 1
        };
      });
  }

  private async queryShoppingRss(query: string, signal: AbortSignal): Promise<RawSearchCandidate[]> {
    const priceRx = /(?:₹|rs\.?|\$|€|£)\s?\d[\d,]*(?:\.\d{1,2})?/i;
    const rawItems = await this.queryBingRss(`${query} price buy online`, signal);
    return rawItems.map((item, idx) => {
      const m = priceRx.exec(`${item.title} ${item.snippet}`);
      return {
        ...item,
        sourceProvider: 'bing_shopping_rss',
        priceText: m ? m[0].replace(/\s+/g, '') : null,
        rawRank: idx + 1
      };
    });
  }
}

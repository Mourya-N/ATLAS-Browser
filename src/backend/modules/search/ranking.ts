import { createHash } from 'node:crypto';
import net from 'node:net';
import type {
  NormalizedSearchResult,
  SearchFilterOptions,
  SearchQueryUnderstanding,
  SearchResultOrigin
} from '@shared/types';
import { computeLocalEmbedding, cosineSimilarity, tokenizeText } from '@shared/text-utils';
import { isPrivateOrReservedIp } from '../../security/ssrf-guard';
import type { RawSearchCandidate } from './provider';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'yclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'si',
  'ref_src', '_hsenc', '_hsmi', 'spm', 'ref'
]);

const HIGH_AUTHORITY_DOMAINS = [
  '.gov', '.edu', 'postgresql.org', 'electronjs.org', 'developer.mozilla.org',
  'owasp.org', 'cheatsheetseries.owasp.org', 'w3.org', 'ietf.org', 'rfc-editor.org',
  'nodejs.org', 'kubernetes.io', 'github.com', 'arxiv.org', 'sqlite.org',
  'en.wikipedia.org', 'python.org', 'rust-lang.org', 'typescriptlang.org', 'react.dev'
];

const SPAM_BOILERPLATE_RE =
  /\b(404\s+not\s+found|403\s+forbidden|access\s+denied|just\s+a\s+moment|enable\s+javascript\s+and\s+cookies|captcha|buy\s+cheap\s+online|click\s+here\s+to\s+claim)\b/i;

const EXPLICIT_CONTENT_RE =
  /\b(porn|xxx|nsfw|onlyfans|escort|casino\s+bonus|gambling\s+slots)\b/i;

const TIME_RANGE_MAX_AGE_MS: Record<string, number> = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 31 * 86_400_000,
  year: 366 * 86_400_000
};

function inferVideoPlatform(
  domain: string,
  explicit?: RawSearchCandidate['videoPlatform']
): RawSearchCandidate['videoPlatform'] {
  if (explicit) return explicit;
  const d = domain.toLowerCase();
  if (d === 'youtube.com' || d.endsWith('.youtube.com') || d === 'youtu.be') return 'youtube';
  if (d === 'instagram.com' || d.endsWith('.instagram.com')) return 'instagram';
  if (d === 'facebook.com' || d.endsWith('.facebook.com') || d === 'fb.watch' || d === 'fb.com') return 'facebook';
  if (d === 'dailymotion.com' || d.endsWith('.dailymotion.com')) return 'dailymotion';
  if (d === 'archive.org' || d.endsWith('.archive.org')) return 'archive';
  return null;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};

function extractEmbeddedDateIso(text: string): string | null {
  const iso = /\b(202[0-9]-\d{2}-\d{2})\b/.exec(text);
  if (iso) {
    const t = Date.parse(iso[1]);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  const dmy = /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(202[0-9])\b/i.exec(text);
  if (dmy) {
    const m = MONTH_NAMES[dmy[2].toLowerCase()];
    if (m !== undefined) {
      const ts = Date.UTC(Number(dmy[3]), m, Number(dmy[1]));
      return new Date(ts).toISOString();
    }
  }
  const mdy = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(202[0-9])\b/i.exec(text);
  if (mdy) {
    const m = MONTH_NAMES[mdy[1].toLowerCase()];
    if (m !== undefined) {
      const ts = Date.UTC(Number(mdy[3]), m, Number(mdy[2]));
      return new Date(ts).toISOString();
    }
  }
  return null;
}

function getRootDomain(host: string): string {
  const clean = host.toLowerCase().replace(/^www\./, '');
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;
  const lastTwo = parts.slice(-2).join('.');
  if (/^(co|com|org|net|gov|edu)\.[a-z]{2}$/.test(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

export function classifyResultOrigin(sourceProvider: string): SearchResultOrigin {
  if (sourceProvider === 'lavray_first_party_index') return 'lavray_index';
  if (sourceProvider === 'open_tabs') return 'open_tab';
  if (
    sourceProvider === 'lavray_knowledge' ||
    sourceProvider === 'local_bookmarks' ||
    sourceProvider === 'local_memory' ||
    sourceProvider === 'local_research'
  ) {
    return 'personal_knowledge';
  }
  return 'external_provider';
}

export function sanitizeAndCanonicalizeUrl(rawUrl: string, allowLocalTestUrls = false): {
  valid: boolean;
  url: string;
  canonicalUrl: string;
  dedupKey: string;
  displayUrl: string;
  domain: string;
  rootDomain: string;
  isHttps: boolean;
} {
  if (rawUrl.startsWith('lavray://')) {
    return {
      valid: true,
      url: rawUrl,
      canonicalUrl: rawUrl,
      dedupKey: rawUrl,
      displayUrl: rawUrl,
      domain: 'lavray.local',
      rootDomain: 'lavray.local',
      isHttps: true
    };
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, url: rawUrl, canonicalUrl: '', dedupKey: '', displayUrl: '', domain: '', rootDomain: '', isHttps: false };
    }
    const host = parsed.hostname.toLowerCase();
    const isLocalTestHost = allowLocalTestUrls && (host === '127.0.0.1' || host === 'localhost');
    if (
      !host ||
      (!isLocalTestHost &&
        (host === 'localhost' ||
          host.endsWith('.localhost') ||
          host.endsWith('.internal') ||
          host === 'metadata.goog' ||
          (net.isIP(host) !== 0 && isPrivateOrReservedIp(host))))
    ) {
      return { valid: false, url: rawUrl, canonicalUrl: '', dedupKey: '', displayUrl: '', domain: '', rootDomain: '', isHttps: false };
    }

    const clean = new URL(parsed.toString());
    clean.hash = '';
    for (const key of Array.from(clean.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        clean.searchParams.delete(key);
      }
    }
    clean.searchParams.sort();
    if (clean.pathname.length > 1 && clean.pathname.endsWith('/')) {
      clean.pathname = clean.pathname.slice(0, -1);
    }

    const dedupHost = host.replace(/^www\./, '');
    const dedupPath = clean.pathname.replace(/\/index\.(html?|php|aspx?)$/i, '') || '/';
    const dedupKey = `${dedupHost}${dedupPath === '/' ? '' : dedupPath}${clean.search}`;
    const displayPath = clean.pathname === '/' ? '' : clean.pathname;

    return {
      valid: true,
      url: parsed.toString(),
      canonicalUrl: clean.toString(),
      dedupKey,
      displayUrl: `${host}${displayPath}`.slice(0, 90),
      domain: host,
      rootDomain: getRootDomain(host),
      isHttps: parsed.protocol === 'https:'
    };
  } catch {
    return { valid: false, url: rawUrl, canonicalUrl: '', dedupKey: '', displayUrl: '', domain: '', rootDomain: '', isHttps: false };
  }
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const item of a) {
    if (b.has(item)) intersect += 1;
  }
  return intersect / (a.size + b.size - intersect);
}

function assessLowQualityPenalty(title: string, snippet: string, domain: string, url: string): { drop: boolean; penalty: number } {
  const combined = `${title} ${snippet}`;
  if (!title || title.length < 2) return { drop: true, penalty: 1 };
  if (SPAM_BOILERPLATE_RE.test(combined)) return { drop: true, penalty: 1 };

  let penalty = 0;
  // Excessive hyphenated spammy domain
  const hyphenCount = (domain.match(/-/g) || []).length;
  if (hyphenCount >= 4) penalty += 0.25;

  // Keyword stuffing detection (low unique-token diversity)
  const words = tokenizeText(combined);
  if (words.length >= 10) {
    const uniqueRatio = new Set(words).size / words.length;
    if (uniqueRatio < 0.42) penalty += 0.3;
  }

  // Overly deep URL path spam
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean);
    if (segs.length > 7) penalty += 0.12;
  } catch {
    // ignore for lavray://
  }

  // Very thin snippet
  if (snippet.length < 20) penalty += 0.12;

  return { drop: false, penalty: Math.min(0.55, penalty) };
}

function computeBm25FieldScore(
  queryTokens: string[],
  idfMap: Map<string, number>,
  titleTokens: string[],
  urlTokens: string[],
  snippetTokens: string[]
): { score: number; matchedRatio: number; titleRatio: number } {
  if (queryTokens.length === 0) return { score: 0.4, matchedRatio: 0, titleRatio: 0 };

  const tfMap = new Map<string, number>();
  const add = (toks: string[], weight: number) => {
    for (const t of toks) tfMap.set(t, (tfMap.get(t) ?? 0) + weight);
  };
  add(titleTokens, 3.0);
  add(urlTokens, 1.8);
  add(snippetTokens, 1.0);

  const titleSet = new Set(titleTokens);
  const docLen = Math.max(1, titleTokens.length * 3 + urlTokens.length * 1.8 + snippetTokens.length);
  const avgDl = 36;
  const k1 = 1.2;
  const b = 0.75;

  let bm25Raw = 0;
  let maxIdfSum = 0;
  let matched = 0;
  let titleHits = 0;

  for (const qt of queryTokens) {
    const idf = idfMap.get(qt) ?? 1.0;
    maxIdfSum += idf;
    const tf = tfMap.get(qt) ?? 0;
    if (tf > 0) {
      matched += 1;
      const sat = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docLen) / avgDl));
      bm25Raw += idf * sat;
    }
    if (titleSet.has(qt)) titleHits += 1;
  }

  const normBm25 = maxIdfSum > 0 ? Math.min(1, bm25Raw / (maxIdfSum * 1.35)) : 0;
  const matchedRatio = matched / queryTokens.length;
  const titleRatio = titleHits / queryTokens.length;
  const score = Math.min(1, normBm25 * 0.62 + matchedRatio * 0.2 + titleRatio * 0.18);
  return { score, matchedRatio, titleRatio };
}

const PROVIDER_RRF_WEIGHTS: Record<string, number> = {
  brave_web_api: 1.25,
  brave_images_api: 1.25,
  brave_videos_api: 1.25,
  youtube_videos: 1.28,
  instagram_videos: 1.24,
  facebook_videos: 1.24,
  yahoo_videos: 1.12,
  searxng_custom: 1.2,
  lavray_first_party_index: 1.2,
  bing_web_rss: 1.2,
  bing_shopping_rss: 1.2,
  google_news_rss: 1.15,
  osm_nominatim: 1.2,
  wikimedia_images: 1.15,
  wikipedia_images: 1.1,
  dailymotion_api: 1.12,
  archive_videos_api: 0.98,
  mdn_docs_api: 1.15,
  wikipedia_api: 1.15,
  marginalia_api: 1.05,
  duckduckgo_instant: 1.0,
  openalex_api: 1.05,
  arxiv_api: 1.0,
  stackoverflow_api: 1.0,
  github_repos_api: 1.0,
  hackernews_algolia: 0.9
};
const RRF_K = 60;

export class SearchRankingPipeline {
  public normalizeAndRank(params: {
    candidates: RawSearchCandidate[];
    understanding: SearchQueryUnderstanding;
    filters?: SearchFilterOptions;
    allowLocalTestUrls?: boolean;
  }): {
    results: NormalizedSearchResult[];
    totalBeforeDedup: number;
    duplicatesRemoved: number;
  } {
    const now = Date.now();
    const coreTokens =
      params.understanding.coreTokens && params.understanding.coreTokens.length > 0
        ? params.understanding.coreTokens
        : Array.from(new Set(tokenizeText(params.understanding.normalizedQuery)));
    const expandedTokens = params.understanding.expandedTerms
      .flatMap((t) => tokenizeText(t))
      .filter((t) => !coreTokens.includes(t));

    const exactPhrases = (params.understanding.exactPhrases ?? []).map((p) => p.toLowerCase());
    const excludedTerms = params.understanding.excludedTerms ?? [];
    const allowedDomains = [
      ...(params.filters?.domains ?? []),
      ...(params.understanding.siteFilters ?? [])
    ].map((d) => d.toLowerCase().trim()).filter(Boolean);
    const blockedDomains = [
      ...(params.filters?.excludeDomains ?? []),
      ...(params.understanding.excludeDomains ?? [])
    ].map((d) => d.toLowerCase().trim()).filter(Boolean);

    const safeSearch = params.filters?.safeSearch ?? 'moderate';
    const timeRange = params.filters?.timeRange;
    const maxAgeMs = timeRange && timeRange !== 'any' ? TIME_RANGE_MAX_AGE_MS[timeRange] : undefined;

    const queryEmbedding = computeLocalEmbedding(params.understanding.normalizedQuery || params.understanding.originalQuery);

    // Pre-pass: validate URLs, enforce filters/safety, tokenize for IDF across candidate pool
    interface PreparedCandidate {
      raw: RawSearchCandidate;
      check: ReturnType<typeof sanitizeAndCanonicalizeUrl>;
      title: string;
      snippet: string;
      titleTokens: string[];
      urlTokens: string[];
      snippetTokens: string[];
      spamPenalty: number;
      isHttps: boolean;
    }

    const prepared: PreparedCandidate[] = [];
    const dfCounts = new Map<string, number>();

    for (const raw of params.candidates) {
      const check = sanitizeAndCanonicalizeUrl(raw.url, Boolean(params.allowLocalTestUrls));
      if (!check.valid) continue;

      if (allowedDomains.length > 0) {
        const match = allowedDomains.some((d) => check.domain === d || check.domain.endsWith(`.${d}`));
        if (!match) continue;
      }
      if (blockedDomains.length > 0) {
        const blocked = blockedDomains.some((d) => check.domain === d || check.domain.endsWith(`.${d}`));
        if (blocked) continue;
      }

      const title = raw.title.replace(/\s+/g, ' ').trim();
      const snippet = raw.snippet.replace(/\s+/g, ' ').trim();
      const combinedLower = `${title} ${snippet}`.toLowerCase();

      if (excludedTerms.length > 0 && excludedTerms.some((term) => combinedLower.includes(term))) {
        continue;
      }
      if (safeSearch !== 'off' && EXPLICIT_CONTENT_RE.test(combinedLower)) {
        continue;
      }

      if (maxAgeMs && raw.publishedAt) {
        const ts = Date.parse(raw.publishedAt);
        if (!Number.isNaN(ts) && now - ts > maxAgeMs) {
          continue;
        }
      }

      const quality = assessLowQualityPenalty(title, snippet, check.domain, check.url);
      if (quality.drop) continue;

      const titleTokens = tokenizeText(title);
      const urlTokens = tokenizeText(check.displayUrl);
      const snippetTokens = tokenizeText(snippet);
      const docUnique = new Set([...titleTokens, ...urlTokens, ...snippetTokens]);
      for (const qt of coreTokens) {
        if (docUnique.has(qt)) dfCounts.set(qt, (dfCounts.get(qt) ?? 0) + 1);
      }

      prepared.push({
        raw,
        check,
        title,
        snippet,
        titleTokens,
        urlTokens,
        snippetTokens,
        spamPenalty: quality.penalty,
        isHttps: check.isHttps
      });
    }

    const N = Math.max(1, prepared.length);
    const idfMap = new Map<string, number>();
    for (const qt of coreTokens) {
      const df = dfCounts.get(qt) ?? 0;
      idfMap.set(qt, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
    }

    // Stage 1 scoring
    const validCandidates: Array<
      NormalizedSearchResult & {
        _dedupKey: string;
        _rootDomain: string;
        _isHttps: boolean;
        _rrfContrib: number;
      }
    > = [];
    const normalizedPhrase = params.understanding.normalizedQuery.toLowerCase().trim();

    for (const item of prepared) {
      const { raw, check, title, snippet, titleTokens, urlTokens, snippetTokens, spamPenalty } = item;
      const titleLower = title.toLowerCase();
      const docLower = `${title} ${snippet}`.toLowerCase();

      const bm25 = computeBm25FieldScore(coreTokens, idfMap, titleTokens, urlTokens, snippetTokens);

      // Secondary recall bonus from synonym expansions (strictly capped so synonyms never beat exact matches)
      let expandedBonus = 0;
      if (expandedTokens.length > 0) {
        const docSet = new Set([...titleTokens, ...snippetTokens]);
        const expHits = expandedTokens.filter((et) => docSet.has(et)).length;
        expandedBonus = Math.min(0.14, (expHits / expandedTokens.length) * 0.14);
      }

      // Exact phrase matching
      let exactPhraseScore = 0;
      if (exactPhrases.length > 0) {
        const matchedPhrases = exactPhrases.filter((ph) => docLower.includes(ph)).length;
        exactPhraseScore = matchedPhrases / exactPhrases.length;
      } else if (normalizedPhrase.includes(' ') && docLower.includes(normalizedPhrase)) {
        exactPhraseScore = titleLower.includes(normalizedPhrase) ? 1.0 : 0.7;
      }

      const lexical = Math.min(1, bm25.score + expandedBonus + exactPhraseScore * 0.15);
      const semantic = cosineSimilarity(queryEmbedding, computeLocalEmbedding(`${title} ${snippet}`));

      // Strict topical relevance guard: eliminate completely off-topic external hits (prevents upstream noise/drift)
      const origin = classifyResultOrigin(raw.sourceProvider);
      if (
        origin === 'external_provider' &&
        !raw.coordinates &&
        coreTokens.length >= 2 &&
        bm25.matchedRatio === 0 &&
        expandedBonus === 0 &&
        exactPhraseScore === 0 &&
        semantic < 0.4
      ) {
        continue;
      }

      // Intent & mode alignment
      let intentScore = 0.4;
      const ct = raw.contentType || 'web';
      if (params.understanding.recommendedMode === 'docs' && ct === 'docs') intentScore = 1.0;
      else if (params.understanding.recommendedMode === 'news' && ct === 'news') intentScore = 1.0;
      else if (
        params.understanding.recommendedMode === 'personal_knowledge' &&
        (ct === 'knowledge' || ct === 'bookmark' || ct === 'research' || ct === 'tab')
      ) {
        intentScore = 1.0;
      } else if (ct === 'tab' || ct === 'knowledge') {
        intentScore = 0.7;
      }

      // Navigational official-domain boost
      let navBoost = 0;
      if (params.understanding.intent === 'navigational') {
        const hostBase = check.rootDomain.split('.')[0];
        if (coreTokens.some((qt) => check.domain === qt || hostBase === qt || check.domain.includes(qt))) {
          navBoost = 0.22;
        }
      }

      // Source reliability gated on actual topical relevance (authority never rescues irrelevant pages)
      let rawAuthority = 0.48;
      if (HIGH_AUTHORITY_DOMAINS.some((d) => check.domain.endsWith(d) || check.domain === d)) {
        rawAuthority = 0.92;
      } else if (check.url.startsWith('https://')) {
        rawAuthority = 0.65;
      } else if (check.url.startsWith('lavray://')) {
        rawAuthority = 0.85;
      }
      const relevanceGate = Math.min(1, (lexical + semantic * 0.6) * 1.45);
      const authority = rawAuthority * relevanceGate;

      // Freshness decay & embedded date extraction (prevents stale pages from posing as today's/current answers)
      const effectivePublishedAt = raw.publishedAt || extractEmbeddedDateIso(`${title} ${snippet}`);
      let freshness = params.understanding.temporalIntent.hasTemporalConstraint ? 0.3 : 0.55;
      let temporalStalenessMultiplier = 1.0;
      if (effectivePublishedAt) {
        const ts = Date.parse(effectivePublishedAt);
        if (!Number.isNaN(ts)) {
          const ageDays = Math.max(0, (now - ts) / 86_400_000);
          const halfLifeDays =
            params.understanding.temporalIntent.hasTemporalConstraint || params.understanding.recommendedMode === 'news'
              ? 10
              : 120;
          freshness = Number((1 / (1 + ageDays / halfLifeDays)).toFixed(4));

          const pubYear = new Date(ts).getUTCFullYear();
          const mentionedYears = params.understanding.temporalIntent.yearMentions
            .map((y) => Number(y))
            .filter((y) => Number.isFinite(y));
          const maxYear = mentionedYears.length > 0 ? Math.max(...mentionedYears) : 0;
          if (
            (maxYear > 0 && pubYear < maxYear) ||
            ((params.understanding.temporalIntent.timeHint === 'today' ||
              params.understanding.temporalIntent.timeHint === 'recent') &&
              ageDays > 180)
          ) {
            temporalStalenessMultiplier = 0.52;
          }
        }
      }

      const rank = Math.max(1, raw.rawRank ?? 1);
      const providerWeight = PROVIDER_RRF_WEIGHTS[raw.sourceProvider] ?? 1.0;
      const rrfContrib = providerWeight / (RRF_K + rank);
      const rrfPrior = Math.min(1, rrfContrib / (1.25 / (RRF_K + 1)));

      const freshnessWeight = params.understanding.temporalIntent.hasTemporalConstraint ? 0.14 : 0.07;
      const lexicalWeight = params.understanding.temporalIntent.hasTemporalConstraint ? 0.33 : 0.39;

      let baseScore =
        lexical * lexicalWeight +
        semantic * 0.19 +
        intentScore * 0.12 +
        authority * 0.11 +
        freshness * freshnessWeight +
        rrfPrior * 0.08 +
        navBoost -
        spamPenalty;

      // Penalize multi-term queries where candidate covers <35% of core terms and weak semantic match
      if (coreTokens.length >= 3 && bm25.matchedRatio < 0.35 && expandedBonus === 0 && semantic < 0.35) {
        baseScore *= 0.6;
      }

      // Penalize stale documents on explicit temporal / today / year queries
      baseScore *= temporalStalenessMultiplier;

      // Penalize candidates missing explicit quoted phrases
      if (exactPhrases.length > 0 && exactPhraseScore === 0) {
        baseScore *= 0.45;
      }

      validCandidates.push({
        id: createHash('sha1').update(check.canonicalUrl).digest('hex').slice(0, 16),
        title,
        url: check.url,
        canonicalUrl: check.canonicalUrl,
        displayUrl: check.displayUrl,
        domain: check.domain,
        snippet,
        sourceProvider: raw.sourceProvider,
        sourceOrigin: origin,
        publishedAt: effectivePublishedAt ?? null,
        retrievedAt: now,
        contentType: ct,
        language: raw.language || params.understanding.language,
        favicon: raw.favicon ?? (check.url.startsWith('http') ? `${new URL(check.url).origin}/favicon.ico` : null),
        thumbnailUrl: raw.thumbnailUrl ?? null,
        mediaUrl: raw.mediaUrl ?? null,
        durationSeconds: raw.durationSeconds ?? null,
        videoPlatform: inferVideoPlatform(check.domain, raw.videoPlatform),
        priceText: raw.priceText ?? null,
        coordinates: raw.coordinates ?? null,
        relevanceScore: Number(Math.max(0, Math.min(1.5, baseScore)).toFixed(4)),
        scoreBreakdown: {
          lexical: Number(lexical.toFixed(3)),
          semantic: Number(semantic.toFixed(3)),
          intent: Number(intentScore.toFixed(3)),
          authority: Number(authority.toFixed(3)),
          freshness: Number(freshness.toFixed(3))
        },
        clusterCount: 1,
        _dedupKey: check.dedupKey,
        _rootDomain: check.rootDomain,
        _isHttps: check.isHttps,
        _rrfContrib: rrfContrib
      });
    }

    const totalBeforeDedup = validCandidates.length;

    // 2. Deduplicate by normalized URL key & near-duplicate content while accumulating RRF consensus
    const sortedInitial = [...validCandidates].sort((a, b) => {
      if (Math.abs(b.relevanceScore - a.relevanceScore) > 0.02) {
        return b.relevanceScore - a.relevanceScore;
      }
      if (a._isHttps !== b._isHttps) return a._isHttps ? -1 : 1;
      return b.snippet.length - a.snippet.length;
    });

    const deduped: Array<NormalizedSearchResult & { _rootDomain: string; _rrfSum: number; _providersSeen: Set<string> }> = [];
    const seenDedupKeys = new Map<string, number>();
    const keptTokenSets: Array<{ idx: number; tokens: Set<string>; titleTokens: Set<string> }> = [];

    for (const item of sortedInitial) {
      const existingByUrlIdx = seenDedupKeys.get(item._dedupKey);
      if (existingByUrlIdx !== undefined) {
        const parent = deduped[existingByUrlIdx];
        parent.clusterCount = (parent.clusterCount ?? 1) + 1;
        if (!parent._providersSeen.has(item.sourceProvider)) {
          parent._providersSeen.add(item.sourceProvider);
          parent._rrfSum += item._rrfContrib;
          // Consensus boost across independent providers via RRF
          parent.relevanceScore = Number(Math.min(1.5, parent.relevanceScore + item._rrfContrib * 3.5).toFixed(4));
        }
        if (item.snippet.length > parent.snippet.length) {
          parent.snippet = item.snippet;
        }
        if (!parent.thumbnailUrl && item.thumbnailUrl) parent.thumbnailUrl = item.thumbnailUrl;
        if (!parent.mediaUrl && item.mediaUrl) parent.mediaUrl = item.mediaUrl;
        if (parent.durationSeconds == null && item.durationSeconds != null) parent.durationSeconds = item.durationSeconds;
        if (!parent.videoPlatform && item.videoPlatform) parent.videoPlatform = item.videoPlatform;
        if (!parent.priceText && item.priceText) parent.priceText = item.priceText;
        if (!parent.coordinates && item.coordinates) parent.coordinates = item.coordinates;
        continue;
      }

      const sigTokens = new Set(tokenizeText(`${item.title} ${item.snippet}`));
      const titleTokens = new Set(tokenizeText(item.title));
      const dupMatch = keptTokenSets.find(
        (k) =>
          jaccardSimilarity(k.tokens, sigTokens) >= 0.72 ||
          (titleTokens.size >= 4 && jaccardSimilarity(k.titleTokens, titleTokens) >= 0.85)
      );
      if (dupMatch) {
        const parent = deduped[dupMatch.idx];
        parent.clusterCount = (parent.clusterCount ?? 1) + 1;
        if (!parent._providersSeen.has(item.sourceProvider)) {
          parent._providersSeen.add(item.sourceProvider);
          parent._rrfSum += item._rrfContrib;
          parent.relevanceScore = Number(Math.min(1.5, parent.relevanceScore + item._rrfContrib * 3.0).toFixed(4));
        }
        if (!parent.thumbnailUrl && item.thumbnailUrl) parent.thumbnailUrl = item.thumbnailUrl;
        if (!parent.mediaUrl && item.mediaUrl) parent.mediaUrl = item.mediaUrl;
        if (parent.durationSeconds == null && item.durationSeconds != null) parent.durationSeconds = item.durationSeconds;
        if (!parent.videoPlatform && item.videoPlatform) parent.videoPlatform = item.videoPlatform;
        if (!parent.priceText && item.priceText) parent.priceText = item.priceText;
        if (!parent.coordinates && item.coordinates) parent.coordinates = item.coordinates;
        continue;
      }

      seenDedupKeys.set(item._dedupKey, deduped.length);
      keptTokenSets.push({ idx: deduped.length, tokens: sigTokens, titleTokens });
      deduped.push({
        ...item,
        _rrfSum: item._rrfContrib,
        _providersSeen: new Set([item.sourceProvider])
      });
    }

    // 3. Domain diversity penalty across root domains (skipped for dedicated single-source media/map verticals)
    const skipDiversityPenalty = ['images', 'videos', 'maps'].includes(params.understanding.recommendedMode);
    const domainCounts = new Map<string, number>();
    const diversified: NormalizedSearchResult[] = deduped.map((item) => {
      const seenCount = domainCounts.get(item._rootDomain) ?? 0;
      domainCounts.set(item._rootDomain, seenCount + 1);
      const diversityMultiplier = skipDiversityPenalty || seenCount === 0 ? 1.0 : Math.max(0.55, 1 - seenCount * 0.18);
      const { _rootDomain: _rd, _rrfSum: _rs, _providersSeen: _ps, ...cleanItem } = item;
      const cleanRecord = cleanItem as NormalizedSearchResult & {
        _dedupKey?: string;
        _isHttps?: boolean;
        _rrfContrib?: number;
      };
      delete cleanRecord._dedupKey;
      delete cleanRecord._isHttps;
      delete cleanRecord._rrfContrib;
      return {
        ...cleanRecord,
        relevanceScore: Number((cleanRecord.relevanceScore * diversityMultiplier).toFixed(4))
      };
    });

    diversified.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return {
      results: diversified,
      totalBeforeDedup,
      duplicatesRemoved: Math.max(0, totalBeforeDedup - diversified.length)
    };
  }

  /**
   * Stage 2 Reranker over top 20 already-retrieved candidates (bounded <= 200ms).
   * Evaluates signals DISTINCT from Stage 1:
   * - Ordered bigram/trigram proximity in title + snippet
   * - Full query core-term coverage ratio
   * - Entity match coverage
   * - Exact title/phrase match & snippet informativeness
   */
  public async rerankCandidates(
    query: string,
    results: NormalizedSearchResult[],
    timeoutMs = 200,
    understanding?: SearchQueryUnderstanding
  ): Promise<{ results: NormalizedSearchResult[]; reranked: boolean }> {
    if (results.length <= 1) return { results, reranked: false };

    const started = Date.now();
    const topSlice = results.slice(0, 20);
    const tail = results.slice(20);
    const queryNorm = (understanding?.normalizedQuery || query).toLowerCase().trim();
    const coreTokens =
      understanding?.coreTokens && understanding.coreTokens.length > 0
        ? understanding.coreTokens
        : Array.from(new Set(tokenizeText(queryNorm)));

    // Build ordered query bigrams for proximity scoring
    const queryBigrams: string[] = [];
    for (let i = 0; i < coreTokens.length - 1; i++) {
      queryBigrams.push(`${coreTokens[i]} ${coreTokens[i + 1]}`);
    }
    const entitiesLower = (understanding?.entities ?? []).map((e) => e.toLowerCase());

    const rescored = topSlice.map((item) => {
      if (Date.now() - started > timeoutMs) {
        return item;
      }
      const titleLower = item.title.toLowerCase();
      const snippetLower = item.snippet.toLowerCase();
      const combinedLower = `${titleLower} ${snippetLower}`;
      const docTokenSet = new Set(tokenizeText(`${item.title} ${item.snippet} ${item.displayUrl}`));

      // 1. Core token coverage (rewards answering multi-concept / long queries completely)
      const coveredCount = coreTokens.filter((t) => docTokenSet.has(t)).length;
      const coverageScore = coreTokens.length > 0 ? coveredCount / coreTokens.length : 0.5;

      // 2. Ordered bigram proximity
      let bigramHits = 0;
      for (const bg of queryBigrams) {
        if (titleLower.includes(bg)) bigramHits += 1.4;
        else if (snippetLower.includes(bg)) bigramHits += 1.0;
      }
      const proximityScore = queryBigrams.length > 0 ? Math.min(1, bigramHits / queryBigrams.length) : 0.5;

      // 3. Entity coverage
      let entityScore = 0.5;
      if (entitiesLower.length > 0) {
        const entHits = entitiesLower.filter((e) => combinedLower.includes(e)).length;
        entityScore = entHits / entitiesLower.length;
      }

      // 4. Exact phrase & snippet informativeness
      const exactTitleBonus = queryNorm.length >= 4 && titleLower.includes(queryNorm) ? 0.16 : 0;
      const infoQuality = item.snippet.length >= 60 ? 0.08 : item.snippet.length >= 30 ? 0.04 : 0;

      const rerankScore = Number(
        Math.min(1, coverageScore * 0.42 + proximityScore * 0.28 + entityScore * 0.14 + exactTitleBonus + infoQuality).toFixed(4)
      );
      const finalScore = Number((item.relevanceScore * 0.65 + rerankScore * 0.35).toFixed(4));

      return {
        ...item,
        relevanceScore: finalScore,
        scoreBreakdown: item.scoreBreakdown ? { ...item.scoreBreakdown, rerank: rerankScore } : undefined
      };
    });

    rescored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const merged = [...rescored, ...tail];

    // In video search mode, ensure top results interleave YouTube, Instagram, and Facebook representation cleanly
    if (understanding?.recommendedMode === 'videos' && merged.length > 3) {
      const priorityPlatforms: Array<NonNullable<NormalizedSearchResult['videoPlatform']>> = [
        'youtube',
        'instagram',
        'facebook'
      ];
      const guaranteedTop: NormalizedSearchResult[] = [];
      const seenIds = new Set<string>();
      if (merged[0]) {
        guaranteedTop.push(merged[0]);
        seenIds.add(merged[0].id);
      }
      for (const plat of priorityPlatforms) {
        const hit = merged.find(
          (r) => r.videoPlatform === plat && !seenIds.has(r.id) && r.relevanceScore >= 0.22
        );
        if (hit) {
          guaranteedTop.push(hit);
          seenIds.add(hit.id);
        }
      }
      const rest = merged.filter((r) => !seenIds.has(r.id));
      return {
        results: [...guaranteedTop, ...rest],
        reranked: true
      };
    }

    return {
      results: merged,
      reranked: true
    };
  }
}

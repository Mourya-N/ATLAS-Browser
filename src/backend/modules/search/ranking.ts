import { createHash } from 'node:crypto';
import net from 'node:net';
import type {
  NormalizedSearchResult,
  SearchFilterOptions,
  SearchQueryUnderstanding,
  SearchResultOrigin
} from '@shared/types';
import { computeLocalEmbedding, cosineSimilarity } from '@main/memory/memory-service';
import { isPrivateOrReservedIp } from '../../security/ssrf-guard';
import type { RawSearchCandidate } from './provider';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref'
]);

const HIGH_AUTHORITY_DOMAINS = [
  '.gov',
  '.edu',
  'postgresql.org',
  'electronjs.org',
  'developer.mozilla.org',
  'owasp.org',
  'cheatsheetseries.owasp.org',
  'w3.org',
  'ietf.org',
  'nodejs.org',
  'kubernetes.io',
  'github.com',
  'arxiv.org'
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

export function classifyResultOrigin(sourceProvider: string): SearchResultOrigin {
  if (sourceProvider === 'atlas_first_party_index') return 'atlas_index';
  if (sourceProvider === 'open_tabs') return 'open_tab';
  if (
    sourceProvider === 'atlas_knowledge' ||
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
  displayUrl: string;
  domain: string;
} {
  if (rawUrl.startsWith('atlas://')) {
    return {
      valid: true,
      url: rawUrl,
      canonicalUrl: rawUrl,
      displayUrl: rawUrl,
      domain: 'atlas.local'
    };
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, url: rawUrl, canonicalUrl: '', displayUrl: '', domain: '' };
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
      return { valid: false, url: rawUrl, canonicalUrl: '', displayUrl: '', domain: '' };
    }

    const clean = new URL(parsed.toString());
    clean.hash = '';
    for (const key of Array.from(clean.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        clean.searchParams.delete(key);
      }
    }
    if (clean.pathname.length > 1 && clean.pathname.endsWith('/')) {
      clean.pathname = clean.pathname.slice(0, -1);
    }
    const displayPath = clean.pathname === '/' ? '' : clean.pathname;
    return {
      valid: true,
      url: parsed.toString(),
      canonicalUrl: clean.toString(),
      displayUrl: `${host}${displayPath}`.slice(0, 90),
      domain: host
    };
  } catch {
    return { valid: false, url: rawUrl, canonicalUrl: '', displayUrl: '', domain: '' };
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
    const queryTokens = new Set([
      ...tokenize(params.understanding.normalizedQuery),
      ...params.understanding.expandedTerms.map((t) => t.toLowerCase())
    ]);
    const queryEmbedding = computeLocalEmbedding(params.understanding.originalQuery);

    // 1. Validate URLs & apply user filters
    const validCandidates: NormalizedSearchResult[] = [];
    for (const raw of params.candidates) {
      const check = sanitizeAndCanonicalizeUrl(raw.url, Boolean(params.allowLocalTestUrls));
      if (!check.valid) continue;

      if (params.filters?.domains && params.filters.domains.length > 0) {
        const match = params.filters.domains.some(
          (d) => check.domain === d.toLowerCase() || check.domain.endsWith(`.${d.toLowerCase()}`)
        );
        if (!match) continue;
      }

      if (params.filters?.excludeDomains && params.filters.excludeDomains.length > 0) {
        const blocked = params.filters.excludeDomains.some(
          (d) => check.domain === d.toLowerCase() || check.domain.endsWith(`.${d.toLowerCase()}`)
        );
        if (blocked) continue;
      }

      const title = raw.title.replace(/\s+/g, ' ').trim();
      const snippet = raw.snippet.replace(/\s+/g, ' ').trim();
      const docText = `${title} ${snippet}`;
      const docTokens = tokenize(docText);
      const titleLower = title.toLowerCase();

      let lexicalHits = 0;
      let titleExactHits = 0;
      for (const qt of queryTokens) {
        if (titleLower.includes(qt)) titleExactHits += 1;
        if (docTokens.includes(qt)) lexicalHits += 1;
      }
      const lexical =
        queryTokens.size > 0
          ? Math.min(1, (lexicalHits / queryTokens.size) * 0.65 + (titleExactHits / queryTokens.size) * 0.35)
          : 0.4;

      const semantic = cosineSimilarity(queryEmbedding, computeLocalEmbedding(docText));

      // Intent & mode alignment score
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

      // Source authority heuristic
      let authority = 0.5;
      if (HIGH_AUTHORITY_DOMAINS.some((d) => check.domain.endsWith(d) || check.domain === d)) {
        authority = 0.92;
      } else if (check.url.startsWith('https://')) {
        authority = 0.65;
      } else if (check.url.startsWith('atlas://')) {
        authority = 0.85;
      }

      // Freshness decay
      let freshness = 0.55;
      if (raw.publishedAt) {
        const ts = Date.parse(raw.publishedAt);
        if (!Number.isNaN(ts)) {
          const ageDays = Math.max(0, (now - ts) / 86_400_000);
          freshness = Number((1 / (1 + ageDays / (params.understanding.temporalIntent.hasTemporalConstraint ? 14 : 90))).toFixed(4));
        }
      }

      // Provider position prior
      const prior = raw.rawRank ? Math.max(0.1, 1 - (raw.rawRank - 1) * 0.06) : 0.5;

      const baseScore =
        lexical * 0.34 +
        semantic * 0.26 +
        intentScore * 0.14 +
        authority * 0.11 +
        freshness * 0.08 +
        prior * 0.07;

      validCandidates.push({
        id: createHash('sha1').update(check.canonicalUrl).digest('hex').slice(0, 16),
        title,
        url: check.url,
        canonicalUrl: check.canonicalUrl,
        displayUrl: check.displayUrl,
        domain: check.domain,
        snippet,
        sourceProvider: raw.sourceProvider,
        sourceOrigin: classifyResultOrigin(raw.sourceProvider),
        publishedAt: raw.publishedAt ?? null,
        retrievedAt: now,
        contentType: ct,
        language: raw.language || params.understanding.language,
        favicon: raw.favicon ?? (check.url.startsWith('http') ? `${new URL(check.url).origin}/favicon.ico` : null),
        relevanceScore: Number(baseScore.toFixed(4)),
        scoreBreakdown: {
          lexical: Number(lexical.toFixed(3)),
          semantic: Number(semantic.toFixed(3)),
          intent: Number(intentScore.toFixed(3)),
          authority: Number(authority.toFixed(3)),
          freshness: Number(freshness.toFixed(3))
        },
        clusterCount: 1
      });
    }

    const totalBeforeDedup = validCandidates.length;

    // 2. Deduplicate by canonical URL & near-duplicate title+snippet similarity
    const sortedInitial = [...validCandidates].sort((a, b) => b.relevanceScore - a.relevanceScore);
    const deduped: NormalizedSearchResult[] = [];
    const seenCanonical = new Set<string>();
    const keptTokenSets: Array<{ idx: number; tokens: Set<string> }> = [];

    for (const item of sortedInitial) {
      if (seenCanonical.has(item.canonicalUrl)) {
        const existing = deduped.find((d) => d.canonicalUrl === item.canonicalUrl);
        if (existing) existing.clusterCount = (existing.clusterCount ?? 1) + 1;
        continue;
      }
      const sigTokens = new Set(tokenize(`${item.title} ${item.snippet}`));
      const dupMatch = keptTokenSets.find((k) => jaccardSimilarity(k.tokens, sigTokens) >= 0.78);
      if (dupMatch) {
        const parent = deduped[dupMatch.idx];
        parent.clusterCount = (parent.clusterCount ?? 1) + 1;
        continue;
      }

      seenCanonical.add(item.canonicalUrl);
      keptTokenSets.push({ idx: deduped.length, tokens: sigTokens });
      deduped.push(item);
    }

    // 3. Domain diversity penalty (avoid 5 results from the exact same domain crowding top positions)
    const domainCounts = new Map<string, number>();
    const diversified = deduped.map((item) => {
      const seenCount = domainCounts.get(item.domain) ?? 0;
      domainCounts.set(item.domain, seenCount + 1);
      const diversityMultiplier = seenCount === 0 ? 1.0 : Math.max(0.65, 1 - seenCount * 0.14);
      return {
        ...item,
        relevanceScore: Number((item.relevanceScore * diversityMultiplier).toFixed(4))
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
   * Optional reranker over ALREADY RETRIEVED candidates (never invents documents).
   * Combines embedding fine similarity + phrase proximity match.
   */
  public async rerankCandidates(
    query: string,
    results: NormalizedSearchResult[],
    timeoutMs = 300
  ): Promise<{ results: NormalizedSearchResult[]; reranked: boolean }> {
    if (results.length <= 1) return { results, reranked: false };

    const started = Date.now();
    const topSlice = results.slice(0, 15);
    const tail = results.slice(15);
    const queryLower = query.toLowerCase().trim();
    const queryVec = computeLocalEmbedding(query);

    const rescored = topSlice.map((item) => {
      if (Date.now() - started > timeoutMs) {
        return item;
      }
      const fullText = `${item.title}. ${item.snippet}`;
      const vecSim = cosineSimilarity(queryVec, computeLocalEmbedding(fullText));
      const exactPhraseBonus = fullText.toLowerCase().includes(queryLower) ? 0.18 : 0;
      const rerankScore = Number(Math.min(1, vecSim * 0.82 + exactPhraseBonus).toFixed(4));
      const finalScore = Number((item.relevanceScore * 0.65 + rerankScore * 0.35).toFixed(4));
      return {
        ...item,
        relevanceScore: finalScore,
        scoreBreakdown: item.scoreBreakdown ? { ...item.scoreBreakdown, rerank: rerankScore } : undefined
      };
    });

    rescored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return {
      results: [...rescored, ...tail],
      reranked: true
    };
  }
}

import type { SearchIntent, SearchMode, SearchQueryUnderstanding } from '@shared/types';
import { editDistanceBounded, tokenizeText } from '@shared/text-utils';
import type { AiOrchestrator } from '../ai/ai-orchestrator';

const STOPWORDS = new Set([
  'the', 'is', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'what', 'how', 'why',
  'when', 'where', 'who', 'which', 'with', 'from', 'by', 'as', 'at', 'are', 'was', 'were',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'about', 'into', 'between'
]);

const SYNONYM_EXPANSIONS: Record<string, string[]> = {
  auth: ['authentication', 'oauth', 'jwt'],
  security: ['vulnerability', 'ssrf', 'csrf', 'xss'],
  search: ['retrieval', 'ranking', 'indexing'],
  db: ['database', 'postgresql', 'sqlite'],
  postgres: ['postgresql', 'tsvector'],
  docs: ['documentation', 'reference', 'guide'],
  speed: ['latency', 'performance', 'benchmark'],
  fast: ['latency', 'performance', 'throughput'],
  container: ['docker', 'kubernetes', 'oci'],
  containers: ['docker', 'kubernetes'],
  llm: ['language model', 'inference'],
  ai: ['artificial intelligence', 'model'],
  js: ['javascript', 'ecmascript'],
  ts: ['typescript'],
  k8s: ['kubernetes'],
  cache: ['caching', 'redis', 'ttl'],
  error: ['exception', 'troubleshooting', 'fix']
};

const TECH_HINT_RE =
  /\b(api|sdk|docs|documentation|reference|error\s+code|typescript|javascript|python|rust|golang|java|postgres|postgresql|sqlite|kubernetes|k8s|docker|react|electron|http\/?3|quic|ssrf|oauth|jwt|fts5|bm25|tsvector|nginx|redis|linux|git|sql|css|html|async|regex)\b|[a-z]+\.[a-z]+\(|[a-z]+_[a-z]+|::|->|\bc\+\+|\bc#/i;

const COMPARATIVE_RE =
  /\b(vs\.?|versus|compare|comparison|difference\s+between|pros\s+and\s+cons|better\s+than|alternatives?\s+to)\b/i;

const TEMPORAL_RE =
  /\b(today|breaking|just\s+now|this\s+week|recent|latest|newest|current|release\s+notes|news|202[4-9]|2030)\b/i;

const PERSONAL_RE = /\b(my\s+bookmarks|my\s+notes|saved|remembered|in\s+my\s+memory|open\s+tabs)\b/i;

const NAVIGATIONAL_BRAND_HINTS = new Set([
  'github', 'wikipedia', 'stackoverflow', 'mdn', 'postgresql', 'electron', 'kubernetes',
  'nodejs', 'python', 'rust', 'arxiv', 'docker', 'sqlite', 'ietf', 'owasp', 'youtube', 'reddit'
]);

const TYPO_VOCABULARY = [
  'postgresql', 'typescript', 'javascript', 'kubernetes', 'electron', 'authentication',
  'authorization', 'documentation', 'architecture', 'performance', 'comparison', 'retrieval',
  'embedding', 'encryption', 'benchmark', 'programming', 'framework', 'containers',
  'deployment', 'database', 'algorithm', 'security', 'wikipedia', 'middleware', 'observability',
  'synchronization', 'configuration', 'react', 'python', 'sqlite', 'docker', 'github'
];

function maybeCorrectTypo(token: string): string | null {
  if (token.length < 5 || /[0-9._+/:#-]/.test(token)) return null;
  if (TYPO_VOCABULARY.includes(token)) return null;

  let best: string | null = null;
  let bestDist = 3;
  let tie = false;

  for (const candidate of TYPO_VOCABULARY) {
    const maxDist = token.length >= 8 ? 2 : 1;
    const dist = editDistanceBounded(token, candidate, maxDist);
    if (dist <= maxDist) {
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
        tie = false;
      } else if (dist === bestDist) {
        tie = true;
      }
    }
  }
  return best && !tie ? best : null;
}

export class QueryUnderstandingEngine {
  constructor(private readonly aiOrchestrator?: AiOrchestrator) {}

  public analyzeDeterministic(
    rawQuery: string,
    explicitMode?: SearchMode,
    options?: { disableTypoCorrection?: boolean }
  ): SearchQueryUnderstanding {
    const trimmed = rawQuery.trim();

    // 1. Extract quoted exact phrases before stripping punctuation
    const exactPhrases: string[] = [];
    let remainder = trimmed.replace(/"([^"]{2,120})"/g, (_m, phrase: string) => {
      const cleanPhrase = phrase.trim().replace(/\s+/g, ' ');
      if (cleanPhrase) exactPhrases.push(cleanPhrase);
      return ` ${cleanPhrase} `;
    });

    // 2. Extract search operators: site:, -site:, -term
    const siteFilters: string[] = [];
    const excludeDomains: string[] = [];
    const excludedTerms: string[] = [];

    remainder = remainder.replace(/(^|\s)(-?)site:([a-z0-9.-]+\.[a-z]{2,})/gi, (_m, sp, neg, dom: string) => {
      const cleanDom = dom.toLowerCase().trim();
      if (neg === '-') {
        if (!excludeDomains.includes(cleanDom)) excludeDomains.push(cleanDom);
      } else if (!siteFilters.includes(cleanDom)) {
        siteFilters.push(cleanDom);
      }
      return sp;
    });

    remainder = remainder.replace(/(^|\s)-([a-z0-9_.-]{2,})\b/gi, (_m, sp, term: string) => {
      const clean = term.toLowerCase();
      if (!excludedTerms.includes(clean)) excludedTerms.push(clean);
      return sp;
    });

    const cleanQuery = remainder.replace(/\s+/g, ' ').trim();
    const lower = cleanQuery.toLowerCase();

    // 3. Extract technical tokens & syntax-bearing identifiers
    const technicalTokens: string[] = [];
    for (const rawTok of cleanQuery.split(/\s+/)) {
      if (
        /^(c\+\+|c#|f#|\.net)$/i.test(rawTok) ||
        /[a-z0-9]+[_./:-][a-z0-9]+/i.test(rawTok) ||
        /^[a-z]+[A-Z][a-zA-Z0-9]*$/.test(rawTok) ||
        /^\d{3,4}$/.test(rawTok)
      ) {
        technicalTokens.push(rawTok.toLowerCase());
      }
    }

    // 4. Temporal detection
    const yearMatches = trimmed.match(/\b(20\d{2})\b/g) || [];
    let timeHint: SearchQueryUnderstanding['temporalIntent']['timeHint'];
    if (/\b(today|breaking|just now)\b/i.test(lower)) timeHint = 'today';
    else if (/\b(this week|recent|latest|newest|current)\b/i.test(lower)) timeHint = 'recent';
    else if (/\bthis month\b/i.test(lower)) timeHint = 'month';
    else if (/\bthis year\b/i.test(lower) || yearMatches.length > 0) timeHint = 'year';

    // 5. Intent classification
    const allCleanTokens = tokenizeText(cleanQuery);
    const nonStopTokens = allCleanTokens.filter((t) => !STOPWORDS.has(t));
    const looksLikeDomainOrHost = /^([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(cleanQuery);
    const isShortBrandNav =
      nonStopTokens.length >= 1 &&
      nonStopTokens.length <= 2 &&
      !COMPARATIVE_RE.test(lower) &&
      !TEMPORAL_RE.test(lower) &&
      (looksLikeDomainOrHost ||
        (nonStopTokens.length === 1 && NAVIGATIONAL_BRAND_HINTS.has(nonStopTokens[0])) ||
        (/\b(login|homepage|official\s+site|download)\b/i.test(lower) && nonStopTokens.length <= 3));

    let intent: SearchIntent = 'informational';
    if (COMPARATIVE_RE.test(lower)) {
      intent = 'comparative';
    } else if (PERSONAL_RE.test(lower)) {
      intent = 'personal_knowledge';
    } else if (looksLikeDomainOrHost || isShortBrandNav) {
      intent = 'navigational';
    } else if (TECH_HINT_RE.test(cleanQuery) || technicalTokens.length > 0) {
      intent = 'technical_docs';
    } else if (timeHint === 'today' || timeHint === 'recent' || /\bnews\b/i.test(lower)) {
      intent = 'temporal_news';
    }

    const modeByIntent: Record<SearchIntent, SearchMode> = {
      informational: 'web',
      navigational: 'web',
      comparative: 'research',
      temporal_news: 'news',
      technical_docs: 'docs',
      personal_knowledge: 'personal_knowledge'
    };
    const recommendedMode = explicitMode ?? modeByIntent[intent];

    // 6. Entity extraction (capitalized phrases, dotted hosts, tech acronyms)
    const entities: string[] = [];
    const capMatches = trimmed.match(/\b[A-Z][a-zA-Z0-9_-]{1,}(?:\s+[A-Z][a-zA-Z0-9_-]{1,})*\b/g) || [];
    for (const m of capMatches) {
      if (!entities.includes(m)) entities.push(m);
    }

    // 7. Typo correction (only for non-technical, non-quoted tokens unless disabled)
    const correctedTokens: string[] = [];
    let hadTypoCorrection = false;
    for (const t of nonStopTokens) {
      const fixed = !options?.disableTypoCorrection && exactPhrases.length === 0 ? maybeCorrectTypo(t) : null;
      if (fixed) {
        correctedTokens.push(fixed);
        hadTypoCorrection = true;
      } else {
        correctedTokens.push(t);
      }
    }

    const coreTokens = Array.from(new Set(correctedTokens.length > 0 ? correctedTokens : allCleanTokens));
    const normalizedQuery = coreTokens.join(' ') || lower;
    const isExactMatchQuery = exactPhrases.length > 0 || technicalTokens.length >= 2 || looksLikeDomainOrHost;

    // 8. Selective query expansion (never pollute exact-match or navigational queries)
    const expandedTerms: string[] = [];
    if (!isExactMatchQuery && intent !== 'navigational') {
      for (const t of coreTokens) {
        const syns = SYNONYM_EXPANSIONS[t];
        if (!syns) continue;
        for (const s of syns) {
          if (!coreTokens.includes(s) && !expandedTerms.includes(s)) {
            expandedTerms.push(s);
          }
        }
      }
    }

    const rewrittenQueries: string[] = [cleanQuery || trimmed];
    if (hadTypoCorrection && normalizedQuery) {
      rewrittenQueries.unshift(normalizedQuery);
    } else if (normalizedQuery && normalizedQuery !== lower) {
      rewrittenQueries.push(normalizedQuery);
    }
    if (expandedTerms.length > 0 && coreTokens.length <= 5) {
      rewrittenQueries.push(`${normalizedQuery} ${expandedTerms.slice(0, 2).join(' ')}`);
    }

    const hasNonAscii = /[^\x00-\x7F]/.test(trimmed);
    const language = hasNonAscii ? 'multilingual' : 'en';

    return {
      originalQuery: rawQuery,
      normalizedQuery,
      correctedQuery: hadTypoCorrection ? normalizedQuery : null,
      coreTokens,
      exactPhrases,
      siteFilters,
      excludeDomains,
      excludedTerms,
      technicalTokens,
      isExactMatchQuery,
      rewrittenQueries: Array.from(new Set(rewrittenQueries.filter(Boolean))),
      expandedTerms: expandedTerms.slice(0, 6),
      intent,
      recommendedMode,
      entities: entities.slice(0, 8),
      temporalIntent: {
        hasTemporalConstraint: Boolean(timeHint || yearMatches.length > 0),
        timeHint,
        yearMentions: yearMatches
      },
      language,
      usedLlm: false
    };
  }

  public async understand(
    rawQuery: string,
    explicitMode?: SearchMode,
    useLlmEnhancement = false
  ): Promise<SearchQueryUnderstanding> {
    const base = this.analyzeDeterministic(rawQuery, explicitMode);
    if (!useLlmEnhancement || !this.aiOrchestrator || !this.aiOrchestrator.isConfigured()) {
      return base;
    }

    try {
      const resp = await this.aiOrchestrator.generate({
        tier: 'fast',
        systemInstruction:
          'You rewrite search queries for retrieval. Never invent URLs. Return concise JSON query rewrites and extracted entities.',
        messages: [
          {
            role: 'user',
            parts: [{ text: `Query: ${rawQuery}\nIntent hint: ${base.intent}` }]
          }
        ],
        responseSchema: {
          type: 'object',
          properties: {
            rewrittenQueries: { type: 'array', items: { type: 'string' } },
            entities: { type: 'array', items: { type: 'string' } }
          },
          required: ['rewrittenQueries', 'entities']
        },
        maxOutputTokens: 250,
        temperature: 0.1
      });
      const parsed = JSON.parse(resp.text) as { rewrittenQueries?: string[]; entities?: string[] };
      return {
        ...base,
        rewrittenQueries: Array.from(
          new Set([...base.rewrittenQueries, ...(parsed.rewrittenQueries ?? []).slice(0, 2)])
        ),
        entities: Array.from(new Set([...base.entities, ...(parsed.entities ?? [])])).slice(0, 10),
        usedLlm: true
      };
    } catch {
      return base;
    }
  }
}

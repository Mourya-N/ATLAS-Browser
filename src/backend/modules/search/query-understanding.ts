import type { SearchIntent, SearchMode, SearchQueryUnderstanding } from '@shared/types';
import type { AiOrchestrator } from '../ai/ai-orchestrator';

const STOPWORDS = new Set([
  'the', 'is', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'what', 'how', 'why', 'when', 'where', 'with'
]);

const SYNONYM_EXPANSIONS: Record<string, string[]> = {
  auth: ['authentication', 'oauth', 'jwt'],
  security: ['ssrf', 'csrf', 'xss', 'csp'],
  search: ['retrieval', 'ranking', 'indexing'],
  db: ['database', 'postgres', 'postgresql', 'sqlite'],
  postgres: ['postgresql', 'tsvector'],
  docs: ['documentation', 'api', 'reference'],
  speed: ['latency', 'performance', 'throughput']
};

export class QueryUnderstandingEngine {
  constructor(private readonly aiOrchestrator?: AiOrchestrator) {}

  public analyzeDeterministic(rawQuery: string, explicitMode?: SearchMode): SearchQueryUnderstanding {
    const trimmed = rawQuery.trim();
    const lower = trimmed.toLowerCase();

    // Detect temporal hints & explicit years
    const yearMatches = trimmed.match(/\b(20\d{2})\b/g) || [];
    let timeHint: SearchQueryUnderstanding['temporalIntent']['timeHint'];
    if (/\b(today|breaking|just now)\b/i.test(lower)) timeHint = 'today';
    else if (/\b(this week|recent|latest|newest)\b/i.test(lower)) timeHint = 'recent';
    else if (/\bthis month\b/i.test(lower)) timeHint = 'month';
    else if (/\bthis year\b/i.test(lower) || yearMatches.length > 0) timeHint = 'year';

    // Intent classification
    let intent: SearchIntent = 'informational';
    if (/\b(vs|versus|compare|comparison|difference between|pros and cons)\b/i.test(lower)) {
      intent = 'comparative';
    } else if (/\b(my bookmarks|my notes|saved|remembered|in my memory|personal)\b/i.test(lower)) {
      intent = 'personal_knowledge';
    } else if (/\b(docs|documentation|sdk|api|reference|error code|typescript|postgres|kubernetes)\b/i.test(lower)) {
      intent = 'technical_docs';
    } else if (timeHint === 'today' || timeHint === 'recent' || /\bnews\b/i.test(lower)) {
      intent = 'temporal_news';
    } else if (/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(trimmed)) {
      intent = 'navigational';
    }

    // Mode recommendation unless user explicitly chose one
    const modeByIntent: Record<SearchIntent, SearchMode> = {
      informational: 'web',
      navigational: 'web',
      comparative: 'research',
      temporal_news: 'news',
      technical_docs: 'docs',
      personal_knowledge: 'personal_knowledge'
    };
    const recommendedMode = explicitMode ?? modeByIntent[intent];

    // Simple capitalized phrase / acronym entity extraction
    const entities: string[] = [];
    const capMatches = trimmed.match(/\b[A-Z][a-zA-Z0-9_-]{1,}(?:\s+[A-Z][a-zA-Z0-9_-]{1,})*\b/g) || [];
    for (const m of capMatches) {
      if (!entities.includes(m)) entities.push(m);
    }

    // Query normalization & deterministic rewriting
    const tokens = lower
      .replace(/[^a-z0-9\s.-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t));

    const normalizedQuery = tokens.join(' ') || lower;
    const expandedTerms: string[] = [];
    for (const t of tokens) {
      const syns = SYNONYM_EXPANSIONS[t];
      if (syns) {
        for (const s of syns) {
          if (!tokens.includes(s) && !expandedTerms.includes(s)) expandedTerms.push(s);
        }
      }
    }

    const rewrittenQueries: string[] = [trimmed];
    if (normalizedQuery !== lower && normalizedQuery.length > 0) {
      rewrittenQueries.push(normalizedQuery);
    }
    if (expandedTerms.length > 0) {
      rewrittenQueries.push(`${normalizedQuery} ${expandedTerms.slice(0, 2).join(' ')}`);
    }

    // Lightweight language heuristic
    const hasNonAscii = /[^\x00-\x7F]/.test(trimmed);
    const language = hasNonAscii ? 'multilingual' : 'en';

    return {
      originalQuery: rawQuery,
      normalizedQuery,
      rewrittenQueries: Array.from(new Set(rewrittenQueries)),
      expandedTerms,
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

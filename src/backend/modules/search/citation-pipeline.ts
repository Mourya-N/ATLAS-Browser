import { randomUUID } from 'node:crypto';
import type {
  AiCitedAnswer,
  NormalizedSearchResult,
  SearchCitationClaim,
  SearchContradiction,
  SearchEvidencePassage
} from '@shared/types';
import { InjectionGuard } from '@main/security/injection-guard';
import { computeLocalEmbedding, cosineSimilarity } from '@shared/text-utils';
import type { AiOrchestrator } from '../ai/ai-orchestrator';
import type { ResearchExtractorService } from '../research/research-extractor';

export interface ApprovedPageContextInput {
  url: string;
  title: string;
  text: string;
}

export class CitationAnswerPipeline {
  private readonly injectionGuard = new InjectionGuard();

  constructor(
    private readonly ai: AiOrchestrator,
    private readonly extractor: ResearchExtractorService
  ) {}

  public async answerWithCitations(params: {
    query: string;
    candidates: NormalizedSearchResult[];
    approvedTabContexts?: ApprovedPageContextInput[];
    fetchFullPages?: boolean;
    allowLocalhostForTest?: boolean;
  }): Promise<AiCitedAnswer> {
    const started = Date.now();

    if (!this.ai.isConfigured()) {
      return {
        status: 'unavailable',
        summary: 'AI summary is unavailable because no live AI provider credential is configured. Showing verified search results below.',
        claims: [],
        contradictions: [],
        passages: [],
        citations: [],
        model: 'none',
        provider: 'unconfigured',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: Date.now() - started,
        warning: 'AI summary unavailable without configured provider'
      };
    }

    const topCandidates = params.candidates.slice(0, 4);
    const contextByUrl = new Map<string, ApprovedPageContextInput>();
    for (const ctx of params.approvedTabContexts ?? []) {
      contextByUrl.set(ctx.url, ctx);
    }

    // 1. Collect inspected passages from approved contexts or SSRF-safe fetch (falling back to retrieved snippet)
    const passages: SearchEvidencePassage[] = [];
    const inspectedMeta = new Map<string, { title: string; domain: string; fullText: string }>();
    const queryVec = computeLocalEmbedding(params.query);
    const queryTokens = new Set(
      params.query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2)
    );

    for (const item of topCandidates) {
      let fullText = '';
      const tabCtx = contextByUrl.get(item.url);
      if (tabCtx && tabCtx.text.trim().length > 0) {
        fullText = tabCtx.text;
      } else if (
        params.fetchFullPages !== false &&
        (item.url.startsWith('https://') || item.url.startsWith('http://'))
      ) {
        try {
          const extracted = await this.extractor.fetchAndExtract(item.url, {
            timeoutMs: 4000,
            maxBytes: 1024 * 1024,
            allowLocalhostForTest: params.allowLocalhostForTest
          });
          fullText = extracted.textContent;
        } catch {
          fullText = `${item.title}. ${item.snippet}`;
        }
      } else {
        fullText = `${item.title}. ${item.snippet}`;
      }

      inspectedMeta.set(item.url, {
        title: item.title,
        domain: item.domain,
        fullText
      });

      const chunks = this.extractor.chunkText(fullText, 600, 24);
      const effectiveChunks = chunks.length > 0 ? chunks : [fullText.slice(0, 600)];

      effectiveChunks.forEach((excerpt, idx) => {
        const lower = excerpt.toLowerCase();
        let hits = 0;
        for (const qt of queryTokens) {
          if (lower.includes(qt)) hits += 1;
        }
        const lex = queryTokens.size > 0 ? hits / queryTokens.size : 0;
        const vec = cosineSimilarity(queryVec, computeLocalEmbedding(excerpt));
        const rel = lex * 0.55 + vec * 0.45;
        passages.push({
          sourceUrl: item.url,
          sourceTitle: item.title,
          domain: item.domain,
          passageIndex: idx,
          excerpt,
          relevance: Number(rel.toFixed(4))
        });
      });
    }

    // Select highest-relevance passages bounded for prompt safety
    const selectedPassages = [...passages]
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 8);

    if (selectedPassages.length === 0) {
      return {
        status: 'insufficient_evidence',
        summary: 'Insufficient retrieved evidence to generate a cited answer for this query.',
        claims: [],
        contradictions: [],
        passages: [],
        citations: [],
        model: this.ai.selectModel('balanced'),
        provider: 'gemini',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: Date.now() - started
      };
    }

    const wrappedEvidence = selectedPassages
      .map((p, i) =>
        this.injectionGuard.wrapUntrustedContent(
          p.sourceUrl,
          `PASSAGE [${i + 1}] URL: ${p.sourceUrl}\nTITLE: ${p.sourceTitle}\nEXCERPT: ${p.excerpt}`
        )
      )
      .join('\n\n');

    const responseSchema = {
      type: 'object',
      properties: {
        sufficientEvidence: { type: 'boolean' },
        summary: { type: 'string' },
        claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              statement: { type: 'string' },
              kind: { type: 'string', enum: ['fact', 'interpretation'] },
              sourceUrl: { type: 'string' },
              supportingQuote: { type: 'string' }
            },
            required: ['statement', 'kind', 'sourceUrl', 'supportingQuote']
          }
        },
        contradictions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              topic: { type: 'string' },
              claimA: { type: 'string' },
              sourceUrlA: { type: 'string' },
              claimB: { type: 'string' },
              sourceUrlB: { type: 'string' }
            },
            required: ['topic', 'claimA', 'sourceUrlA', 'claimB', 'sourceUrlB']
          }
        }
      },
      required: ['sufficientEvidence', 'summary', 'claims', 'contradictions']
    };

    try {
      const resp = await this.ai.generate({
        tier: 'balanced',
        systemInstruction:
          'You are the Atlas Cited Answer Synthesizer. Your job is to synthesize a helpful, grounded answer from the provided PASSAGES.\n\nRules:\n1. Base EVERY factual statement strictly on the provided PASSAGES.\n2. Never invent URLs or quotes not present in the passages.\n3. For each claim, cite the source URL from the passage and provide a supporting quote.\n4. Set sufficientEvidence=true if the passages contain ANY relevant information that partially or fully answers the question.\n5. Set sufficientEvidence=false ONLY if the passages are completely unrelated to the question.\n6. Distinguish direct retrieved facts ("fact") from synthesis ("interpretation").\n7. If sources disagree, list contradictions.\n8. Always produce at least one claim if the passages mention the topic.',
        messages: [
          {
            role: 'user',
            parts: [{ text: `User Question: ${params.query}\n\nRetrieved Evidence:\n${wrappedEvidence}` }]
          }
        ],
        responseSchema,
        temperature: 0.1,
        maxOutputTokens: 1400
      });

      const parsed = JSON.parse(resp.text) as {
        sufficientEvidence?: boolean;
        summary?: string;
        claims?: Array<{
          statement: string;
          kind: 'fact' | 'interpretation';
          sourceUrl: string;
          supportingQuote: string;
        }>;
        contradictions?: SearchContradiction[];
      };

      // Validate every citation against ACTUALLY INSPECTED sources
      const verifiedClaims: SearchCitationClaim[] = [];
      const citedUrlOrder: string[] = [];

      const resolveInspectedUrl = (rawUrl: string): string | null => {
        const trimmed = (rawUrl || '').trim();
        if (!trimmed) return null;
        if (inspectedMeta.has(trimmed)) return trimmed;
        const withoutHash = trimmed.split('#')[0];
        if (inspectedMeta.has(withoutHash)) return withoutHash;
        const withoutTrailingSlash = withoutHash.replace(/\/+$/, '');
        for (const knownUrl of inspectedMeta.keys()) {
          if (knownUrl.replace(/\/+$/, '') === withoutTrailingSlash) {
            return knownUrl;
          }
        }
        return null;
      };

      for (const rawClaim of parsed.claims ?? []) {
        const resolvedUrl = resolveInspectedUrl(rawClaim.sourceUrl);
        const meta = resolvedUrl ? inspectedMeta.get(resolvedUrl) : undefined;
        if (!meta || !resolvedUrl) {
          // Reject fabricated/uninspected URLs silently!
          continue;
        }
        const quoteClean = rawClaim.supportingQuote.trim().toLowerCase();
        const hay = meta.fullText.toLowerCase();
        const quoteFoundExact = quoteClean.length >= 8 && hay.includes(quoteClean.slice(0, 60));
        const quoteTokens = quoteClean.split(/\s+/).filter((w) => w.length >= 4);
        const tokenMatches = quoteTokens.filter((w) => hay.includes(w)).length;
        const verifiedAgainstSource =
          quoteFoundExact || (quoteTokens.length > 0 && tokenMatches / quoteTokens.length >= 0.5);

        if (!citedUrlOrder.includes(resolvedUrl)) {
          citedUrlOrder.push(resolvedUrl);
        }

        verifiedClaims.push({
          id: randomUUID(),
          statement: rawClaim.statement,
          kind: rawClaim.kind === 'fact' && verifiedAgainstSource ? 'fact' : 'interpretation',
          sourceUrl: resolvedUrl,
          sourceTitle: meta.title,
          supportingQuote: rawClaim.supportingQuote.slice(0, 260),
          verifiedAgainstSource
        });
      }

      const validContradictions = (parsed.contradictions ?? []).filter(
        (c) => inspectedMeta.has(c.sourceUrlA) && inspectedMeta.has(c.sourceUrlB)
      );

      // Ensure citations only list URLs actually inspected
      const citations = citedUrlOrder.map((url, idx) => {
        const meta = inspectedMeta.get(url)!;
        return { index: idx + 1, url, title: meta.title, domain: meta.domain };
      });

      const sufficient = parsed.sufficientEvidence !== false && (verifiedClaims.length > 0 || citations.length > 0);

      return {
        status: sufficient ? 'ok' : 'insufficient_evidence',
        summary: parsed.summary || 'No conclusive summary could be synthesized from retrieved sources.',
        claims: verifiedClaims,
        contradictions: validContradictions,
        passages: selectedPassages,
        citations,
        model: resp.modelUsed,
        provider: resp.providerId,
        inputTokens: resp.usage.inputTokens,
        outputTokens: resp.usage.outputTokens,
        estimatedCostUsd: resp.estimatedCostUsd,
        latencyMs: Date.now() - started
      };
    } catch (err) {
      return {
        status: 'failed',
        summary: 'AI answer generation failed; conventional search results remain unaffected below.',
        claims: [],
        contradictions: [],
        passages: selectedPassages,
        citations: [],
        model: this.ai.selectModel('balanced'),
        provider: 'error',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: Date.now() - started,
        warning: err instanceof Error ? err.message : 'AI answer synthesis failed'
      };
    }
  }
}

import { createHash } from 'node:crypto';
import type { PageChangeResult, PagePerception } from '@shared/types';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import type { InjectionGuard } from '@main/security/injection-guard';
import type { ModelProvider } from './providers/model-provider';
import { computeLocalEmbedding, cosineSimilarity } from '@main/memory/memory-service';

export interface SemanticPageChunk {
  index: number;
  heading: string;
  text: string;
  score: number;
}

export interface PageUnderstandingResult {
  url: string;
  title: string;
  answer: string;
  entities: Array<{ name: string; type: string; relationship?: string }>;
  unavailableNotes: string[];
  relevantChunks: SemanticPageChunk[];
}

export class PageUnderstandingEngine {
  constructor(
    private readonly getProvider: () => ModelProvider,
    private readonly platformRepo: PlatformRepository,
    private readonly injectionGuard: InjectionGuard
  ) {}

  public semanticSearchInPage(perception: PagePerception, query: string, limit = 5): SemanticPageChunk[] {
    const rawBlocks = perception.mainText
      .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 20);

    const chunks = rawBlocks.slice(0, 120);
    const queryTokens = new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2)
    );
    const queryVec = computeLocalEmbedding(query);

    return chunks
      .map((text, index) => {
        const words = text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/);
        let hits = 0;
        for (const w of words) {
          if (queryTokens.has(w)) hits += 1;
        }
        const lexical = queryTokens.size > 0 ? hits / Math.sqrt(Math.max(1, words.length)) : 0;
        const semantic = cosineSimilarity(queryVec, computeLocalEmbedding(text));
        const nearestHeading =
          perception.headings.find((h) => text.includes(h.replace(/^H[1-3]:\s*/i, ''))) ||
          perception.headings[0] ||
          perception.title;
        return {
          index,
          heading: nearestHeading,
          text: text.slice(0, 500),
          score: Number((lexical * 1.5 + semantic * 2.0).toFixed(4))
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  public checkAndRecordPageChanges(
    perception: PagePerception,
    recordSnapshot = true
  ): PageChangeResult {
    const url = perception.url;
    const prev = this.platformRepo.getPageSnapshot(url);
    const fingerprint = createHash('sha256')
      .update(`${perception.title}\n${perception.headings.join('|')}\n${perception.mainText}`)
      .digest('hex');

    let result: PageChangeResult;
    if (!prev) {
      result = {
        url,
        hasPrevious: false,
        summary: 'First recorded visit to this URL; baseline snapshot captured.',
        addedHeadings: [],
        removedHeadings: [],
        textLengthDelta: 0
      };
    } else if (prev.textFingerprint === fingerprint) {
      result = {
        url,
        hasPrevious: true,
        previousVisitedAt: prev.capturedAt,
        summary: 'No observable text or heading changes since your last recorded visit.',
        addedHeadings: [],
        removedHeadings: [],
        textLengthDelta: 0
      };
    } else {
      const prevSet = new Set(prev.headings);
      const curSet = new Set(perception.headings);
      const addedHeadings = perception.headings.filter((h) => !prevSet.has(h));
      const removedHeadings = prev.headings.filter((h) => !curSet.has(h));
      const textLengthDelta = perception.mainText.length - prev.textLength;
      result = {
        url,
        hasPrevious: true,
        previousVisitedAt: prev.capturedAt,
        summary: `Page changed since ${new Date(prev.capturedAt).toLocaleString()}: ${addedHeadings.length} added heading(s), ${removedHeadings.length} removed heading(s), text delta ${textLengthDelta >= 0 ? '+' : ''}${textLengthDelta} chars.`,
        addedHeadings,
        removedHeadings,
        textLengthDelta
      };
    }

    if (recordSnapshot && url && url !== 'about:blank' && !url.startsWith('data:')) {
      this.platformRepo.savePageSnapshot({
        url,
        title: perception.title,
        headings: perception.headings,
        textFingerprint: fingerprint,
        textExcerpt: perception.mainText.slice(0, 1200),
        textLength: perception.mainText.length,
        capturedAt: Date.now()
      });
    }

    return result;
  }

  public async answerQuestion(params: {
    perception: PagePerception;
    question: string;
    model: string;
  }): Promise<PageUnderstandingResult> {
    const relevantChunks = this.semanticSearchInPage(params.perception, params.question, 6);
    const provider = this.getProvider();

    const contextPayload = this.injectionGuard.wrapUntrustedContent(
      params.perception.url,
      [
        `URL: ${params.perception.url}`,
        `TITLE: ${params.perception.title}`,
        `HEADINGS:\n${params.perception.headings.slice(0, 20).join('\n')}`,
        params.perception.tablesSummary.length
          ? `TABLES:\n${params.perception.tablesSummary.join('\n\n')}`
          : '',
        `MOST RELEVANT SECTIONS:\n${relevantChunks.map((c) => `[${c.heading}] ${c.text}`).join('\n\n')}`,
        `MAIN PAGE TEXT:\n${params.perception.mainText.slice(0, 8000)}`
      ]
        .filter(Boolean)
        .join('\n\n')
    );

    const schema = {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              relationship: { type: 'string' }
            },
            required: ['name', 'type']
          }
        },
        unavailableNotes: { type: 'array', items: { type: 'string' } }
      },
      required: ['answer', 'entities', 'unavailableNotes']
    };

    const resp = await provider.generate({
      model: params.model,
      systemInstruction:
        'You are the Atlas Page Understanding Engine. Answer strictly from the untrusted page content. Never invent facts; if requested details are absent from the page, list them in unavailableNotes.',
      messages: [
        {
          role: 'user',
          parts: [{ text: `User Question: ${params.question}\n\n${contextPayload}` }]
        }
      ],
      responseSchema: schema,
      temperature: 0.1
    });

    try {
      const parsed = JSON.parse(resp.text) as {
        answer?: string;
        entities?: Array<{ name: string; type: string; relationship?: string }>;
        unavailableNotes?: string[];
      };
      return {
        url: params.perception.url,
        title: params.perception.title,
        answer: parsed.answer || resp.text,
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        unavailableNotes: Array.isArray(parsed.unavailableNotes) ? parsed.unavailableNotes : [],
        relevantChunks
      };
    } catch {
      return {
        url: params.perception.url,
        title: params.perception.title,
        answer: resp.text,
        entities: [],
        unavailableNotes: [],
        relevantChunks
      };
    }
  }
}

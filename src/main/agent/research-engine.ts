import { randomUUID } from 'node:crypto';
import type {
  PagePerception,
  ResearchClaim,
  ResearchConflict,
  ResearchReport
} from '@shared/types';
import type { AgentRepository } from '@main/db/repositories/agent-repo';
import type { InjectionGuard } from '@main/security/injection-guard';
import type { ModelProvider } from './providers/model-provider';

export interface ResearchSourceInput {
  url: string;
  title: string;
  text: string;
  headings: string[];
}

export class ResearchEngine {
  constructor(
    private readonly getProvider: () => ModelProvider,
    private readonly agentRepo: AgentRepository,
    private readonly injectionGuard: InjectionGuard
  ) {}

  public async buildReport(params: {
    query: string;
    sources: ResearchSourceInput[];
    model: string;
    isPrivate?: boolean;
  }): Promise<ResearchReport> {
    const validSources = params.sources.filter((s) => s.url && s.url !== 'about:blank' && s.text.trim().length > 0);
    if (validSources.length === 0) {
      return {
        id: randomUUID(),
        query: params.query,
        summary: 'No readable web sources were available to analyze.',
        claims: [],
        conflicts: [],
        comparisonTable: null,
        notes: '',
        sources: [],
        createdAt: Date.now()
      };
    }

    const provider = this.getProvider();
    const wrappedSources = validSources
      .slice(0, 8)
      .map((s, idx) =>
        this.injectionGuard.wrapUntrustedContent(
          s.url,
          `SOURCE ${idx + 1}: ${s.title} (${s.url})\nHEADINGS: ${s.headings.slice(0, 8).join('; ')}\nTEXT:\n${s.text.slice(0, 5000)}`
        )
      )
      .join('\n\n');

    const responseSchema = {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claim: { type: 'string' },
              kind: { type: 'string', enum: ['fact', 'analysis'] },
              supportingQuote: { type: 'string' },
              sourceUrl: { type: 'string' },
              sourceTitle: { type: 'string' },
              confidence: { type: 'number' }
            },
            required: ['claim', 'kind', 'supportingQuote', 'sourceUrl', 'sourceTitle', 'confidence']
          }
        },
        conflicts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              topic: { type: 'string' },
              statementA: { type: 'string' },
              sourceA: { type: 'string' },
              statementB: { type: 'string' },
              sourceB: { type: 'string' }
            },
            required: ['topic', 'statementA', 'sourceA', 'statementB', 'sourceB']
          }
        },
        comparisonTable: {
          type: 'object',
          properties: {
            columns: { type: 'array', items: { type: 'string' } },
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } }
          },
          required: ['columns', 'rows']
        },
        notes: { type: 'string' }
      },
      required: ['summary', 'claims', 'conflicts', 'notes']
    };

    const allowedUrls = new Set(validSources.map((s) => s.url));
    const resp = await provider.generate({
      model: params.model,
      systemInstruction:
        'You are the HAYA (HAYAGRIVA) Research & Evidence Engine for LAVRAY. Synthesize findings ONLY from the provided sources. Never fabricate URLs or quotes. Distinguish factual claims ("fact") directly supported by a quote from synthesis ("analysis"). Highlight any contradictions between sources.',
      messages: [
        {
          role: 'user',
          parts: [
            {
              text: `Research Query: ${params.query}\n\nSources:\n${wrappedSources}`
            }
          ]
        }
      ],
      responseSchema,
      temperature: 0.1,
      maxOutputTokens: 2500
    });

    let report: ResearchReport;
    try {
      const parsed = JSON.parse(resp.text) as {
        summary?: string;
        claims?: Array<Omit<ResearchClaim, 'id'>>;
        conflicts?: ResearchConflict[];
        comparisonTable?: { columns: string[]; rows: string[][] } | null;
        notes?: string;
      };

      // Filter out any hallucinated source URLs not present in validSources
      const verifiedClaims: ResearchClaim[] = (parsed.claims ?? [])
        .filter((c) => allowedUrls.has(c.sourceUrl) || c.kind === 'analysis')
        .map((c) => ({
          id: randomUUID(),
          claim: c.claim,
          kind: c.kind === 'fact' && allowedUrls.has(c.sourceUrl) ? 'fact' : 'analysis',
          supportingQuote: c.supportingQuote || '',
          sourceUrl: allowedUrls.has(c.sourceUrl) ? c.sourceUrl : validSources[0].url,
          sourceTitle: c.sourceTitle || validSources[0].title,
          confidence: Math.min(1, Math.max(0, Number(c.confidence ?? 0.75)))
        }));

      report = {
        id: randomUUID(),
        query: params.query,
        summary: parsed.summary || 'Research complete.',
        claims: verifiedClaims,
        conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
        comparisonTable:
          parsed.comparisonTable && Array.isArray(parsed.comparisonTable.columns)
            ? parsed.comparisonTable
            : null,
        notes: parsed.notes || '',
        sources: validSources.map((s) => ({ url: s.url, title: s.title })),
        createdAt: Date.now()
      };
    } catch {
      report = {
        id: randomUUID(),
        query: params.query,
        summary: resp.text || 'Research synthesis generated.',
        claims: validSources.map((s) => ({
          id: randomUUID(),
          claim: `Reviewed source: ${s.title}`,
          kind: 'fact',
          supportingQuote: s.text.slice(0, 180),
          sourceUrl: s.url,
          sourceTitle: s.title,
          confidence: 0.7
        })),
        conflicts: [],
        comparisonTable: null,
        notes: '',
        sources: validSources.map((s) => ({ url: s.url, title: s.title })),
        createdAt: Date.now()
      };
    }

    if (!params.isPrivate) {
      this.agentRepo.saveResearchReport(report);
    }
    return report;
  }

  public sourcesFromPerceptions(perceptions: PagePerception[]): ResearchSourceInput[] {
    return perceptions.map((p) => ({
      url: p.url,
      title: p.title,
      text: p.mainText,
      headings: p.headings
    }));
  }

  public toMarkdown(report: ResearchReport): string {
    const lines: string[] = [
      `# Research Report: ${report.query}`,
      `Generated: ${new Date(report.createdAt).toISOString()}`,
      '',
      '## Executive Summary',
      report.summary,
      ''
    ];

    if (report.claims.length > 0) {
      lines.push('## Evidence & Claims');
      for (const c of report.claims) {
        lines.push(
          `- **[${c.kind.toUpperCase()}]** ${c.claim} _(Confidence: ${Math.round(c.confidence * 100)}%)_`
        );
        if (c.supportingQuote) {
          lines.push(`  > "${c.supportingQuote}" — [${c.sourceTitle}](${c.sourceUrl})`);
        }
      }
      lines.push('');
    }

    if (report.conflicts.length > 0) {
      lines.push('## Detected Contradictions');
      for (const cf of report.conflicts) {
        lines.push(`- **${cf.topic}**: "${cf.statementA}" (${cf.sourceA}) vs. "${cf.statementB}" (${cf.sourceB})`);
      }
      lines.push('');
    }

    if (report.comparisonTable && report.comparisonTable.columns.length > 0) {
      lines.push('## Comparison Table');
      lines.push(`| ${report.comparisonTable.columns.join(' | ')} |`);
      lines.push(`| ${report.comparisonTable.columns.map(() => '---').join(' | ')} |`);
      for (const row of report.comparisonTable.rows) {
        lines.push(`| ${row.join(' | ')} |`);
      }
      lines.push('');
    }

    if (report.notes) {
      lines.push('## Research Notes', report.notes, '');
    }

    lines.push('## Sources');
    for (const s of report.sources) {
      lines.push(`- [${s.title}](${s.url})`);
    }
    return lines.join('\n');
  }
}

import Ajv from 'ajv';
import { randomUUID } from 'node:crypto';
import type { ExtractionResult } from '@shared/types';
import type { ModelProvider } from './providers/model-provider';
import type { InjectionGuard } from '@main/security/injection-guard';

export class StructuredExtractionEngine {
  private ajv = new Ajv({ allErrors: true, strict: false });

  constructor(
    private readonly getProvider: () => ModelProvider,
    private readonly injectionGuard: InjectionGuard
  ) {}

  public validateAgainstSchema(
    data: unknown,
    schema: Record<string, unknown>
  ): { valid: boolean; errors: string[] } {
    try {
      const validate = this.ajv.compile(schema);
      const valid = Boolean(validate(data));
      const errors = (validate.errors ?? []).map(
        (e) => `${e.instancePath || 'root'} ${e.message ?? 'invalid'}`
      );
      return { valid, errors };
    } catch (err) {
      return {
        valid: false,
        errors: [err instanceof Error ? err.message : 'Invalid JSON Schema']
      };
    }
  }

  public async extract(params: {
    url: string;
    pageTitle: string;
    pageText: string;
    tablesSummary: string[];
    schema: Record<string, unknown>;
    instructions: string;
    model: string;
    maxRetries?: number;
  }): Promise<ExtractionResult> {
    const maxRetries = params.maxRetries ?? 2;
    const provider = this.getProvider();
    let attempts = 0;
    let lastValidationErrors: string[] = [];
    let lastParsedRecords: Array<Record<string, unknown>> = [];
    let lastEvidence: Array<{ field: string; sourceUrl: string; snippet: string }> = [];

    const wrapperSchema = {
      type: 'object',
      properties: {
        records: {
          type: 'array',
          items: params.schema
        },
        evidence: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              snippet: { type: 'string' }
            },
            required: ['field', 'snippet']
          }
        }
      },
      required: ['records', 'evidence']
    };

    const safeContent = this.injectionGuard.wrapUntrustedContent(
      params.url,
      [
        `URL: ${params.url}`,
        `TITLE: ${params.pageTitle}`,
        params.tablesSummary.length ? `TABLES:\n${params.tablesSummary.join('\n')}` : '',
        `TEXT:\n${params.pageText.slice(0, 14000)}`
      ]
        .filter(Boolean)
        .join('\n\n')
    );

    while (attempts <= maxRetries) {
      attempts += 1;
      const retryNote =
        lastValidationErrors.length > 0
          ? `\nPrevious attempt failed JSON Schema validation with errors:\n${lastValidationErrors.join('\n')}\nFix these exact schema errors without fabricating missing values (use null if absent).`
          : '';

      const resp = await provider.generate({
        model: params.model,
        systemInstruction:
          'You are the Atlas Structured Extraction Engine. Extract ONLY facts present in the untrusted page content. Never fabricate missing values; use null when a field is absent or unavailable.',
        messages: [
          {
            role: 'user',
            parts: [
              {
                text: `Extraction request: ${params.instructions}\n\nTarget record JSON Schema:\n${JSON.stringify(params.schema, null, 2)}${retryNote}\n\n${safeContent}`
              }
            ]
          }
        ],
        responseSchema: wrapperSchema,
        temperature: 0
      });

      try {
        const parsed = JSON.parse(resp.text) as {
          records?: Array<Record<string, unknown>>;
          evidence?: Array<{ field: string; snippet: string }>;
        };
        const records = Array.isArray(parsed.records) ? parsed.records : [];
        const evidence = Array.isArray(parsed.evidence)
          ? parsed.evidence.map((e) => ({
              field: e.field,
              sourceUrl: params.url,
              snippet: e.snippet
            }))
          : [];

        lastParsedRecords = records;
        lastEvidence = evidence;

        const allErrors: string[] = [];
        if (records.length === 0) {
          allErrors.push('No records extracted');
        }
        records.forEach((rec, idx) => {
          const v = this.validateAgainstSchema(rec, params.schema);
          if (!v.valid) {
            allErrors.push(...v.errors.map((e) => `record[${idx}]: ${e}`));
          }
        });

        lastValidationErrors = allErrors;
        if (allErrors.length === 0) {
          return {
            id: randomUUID(),
            url: params.url,
            schema: params.schema,
            records,
            evidence,
            valid: true,
            validationErrors: [],
            attempts,
            createdAt: Date.now()
          };
        }
      } catch (err) {
        lastValidationErrors = [err instanceof Error ? err.message : 'Invalid JSON output'];
      }
    }

    return {
      id: randomUUID(),
      url: params.url,
      schema: params.schema,
      records: lastParsedRecords,
      evidence: lastEvidence,
      valid: false,
      validationErrors: lastValidationErrors,
      attempts,
      createdAt: Date.now()
    };
  }

  public toCsv(records: Array<Record<string, unknown>>): string {
    if (records.length === 0) return '';
    const headers = Array.from(
      records.reduce((set, rec) => {
        Object.keys(rec).forEach((k) => set.add(k));
        return set;
      }, new Set<string>())
    );

    const escapeCell = (val: unknown): string => {
      if (val === null || val === undefined) return '';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines = [
      headers.map(escapeCell).join(','),
      ...records.map((rec) => headers.map((h) => escapeCell(rec[h])).join(','))
    ];
    return lines.join('\n');
  }
}

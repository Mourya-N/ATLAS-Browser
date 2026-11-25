import type { ProviderTestResult } from '@shared/types';
import type {
  ModelFunctionCall,
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelMessage,
  ModelProvider
} from './model-provider';

export type GeminiErrorCode =
  | 'missing_key'
  | 'invalid_key'
  | 'model_unavailable'
  | 'rate_limited'
  | 'malformed_response'
  | 'network_error'
  | 'aborted'
  | 'api_error';

export class GeminiApiError extends Error {
  constructor(
    message: string,
    public readonly code: GeminiErrorCode,
    public readonly statusCode?: number,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'GeminiApiError';
  }
}

export interface GeminiProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function toGeminiContents(messages: ModelMessage[]): Array<{ role: string; parts: unknown[] }> {
  return messages.map((m) => ({
    role: m.role === 'tool' ? 'user' : m.role,
    parts: m.parts.map((p) => {
      if (p.functionCall) {
        return { functionCall: { name: p.functionCall.name, args: p.functionCall.args } };
      }
      if (p.functionResponse) {
        return { functionResponse: { name: p.functionResponse.name, response: p.functionResponse.response } };
      }
      if (p.inlineData) {
        return { inlineData: { mimeType: p.inlineData.mimeType, data: p.inlineData.data } };
      }
      return { text: p.text ?? '' };
    })
  }));
}

function classifyHttpError(status: number, bodyText: string): GeminiApiError {
  const snippet = bodyText.slice(0, 400);
  if (status === 401 || (status === 400 && /api[_\s]?key/i.test(snippet)) || status === 403) {
    return new GeminiApiError(
      `Gemini authentication failed (${status}): verify your GEMINI_API_KEY.`,
      'invalid_key',
      status,
      false
    );
  }
  if (status === 404) {
    return new GeminiApiError(
      `Gemini model unavailable or not found (${status}): ${snippet}`,
      'model_unavailable',
      status,
      false
    );
  }
  if (status === 429) {
    return new GeminiApiError(
      `Gemini rate limit exceeded (429): ${snippet}`,
      'rate_limited',
      status,
      true
    );
  }
  if (status >= 500) {
    return new GeminiApiError(
      `Gemini upstream service error (${status}): ${snippet}`,
      'api_error',
      status,
      true
    );
  }
  return new GeminiApiError(`Gemini API error (${status}): ${snippet}`, 'api_error', status, false);
}

function combineSignals(callerSignal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new GeminiApiError(`Gemini request timed out after ${timeoutMs}ms`, 'aborted'));
  }, timeoutMs);

  const onCallerAbort = () => {
    controller.abort(callerSignal?.reason ?? new GeminiApiError('Request aborted by caller', 'aborted'));
  };

  if (callerSignal) {
    if (callerSignal.aborted) {
      onCallerAbort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  };
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new GeminiApiError('Request aborted', 'aborted');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GeminiApiError('Request aborted during backoff', 'aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class GeminiProvider implements ModelProvider {
  public readonly id = 'gemini';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(
    private readonly getApiKey: () => string | undefined,
    options: GeminiProviderOptions = {}
  ) {
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 400;
  }

  public async testConnection(model = 'gemini-2.5-flash'): Promise<ProviderTestResult> {
    const started = Date.now();
    const apiKey = this.getApiKey()?.trim();
    if (!apiKey) {
      return {
        ok: false,
        provider: this.id,
        model,
        latencyMs: 0,
        capabilities: { tools: false, structuredOutput: false, vision: false },
        error: 'No Gemini API key configured. Enter a key in Settings or set GEMINI_API_KEY.'
      };
    }

    const { signal, cleanup } = combineSignals(undefined, Math.min(15_000, this.timeoutMs));
    try {
      const endpoint = `${this.baseUrl}/models/${encodeURIComponent(model)}`;
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
        signal
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = classifyHttpError(res.status, body);
        return {
          ok: false,
          provider: this.id,
          model,
          latencyMs: Date.now() - started,
          capabilities: { tools: false, structuredOutput: false, vision: false },
          error: err.message
        };
      }
      const meta = (await res.json()) as {
        name?: string;
        supportedGenerationMethods?: string[];
      };
      const methods = meta.supportedGenerationMethods ?? [];
      const supportsGen = methods.includes('generateContent');
      return {
        ok: supportsGen,
        provider: this.id,
        model,
        latencyMs: Date.now() - started,
        capabilities: {
          tools: supportsGen,
          structuredOutput: supportsGen,
          vision: supportsGen && !model.includes('embedding')
        },
        error: supportsGen ? undefined : `Model ${model} does not support generateContent`
      };
    } catch (err) {
      return {
        ok: false,
        provider: this.id,
        model,
        latencyMs: Date.now() - started,
        capabilities: { tools: false, structuredOutput: false, vision: false },
        error: err instanceof Error ? err.message : 'Network connection failed'
      };
    } finally {
      cleanup();
    }
  }

  public async generate(request: ModelGenerateRequest): Promise<ModelGenerateResponse> {
    const apiKey = this.getApiKey()?.trim();
    if (!apiKey) {
      throw new GeminiApiError(
        'Gemini API key is not configured. Open Settings → AI Provider to add your Gemini API key securely.',
        'missing_key',
        undefined,
        false
      );
    }

    const model = request.model || 'gemini-2.5-flash';
    const body: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: request.systemInstruction }]
      },
      contents: toGeminiContents(request.messages),
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxOutputTokens ?? 2048,
        ...(request.responseSchema
          ? {
              responseMimeType: 'application/json',
              responseSchema: request.responseSchema
            }
          : {})
      }
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }))
        }
      ];
    }

    const useStreaming = Boolean(request.onTextDelta) && !request.responseSchema;
    const endpoint = useStreaming
      ? `${this.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
      : `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (request.signal?.aborted) {
        throw new GeminiApiError('Gemini request cancelled', 'aborted', undefined, false);
      }

      const { signal, cleanup } = combineSignals(request.signal, this.timeoutMs);
      try {
        // Send API key exclusively via x-goog-api-key header (never in URL query string)
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(body),
          signal
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const classified = classifyHttpError(res.status, errText);
          if (classified.retryable && attempt < this.maxRetries) {
            const retryAfterSec = Number(res.headers.get('retry-after') || '0');
            const delayMs =
              retryAfterSec > 0
                ? Math.min(10_000, retryAfterSec * 1000)
                : this.baseDelayMs * Math.pow(2, attempt);
            lastError = classified;
            cleanup();
            await sleepWithAbort(delayMs, request.signal);
            continue;
          }
          throw classified;
        }

        if (useStreaming && res.body) {
          return await this.consumeSse(res.body, request);
        }

        let json: {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string;
                functionCall?: { name: string; args?: Record<string, unknown> };
              }>;
            };
            finishReason?: string;
          }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };

        try {
          json = (await res.json()) as typeof json;
        } catch (parseErr) {
          throw new GeminiApiError(
            `Malformed JSON response from Gemini API: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`,
            'malformed_response',
            res.status,
            false
          );
        }

        if (!json || typeof json !== 'object' || !Array.isArray(json.candidates)) {
          throw new GeminiApiError(
            'Malformed Gemini response: missing candidates array',
            'malformed_response',
            res.status,
            false
          );
        }

        const candidate = json.candidates[0];
        const parts = candidate?.content?.parts ?? [];
        let text = '';
        const functionCalls: ModelFunctionCall[] = [];

        for (const part of parts) {
          if (part.text) text += part.text;
          if (part.functionCall) {
            functionCalls.push({
              name: part.functionCall.name,
              args: part.functionCall.args ?? {}
            });
          }
        }

        const inputTokens =
          json.usageMetadata?.promptTokenCount ??
          estimateTokens(request.systemInstruction + JSON.stringify(request.messages));
        const outputTokens = json.usageMetadata?.candidatesTokenCount ?? estimateTokens(text);

        return {
          text,
          functionCalls,
          usage: {
            inputTokens,
            outputTokens,
            fromProvider: Boolean(json.usageMetadata?.promptTokenCount)
          },
          finishReason: candidate?.finishReason
        };
      } catch (err) {
        if (err instanceof GeminiApiError) {
          if (!err.retryable || attempt >= this.maxRetries) throw err;
          lastError = err;
        } else if (request.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
          throw new GeminiApiError('Gemini request aborted or timed out', 'aborted', undefined, false);
        } else {
          // Transient network failure -> retry with backoff
          const netErr = new GeminiApiError(
            `Network error calling Gemini API: ${err instanceof Error ? err.message : String(err)}`,
            'network_error',
            undefined,
            true
          );
          if (attempt >= this.maxRetries) throw netErr;
          lastError = netErr;
        }
        await sleepWithAbort(this.baseDelayMs * Math.pow(2, attempt), request.signal);
      } finally {
        cleanup();
      }
    }

    throw lastError ?? new GeminiApiError('Gemini request failed after retries', 'api_error');
  }

  private async consumeSse(
    stream: ReadableStream<Uint8Array>,
    request: ModelGenerateRequest
  ): Promise<ModelGenerateResponse> {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let buffer = '';
    let fullText = '';
    const functionCalls: ModelFunctionCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let fromProvider = false;
    let finishReason: string | undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const rawJson = line.slice(5).trim();
        if (!rawJson || rawJson === '[DONE]') continue;
        try {
          const chunk = JSON.parse(rawJson) as {
            candidates?: Array<{
              content?: {
                parts?: Array<{
                  text?: string;
                  functionCall?: { name: string; args?: Record<string, unknown> };
                }>;
              };
              finishReason?: string;
            }>;
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          };
          const cand = chunk.candidates?.[0];
          if (cand?.finishReason) finishReason = cand.finishReason;
          for (const part of cand?.content?.parts ?? []) {
            if (part.text) {
              fullText += part.text;
              request.onTextDelta?.(part.text);
            }
            if (part.functionCall) {
              functionCalls.push({
                name: part.functionCall.name,
                args: part.functionCall.args ?? {}
              });
            }
          }
          if (chunk.usageMetadata?.promptTokenCount) {
            inputTokens = chunk.usageMetadata.promptTokenCount;
            outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
            fromProvider = true;
          }
        } catch {
          // ignore partial SSE chunks
        }
      }
    }

    if (!fromProvider) {
      inputTokens = estimateTokens(request.systemInstruction + JSON.stringify(request.messages));
      outputTokens = estimateTokens(fullText);
    }

    return {
      text: fullText,
      functionCalls,
      usage: { inputTokens, outputTokens, fromProvider },
      finishReason
    };
  }
}

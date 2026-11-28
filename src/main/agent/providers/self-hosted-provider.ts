import type { ProviderTestResult, SelfHostedRuntimeStatus } from '@shared/types';
import { GeminiApiError } from './gemini-provider';
import type {
  ModelFunctionCall,
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelMessage,
  ModelProvider
} from './model-provider';

export interface SelfHostedProviderOptions {
  getEndpointUrl: () => string;
  getApiKey?: () => string | undefined;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

function normalizeV1BaseUrl(rawUrl: string): string {
  const clean = rawUrl.trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (clean.endsWith('/v1')) return clean;
  return `${clean}/v1`;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function toOpenAiMessages(
  systemInstruction: string,
  messages: ModelMessage[]
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (systemInstruction.trim()) {
    out.push({ role: 'system', content: systemInstruction });
  }

  for (const m of messages) {
    if (m.role === 'tool') {
      const fnResp = m.parts.find((p) => p.functionResponse)?.functionResponse;
      if (fnResp) {
        out.push({
          role: 'tool',
          name: fnResp.name,
          tool_call_id: `call_${fnResp.name}`,
          content: JSON.stringify(fnResp.response)
        });
        continue;
      }
    }

    const fnCalls = m.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (m.role === 'model' && fnCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: m.parts.map((p) => p.text || '').join('') || null,
        tool_calls: fnCalls.map((fc, idx) => ({
          id: `call_${fc.name}_${idx}`,
          type: 'function',
          function: {
            name: fc.name,
            arguments: JSON.stringify(fc.args ?? {})
          }
        }))
      });
      continue;
    }

    const hasImages = m.parts.some((p) => Boolean(p.inlineData));
    if (hasImages) {
      out.push({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.parts.map((p) =>
          p.inlineData
            ? {
                type: 'image_url',
                image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` }
              }
            : { type: 'text', text: p.text ?? '' }
        )
      });
    } else {
      out.push({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.parts.map((p) => p.text ?? '').join('\n')
      });
    }
  }

  return out;
}

function stripJsonCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

export class SelfHostedOpenAiProvider implements ModelProvider {
  public readonly id = 'self_hosted';
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(private readonly opts: SelfHostedProviderOptions) {
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.maxRetries = opts.maxRetries ?? 1;
    this.baseDelayMs = opts.baseDelayMs ?? 300;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = this.opts.getApiKey?.()?.trim();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }

  public async listModels(): Promise<{ ok: boolean; models: string[]; latencyMs: number; error?: string }> {
    const rawEndpoint = this.opts.getEndpointUrl();
    const baseUrl = normalizeV1BaseUrl(rawEndpoint);
    if (!baseUrl) {
      return {
        ok: false,
        models: [],
        latencyMs: 0,
        error: 'No self-hosted inference endpoint configured (e.g. http://127.0.0.1:11434/v1).'
      };
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: controller.signal
      });
      if (!res.ok) {
        return {
          ok: false,
          models: [],
          latencyMs: Date.now() - started,
          error: `Runtime /v1/models returned HTTP ${res.status}`
        };
      }
      const data = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> };
      const models = (data.data ?? [])
        .map((m) => m.id || '')
        .concat((data.models ?? []).map((m) => m.name || ''))
        .filter(Boolean);
      return { ok: true, models: Array.from(new Set(models)), latencyMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        models: [],
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : 'Unable to reach inference server'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async getRuntimeStatus(configuredModel: string): Promise<SelfHostedRuntimeStatus> {
    const endpointUrl = this.opts.getEndpointUrl().trim();
    if (!endpointUrl) {
      return {
        backendKind: 'self_hosted',
        endpointUrl: '',
        configuredModel,
        reachable: false,
        modelAvailable: false,
        availableModels: [],
        latencyMs: 0,
        supportsStreaming: true,
        supportsTools: true,
        supportsStructuredOutput: true,
        statusMessage: 'Self-hosted endpoint URL is not configured.'
      };
    }

    const discovery = await this.listModels();
    if (!discovery.ok) {
      return {
        backendKind: 'self_hosted',
        endpointUrl,
        configuredModel,
        reachable: false,
        modelAvailable: false,
        availableModels: [],
        latencyMs: discovery.latencyMs,
        supportsStreaming: true,
        supportsTools: true,
        supportsStructuredOutput: true,
        statusMessage: `Inference endpoint unreachable (${discovery.error}). Ensure Ollama / vLLM / llama.cpp is running.`
      };
    }

    const modelAvailable =
      Boolean(configuredModel) &&
      (discovery.models.length === 0 ||
        discovery.models.some(
          (m) => m === configuredModel || m.startsWith(`${configuredModel}:`)
        ));

    return {
      backendKind: 'self_hosted',
      endpointUrl,
      configuredModel,
      reachable: true,
      modelAvailable,
      availableModels: discovery.models,
      latencyMs: discovery.latencyMs,
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      statusMessage: modelAvailable
        ? `Connected to self-hosted runtime (${discovery.models.length} model(s) ready)`
        : `Endpoint reachable, but model "${configuredModel}" was not found. Available: ${discovery.models.join(', ') || 'none'}`
    };
  }

  public async testConnection(model: string): Promise<ProviderTestResult> {
    const status = await this.getRuntimeStatus(model);
    return {
      ok: status.reachable && status.modelAvailable,
      provider: this.id,
      model,
      latencyMs: status.latencyMs,
      capabilities: {
        tools: status.supportsTools,
        structuredOutput: status.supportsStructuredOutput,
        vision: false
      },
      error: status.reachable && status.modelAvailable ? undefined : status.statusMessage
    };
  }

  public async generate(request: ModelGenerateRequest): Promise<ModelGenerateResponse> {
    const baseUrl = normalizeV1BaseUrl(this.opts.getEndpointUrl());
    if (!baseUrl) {
      throw new GeminiApiError(
        'Self-hosted model endpoint is not configured (set selfHostedEndpointUrl or LAVRAY_SELF_HOSTED_URL).',
        'missing_key'
      );
    }

    const streaming = Boolean(request.onTextDelta) && !request.responseSchema;
    const bodyPayload: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAiMessages(request.systemInstruction, request.messages),
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxOutputTokens ?? 2048,
      stream: streaming
    };

    if (streaming) {
      bodyPayload.stream_options = { include_usage: true };
    }

    if (request.tools && request.tools.length > 0) {
      bodyPayload.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

    if (request.responseSchema) {
      bodyPayload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'lavray_structured_output',
          strict: true,
          schema: request.responseSchema
        }
      };
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('Self-hosted inference timeout')), this.timeoutMs);
      const onCallerAbort = () => controller.abort(request.signal?.reason);
      if (request.signal) {
        if (request.signal.aborted) onCallerAbort();
        else request.signal.addEventListener('abort', onCallerAbort, { once: true });
      }

      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(bodyPayload),
          signal: controller.signal
        });

        // Fallback gracefully if an OpenAI-compatible server rejects json_schema -> retry once with json_object
        if (res.status === 400 && bodyPayload.response_format && attempt === 0) {
          bodyPayload.response_format = { type: 'json_object' };
          continue;
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          if (res.status === 404) {
            throw new GeminiApiError(
              `Configured self-hosted model "${request.model}" not found on server: ${errText.slice(0, 200)}`,
              'model_unavailable',
              res.status,
              false
            );
          }
          const retryable = res.status === 429 || res.status >= 500;
          if (retryable && attempt < this.maxRetries) {
            await new Promise((r) => setTimeout(r, this.baseDelayMs * Math.pow(2, attempt)));
            continue;
          }
          throw new GeminiApiError(
            `Self-hosted runtime HTTP ${res.status}: ${errText.slice(0, 250)}`,
            res.status === 401 || res.status === 403 ? 'invalid_key' : 'api_error',
            res.status,
            retryable
          );
        }

        if (streaming && res.body) {
          return await this.consumeOpenAiSse(res.body, request);
        }

        const json = (await res.json()) as {
          choices?: Array<{
            message?: {
              content?: string | null;
              tool_calls?: Array<{
                function?: { name?: string; arguments?: string | Record<string, unknown> };
              }>;
            };
            finish_reason?: string;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        const choice = json.choices?.[0];
        const rawText = choice?.message?.content || '';
        const text = request.responseSchema ? stripJsonCodeFences(rawText) : rawText;

        const functionCalls: ModelFunctionCall[] = (choice?.message?.tool_calls ?? [])
          .filter((tc) => Boolean(tc.function?.name))
          .map((tc) => {
            let parsedArgs: Record<string, unknown> = {};
            const rawArgs = tc.function?.arguments;
            if (typeof rawArgs === 'string') {
              try {
                parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
              } catch {
                parsedArgs = {};
              }
            } else if (rawArgs && typeof rawArgs === 'object') {
              parsedArgs = rawArgs;
            }
            return { name: tc.function!.name!, args: parsedArgs };
          });

        return {
          text,
          functionCalls,
          usage: {
            inputTokens:
              json.usage?.prompt_tokens ??
              estimateTokens(request.systemInstruction + JSON.stringify(request.messages)),
            outputTokens: json.usage?.completion_tokens ?? estimateTokens(text),
            fromProvider: Boolean(json.usage?.prompt_tokens)
          },
          finishReason: choice?.finish_reason
        };
      } catch (err) {
        if (err instanceof GeminiApiError) throw err;
        if (request.signal?.aborted) {
          throw new GeminiApiError('Self-hosted inference cancelled by caller', 'aborted', undefined, false);
        }
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.baseDelayMs * Math.pow(2, attempt)));
          continue;
        }
        throw new GeminiApiError(
          `Network/timeout error reaching self-hosted model runtime: ${err instanceof Error ? err.message : String(err)}`,
          'network_error',
          undefined,
          true
        );
      } finally {
        clearTimeout(timer);
        if (request.signal) request.signal.removeEventListener('abort', onCallerAbort);
      }
    }

    throw new GeminiApiError('Self-hosted inference exhausted retries', 'api_error');
  }

  private async consumeOpenAiSse(
    stream: ReadableStream<Uint8Array>,
    request: ModelGenerateRequest
  ): Promise<ModelGenerateResponse> {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let buffer = '';
    let fullText = '';
    const toolBuffers = new Map<number, { name: string; argumentsStr: string }>();
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
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const chunk = JSON.parse(raw) as {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index?: number;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const c = chunk.choices?.[0];
          if (c?.finish_reason) finishReason = c.finish_reason;
          if (c?.delta?.content) {
            fullText += c.delta.content;
            request.onTextDelta?.(c.delta.content);
          }
          for (const tc of c?.delta?.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            const prev = toolBuffers.get(idx) ?? { name: '', argumentsStr: '' };
            if (tc.function?.name) prev.name += tc.function.name;
            if (tc.function?.arguments) prev.argumentsStr += tc.function.arguments;
            toolBuffers.set(idx, prev);
          }
          if (chunk.usage?.prompt_tokens) {
            inputTokens = chunk.usage.prompt_tokens;
            outputTokens = chunk.usage.completion_tokens ?? outputTokens;
            fromProvider = true;
          }
        } catch {
          // ignore partial SSE chunks
        }
      }
    }

    const functionCalls: ModelFunctionCall[] = [];
    for (const buf of toolBuffers.values()) {
      if (!buf.name) continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(buf.argumentsStr || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }
      functionCalls.push({ name: buf.name, args });
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

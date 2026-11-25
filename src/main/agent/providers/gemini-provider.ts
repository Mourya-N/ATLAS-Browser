import type {
  ModelFunctionCall,
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelMessage,
  ModelProvider
} from './model-provider';

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

export class GeminiProvider implements ModelProvider {
  public readonly id = 'gemini';

  constructor(private readonly getApiKey: () => string | undefined) {}

  public async generate(request: ModelGenerateRequest): Promise<ModelGenerateResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(
        'Gemini API key is not configured. Open Settings → AI Provider to add your Gemini API key securely.'
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
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 400)}`);
    }

    if (useStreaming && res.body) {
      return this.consumeSse(res.body, request);
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const candidate = json.candidates?.[0];
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
          // ignore malformed partial SSE lines
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

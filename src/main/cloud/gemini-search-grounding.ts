import { randomUUID } from 'node:crypto';
import type { AiCitedAnswer } from '@shared/types';
import type { FetchLike } from './web-discovery';

interface GeminiGroundedResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string };
      }>;
      groundingSupports?: Array<{
        segment?: { text?: string };
        groundingChunkIndices?: number[];
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

function safeHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

/**
 * Queries Gemini API with native Google Search Grounding (`tools: [{ googleSearch: {} }]`)
 * using the `x-goog-api-key` header (never in URL). Returns a grounded AI Overview with real
 * `groundingChunks` citations when a Gemini API key is configured.
 */
export async function generateGeminiGroundedOverview(params: {
  apiKey: string;
  query: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}): Promise<AiCitedAnswer | null> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) return null;

  const started = Date.now();
  const model = params.model || 'gemini-2.5-flash';
  const fetchImpl = params.fetchFn ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 6500);

  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                `You are LAVRAY AI Overview. Today's date is ${todayIso}. Give an accurate, neutral, Google-style overview grounded strictly in the Google Search results you retrieve. Start with a 1-2 sentence direct answer with key verified figures in **bold**, followed by concise bullet points (\`- **Label:** value\`). If retrieved sources give differing values (e.g. across regions or jewellers), state the exact range and note the difference. If current verified data is unavailable in retrieved results, state that clearly. Never guess or fabricate numbers, dates, or URLs.`
            }
          ]
        },
        contents: [{ role: 'user', parts: [{ text: params.query }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 700
        }
      })
    });

    if (!res.ok) return null;
    const data = (await res.json()) as GeminiGroundedResponse;
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text || '').join('').trim();
    if (!text) return null;

    const chunks = (cand?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web)
      .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri && /^https?:\/\//i.test(w.uri)));

    // Require genuine retrieved web grounding chunks so ungrounded parametric guesses are never surfaced
    if (chunks.length === 0) return null;

    const citations = chunks.slice(0, 6).map((c, idx) => ({
      index: idx + 1,
      url: c.uri,
      title: c.title || safeHostname(c.uri),
      domain: safeHostname(c.uri)
    }));

    const claims = (cand?.groundingMetadata?.groundingSupports ?? [])
      .slice(0, 4)
      .map((sup) => {
        const chunkIdx = sup.groundingChunkIndices?.[0] ?? 0;
        const src = chunks[chunkIdx];
        const segText = sup.segment?.text?.trim() || '';
        if (!src || segText.length < 10) return null;
        return {
          id: randomUUID(),
          statement: segText,
          kind: 'fact' as const,
          sourceUrl: src.uri,
          sourceTitle: src.title || safeHostname(src.uri),
          supportingQuote: segText.slice(0, 160),
          verifiedAgainstSource: true
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    return {
      status: 'ok',
      summary: text,
      claims,
      contradictions: [],
      passages: citations.map((c, idx) => ({
        sourceUrl: c.url,
        sourceTitle: c.title,
        domain: c.domain,
        passageIndex: idx,
        excerpt: text.slice(0, 260),
        relevance: 0.95
      })),
      citations,
      model,
      provider: 'gemini_google_search',
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      estimatedCostUsd: 0,
      latencyMs: Date.now() - started
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

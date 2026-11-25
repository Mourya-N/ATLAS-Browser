import { describe, expect, it } from 'vitest';
import { GeminiProvider } from '@main/agent/providers/gemini-provider';

const apiKey = process.env.GEMINI_API_KEY?.trim();

describe('Live Gemini API Integration', () => {
  if (!apiKey) {
    it('reports unverified status honestly when no GEMINI_API_KEY is available', () => {
      console.warn('[GEMINI_LIVE] SKIPPED: No GEMINI_API_KEY configured in environment or SecretVault.');
      expect(apiKey).toBeFalsy();
    });
    return;
  }

  const provider = new GeminiProvider(() => apiKey);
  const model = 'gemini-2.5-flash';

  it('supports structured output, streaming, token usage, function calling, vision, error handling, and cancellation', async () => {
    // 1. Streaming + Token Usage
    let streamed = '';
    const streamRes = await provider.generate({
      model,
      systemInstruction: 'Reply concisely.',
      messages: [{ role: 'user', parts: [{ text: 'Say "ATLAS_OK" and nothing else.' }] }],
      onTextDelta: (d) => {
        streamed += d;
      }
    });
    expect(streamRes.text).toContain('ATLAS_OK');
    expect(streamed.length).toBeGreaterThan(0);
    expect(streamRes.usage.inputTokens).toBeGreaterThan(0);
    expect(streamRes.usage.outputTokens).toBeGreaterThan(0);

    // 2. Structured output
    const structRes = await provider.generate({
      model,
      systemInstruction: 'Return JSON matching schema.',
      messages: [{ role: 'user', parts: [{ text: 'Return status ok and count 2.' }] }],
      responseSchema: {
        type: 'object',
        properties: { status: { type: 'string' }, count: { type: 'number' } },
        required: ['status', 'count']
      }
    });
    const parsed = JSON.parse(structRes.text);
    expect(typeof parsed.status).toBe('string');
    expect(typeof parsed.count).toBe('number');

    // 3. Function calling
    const toolRes = await provider.generate({
      model,
      systemInstruction: 'Always call get_current_url tool.',
      messages: [{ role: 'user', parts: [{ text: 'Check the current tab URL.' }] }],
      tools: [
        {
          name: 'get_current_url',
          description: 'Get URL of active tab',
          parameters: { type: 'object', properties: {} }
        }
      ]
    });
    expect(toolRes.functionCalls.length).toBeGreaterThan(0);

    // 4. Vision input (1x1 transparent PNG)
    const tinyPng =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const visionRes = await provider.generate({
      model,
      systemInstruction: 'Acknowledge image.',
      messages: [
        {
          role: 'user',
          parts: [
            { text: 'Confirm you received an image by replying RECEIVED.' },
            { inlineData: { mimeType: 'image/png', data: tinyPng } }
          ]
        }
      ]
    });
    expect(visionRes.text.length).toBeGreaterThan(0);

    // 5. API error handling
    await expect(
      provider.generate({
        model: 'non-existent-gemini-model-xyz',
        systemInstruction: 'Hi',
        messages: [{ role: 'user', parts: [{ text: 'Hi' }] }]
      })
    ).rejects.toThrow(/Gemini API error/);

    // 6. Cancellation
    const ac = new AbortController();
    ac.abort(new Error('Cancelled by test'));
    await expect(
      provider.generate({
        model,
        systemInstruction: 'Hi',
        messages: [{ role: 'user', parts: [{ text: 'Write an essay.' }] }],
        signal: ac.signal
      })
    ).rejects.toThrow();
  });
});

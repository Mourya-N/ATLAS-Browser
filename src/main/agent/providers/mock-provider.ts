import type {
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelProvider
} from './model-provider';

export type MockResponder = (
  request: ModelGenerateRequest,
  callIndex: number
) => ModelGenerateResponse | Promise<ModelGenerateResponse>;

export class MockModelProvider implements ModelProvider {
  public readonly id = 'mock';
  private callIndex = 0;
  private queue: ModelGenerateResponse[] = [];

  constructor(private responder?: MockResponder) {}

  public enqueue(responses: ModelGenerateResponse[]): void {
    this.queue.push(...responses);
  }

  public setResponder(responder: MockResponder): void {
    this.responder = responder;
    this.callIndex = 0;
  }

  public reset(): void {
    this.callIndex = 0;
    this.queue = [];
  }

  public async generate(request: ModelGenerateRequest): Promise<ModelGenerateResponse> {
    const idx = this.callIndex++;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (next.text && request.onTextDelta) {
        request.onTextDelta(next.text);
      }
      return next;
    }
    if (this.responder) {
      const resp = await this.responder(request, idx);
      if (resp.text && request.onTextDelta) {
        request.onTextDelta(resp.text);
      }
      return resp;
    }

    const fallbackText = request.responseSchema
      ? JSON.stringify({
          planSummary: 'Inspect page and complete goal',
          subgoals: [
            {
              description: 'Inspect current page content',
              expectedEvidence: 'Page title and text observed'
            }
          ]
        })
      : 'Completed inspection of the current page.';

    return {
      text: fallbackText,
      functionCalls: [],
      usage: { inputTokens: 120, outputTokens: 45, fromProvider: false },
      finishReason: 'STOP'
    };
  }
}

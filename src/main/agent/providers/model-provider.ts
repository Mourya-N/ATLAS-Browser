export interface ModelToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ModelMessagePart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: ModelFunctionCall;
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface ModelMessage {
  role: 'user' | 'model' | 'tool';
  parts: ModelMessagePart[];
}

export interface ModelGenerateRequest {
  model: string;
  systemInstruction: string;
  messages: ModelMessage[];
  tools?: ModelToolDeclaration[];
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onTextDelta?: (chunk: string) => void;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  fromProvider: boolean;
}

export interface ModelGenerateResponse {
  text: string;
  functionCalls: ModelFunctionCall[];
  usage: ModelUsage;
  finishReason?: string;
}

export interface ModelProvider {
  readonly id: string;
  generate(request: ModelGenerateRequest): Promise<ModelGenerateResponse>;
}

export interface ModelPricing {
  provider: string;
  model: string;
  displayName: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  supportsTools: boolean;
  contextWindowTokens: number;
  knownPricing: boolean;
}

export const DEFAULT_MODEL_PRICING: ModelPricing[] = [
  {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.6,
    supportsVision: true,
    supportsStructuredOutput: true,
    supportsTools: true,
    contextWindowTokens: 1_000_000,
    knownPricing: true
  },
  {
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 10.0,
    supportsVision: true,
    supportsStructuredOutput: true,
    supportsTools: true,
    contextWindowTokens: 1_000_000,
    knownPricing: true
  },
  {
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    inputPerMillionUsd: 0.1,
    outputPerMillionUsd: 0.4,
    supportsVision: true,
    supportsStructuredOutput: true,
    supportsTools: true,
    contextWindowTokens: 1_000_000,
    knownPricing: true
  },
  {
    provider: 'gemini',
    model: 'gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 5.0,
    supportsVision: true,
    supportsStructuredOutput: true,
    supportsTools: true,
    contextWindowTokens: 2_000_000,
    knownPricing: true
  },
  {
    provider: 'mock',
    model: 'mock-deterministic',
    displayName: 'Mock Deterministic (Test)',
    inputPerMillionUsd: 0,
    outputPerMillionUsd: 0,
    supportsVision: true,
    supportsStructuredOutput: true,
    supportsTools: true,
    contextWindowTokens: 128_000,
    knownPricing: true
  }
];

export function calculateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  usageFromProvider: boolean,
  customPricingTable: ModelPricing[] = DEFAULT_MODEL_PRICING
): { costUsd: number; isEstimated: boolean } {
  const pricing = customPricingTable.find((m) => m.model === model);
  if (!pricing || !pricing.knownPricing) {
    // Unknown pricing — return 0 and explicitly mark estimated
    return { costUsd: 0, isEstimated: true };
  }
  const inputCost = (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost = (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPerMillionUsd;
  return {
    costUsd: Number((inputCost + outputCost).toFixed(6)),
    isEstimated: !usageFromProvider
  };
}

import Ajv from 'ajv';
import { calculateTokenCost } from '@shared/pricing';
import type { SelfHostedRuntimeStatus } from '@shared/types';
import { GeminiApiError, GeminiProvider } from '@main/agent/providers/gemini-provider';
import { SelfHostedOpenAiProvider } from '@main/agent/providers/self-hosted-provider';
import type {
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelProvider
} from '@main/agent/providers/model-provider';
import type { BackendConfig } from '../../config';
import type { MetricsRegistry } from '../../observability/metrics';

export type ModelTaskTier = 'fast' | 'balanced' | 'deep';

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export class AiOrchestrator {
  private readonly ajv = new Ajv({ allErrors: true, strict: false });
  private readonly geminiProvider: GeminiProvider;
  private readonly selfHostedProvider: SelfHostedOpenAiProvider;

  constructor(
    private readonly config: BackendConfig,
    private readonly metrics: MetricsRegistry,
    private readonly overrideProvider?: ModelProvider
  ) {
    this.geminiProvider = new GeminiProvider(() => this.config.geminiApiKey || undefined, {
      timeoutMs: 25_000,
      maxRetries: 2
    });
    this.selfHostedProvider = new SelfHostedOpenAiProvider({
      getEndpointUrl: () => this.config.selfHostedUrl || '',
      getApiKey: () => this.config.selfHostedApiKey || undefined,
      timeoutMs: 45_000,
      maxRetries: 1
    });
  }

  public isConfigured(): boolean {
    if (this.overrideProvider) return true;
    if (this.config.aiProvider === 'self_hosted') {
      return Boolean(this.config.selfHostedUrl);
    }
    if (this.config.geminiApiKey) return true;
    return this.config.allowMockAi && this.config.nodeEnv !== 'production';
  }

  public selectModel(tier: ModelTaskTier): string {
    if (this.config.aiProvider === 'self_hosted' || (this.config.selfHostedUrl && !this.config.geminiApiKey)) {
      return this.config.selfHostedModel;
    }
    if (tier === 'deep') return 'gemini-2.5-pro';
    if (tier === 'fast') return 'gemini-2.0-flash';
    return this.config.defaultAiModel || 'gemini-2.5-flash';
  }

  public async getRuntimeStatus(): Promise<SelfHostedRuntimeStatus> {
    if (this.overrideProvider) {
      return {
        backendKind: 'custom_openai_compatible',
        endpointUrl: 'injected://provider',
        configuredModel: this.selectModel('balanced'),
        reachable: true,
        modelAvailable: true,
        availableModels: [this.selectModel('balanced')],
        latencyMs: 0,
        supportsStreaming: true,
        supportsTools: true,
        supportsStructuredOutput: true,
        statusMessage: `Test/override provider active (${this.overrideProvider.id})`
      };
    }

    if (this.config.aiProvider === 'self_hosted' || (this.config.selfHostedUrl && !this.config.geminiApiKey)) {
      return this.selfHostedProvider.getRuntimeStatus(this.config.selfHostedModel);
    }

    if (this.config.geminiApiKey) {
      return {
        backendKind: 'gemini',
        endpointUrl: 'https://generativelanguage.googleapis.com/v1beta',
        configuredModel: this.config.defaultAiModel,
        reachable: true,
        modelAvailable: true,
        availableModels: [this.config.defaultAiModel],
        latencyMs: 0,
        supportsStreaming: true,
        supportsTools: true,
        supportsStructuredOutput: true,
        statusMessage: 'Gemini API key configured'
      };
    }

    return {
      backendKind: 'unconfigured',
      endpointUrl: '',
      configuredModel: '',
      reachable: false,
      modelAvailable: false,
      availableModels: [],
      latencyMs: 0,
      supportsStreaming: false,
      supportsTools: false,
      supportsStructuredOutput: false,
      statusMessage: 'No AI model configured. Set ATLAS_SELF_HOSTED_URL (Ollama/vLLM/llama.cpp) or GEMINI_API_KEY.'
    };
  }

  public async health(): Promise<{ configured: boolean; provider: string; healthy: boolean; error?: string }> {
    if (this.overrideProvider) {
      return { configured: true, provider: this.overrideProvider.id, healthy: true };
    }
    if (this.config.aiProvider === 'self_hosted' || (this.config.selfHostedUrl && !this.config.geminiApiKey)) {
      const test = await this.selfHostedProvider.testConnection(this.config.selfHostedModel);
      return {
        configured: Boolean(this.config.selfHostedUrl),
        provider: 'self_hosted',
        healthy: test.ok,
        error: test.error
      };
    }
    if (!this.config.geminiApiKey) {
      return {
        configured: false,
        provider: 'unconfigured',
        healthy: false,
        error: 'Neither ATLAS_SELF_HOSTED_URL nor GEMINI_API_KEY is configured'
      };
    }
    const test = await this.geminiProvider.testConnection(this.config.defaultAiModel);
    return {
      configured: true,
      provider: 'gemini',
      healthy: test.ok,
      error: test.error
    };
  }

  public async generate(
    request: Omit<ModelGenerateRequest, 'model'> & { model?: string; tier?: ModelTaskTier }
  ): Promise<ModelGenerateResponse & { estimatedCostUsd: number; providerId: string; modelUsed: string }> {
    const model = request.model || this.selectModel(request.tier || 'balanced');
    const activeProvider = this.resolveProvider();

    try {
      const resp = await activeProvider.generate({
        ...request,
        model
      });

      if (request.responseSchema) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(resp.text);
        } catch {
          throw new GeminiApiError('Model returned non-JSON for structured output schema', 'malformed_response');
        }
        const validate = this.ajv.compile(request.responseSchema);
        if (!validate(parsed)) {
          const msgs = (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join('; ');
          throw new GeminiApiError(`Structured output failed schema validation: ${msgs}`, 'malformed_response');
        }
      }

      const cost =
        activeProvider.id === 'self_hosted'
          ? { costUsd: 0, isEstimated: false }
          : calculateTokenCost(
              model,
              resp.usage.inputTokens,
              resp.usage.outputTokens,
              resp.usage.fromProvider
            );

      this.metrics.recordAiUsage({
        inputTokens: resp.usage.inputTokens,
        outputTokens: resp.usage.outputTokens,
        estimatedCostUsd: cost.costUsd,
        failed: false
      });

      return {
        ...resp,
        estimatedCostUsd: cost.costUsd,
        providerId: activeProvider.id,
        modelUsed: model
      };
    } catch (err) {
      this.metrics.recordAiUsage({ inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, failed: true });
      throw err;
    }
  }

  private resolveProvider(): ModelProvider {
    if (this.overrideProvider) {
      return this.overrideProvider;
    }
    if (this.config.aiProvider === 'self_hosted' && this.config.selfHostedUrl) {
      return this.selfHostedProvider;
    }
    if (this.config.geminiApiKey) {
      return this.geminiProvider;
    }
    if (this.config.selfHostedUrl) {
      return this.selfHostedProvider;
    }
    // Never silently fall back to mock models in production
    if (this.config.nodeEnv !== 'production' && this.config.allowMockAi) {
      return {
        id: 'explicit_dev_mock',
        async generate(req: ModelGenerateRequest): Promise<ModelGenerateResponse> {
          const promptText = req.messages.map((m) => m.parts.map((p) => p.text || '').join(' ')).join(' ');
          return {
            text: JSON.stringify({
              summary: `Evidence-grounded summary synthesized in explicit dev mode for: ${promptText.slice(0, 120)}`,
              claims: [],
              contradictions: []
            }),
            functionCalls: [],
            usage: { inputTokens: 80, outputTokens: 40, fromProvider: false },
            finishReason: 'STOP'
          };
        }
      };
    }
    throw new AiUnavailableError(
      'AI provider unavailable: GEMINI_API_KEY is not configured (silent mock fallback is disabled).'
    );
  }
}

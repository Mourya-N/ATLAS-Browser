import { calculateTokenCost } from '@shared/pricing';
import type { BudgetConfig } from '@shared/types';
import type { AgentRepository } from '@main/db/repositories/agent-repo';

export interface RunBudgetState {
  runId: string;
  startedAt: number;
  steps: number;
  modelCalls: number;
  visionCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  isEstimated: boolean;
  consecutiveFailures: number;
  warned: boolean;
}

export class CostTracker {
  private runs = new Map<string, RunBudgetState>();

  constructor(private readonly repo: AgentRepository) {}

  public startRun(runId: string): RunBudgetState {
    const state: RunBudgetState = {
      runId,
      startedAt: Date.now(),
      steps: 0,
      modelCalls: 0,
      visionCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      isEstimated: false,
      consecutiveFailures: 0,
      warned: false
    };
    this.runs.set(runId, state);
    return state;
  }

  public getState(runId: string): RunBudgetState | undefined {
    return this.runs.get(runId);
  }

  public recordModelUsage(params: {
    runId: string;
    skillId?: string | null;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    fromProvider: boolean;
    usedVision?: boolean;
    skipPersistence?: boolean;
  }): RunBudgetState {
    const state = this.runs.get(params.runId) ?? this.startRun(params.runId);
    const { costUsd, isEstimated } = calculateTokenCost(
      params.model,
      params.inputTokens,
      params.outputTokens,
      params.fromProvider
    );

    state.modelCalls += 1;
    if (params.usedVision) state.visionCalls += 1;
    state.inputTokens += params.inputTokens;
    state.outputTokens += params.outputTokens;
    state.costUsd = Number((state.costUsd + costUsd).toFixed(6));
    state.isEstimated = state.isEstimated || isEstimated;

    if (!params.skipPersistence) {
      this.repo.recordCost({
        runId: params.runId,
        skillId: params.skillId ?? null,
        provider: params.provider,
        model: params.model,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        costUsd,
        isEstimated
      });
    }

    return state;
  }

  public checkBudget(
    runId: string,
    limits: BudgetConfig
  ): { exceeded: boolean; warning: boolean; reason?: string } {
    const state = this.runs.get(runId);
    if (!state) return { exceeded: false, warning: false };

    const elapsed = Date.now() - state.startedAt;
    const totalTokens = state.inputTokens + state.outputTokens;
    const dailyCost = this.repo.getTodayCostUsd();

    if (state.steps >= limits.maxStepsPerRun) {
      return { exceeded: true, warning: true, reason: `Maximum steps (${limits.maxStepsPerRun}) reached` };
    }
    if (elapsed >= limits.maxWallTimeMs) {
      return { exceeded: true, warning: true, reason: `Maximum wall-clock time (${limits.maxWallTimeMs}ms) reached` };
    }
    if (totalTokens >= limits.maxTokensPerRun) {
      return { exceeded: true, warning: true, reason: `Maximum tokens (${limits.maxTokensPerRun}) reached` };
    }
    if (state.modelCalls >= limits.maxModelCallsPerRun) {
      return { exceeded: true, warning: true, reason: `Maximum model calls (${limits.maxModelCallsPerRun}) reached` };
    }
    if (state.visionCalls > limits.maxVisionCallsPerRun) {
      return { exceeded: true, warning: true, reason: `Maximum vision calls (${limits.maxVisionCallsPerRun}) reached` };
    }
    if (state.costUsd >= limits.maxCostPerRunUsd) {
      return { exceeded: true, warning: true, reason: `Per-run cost budget ($${limits.maxCostPerRunUsd}) reached` };
    }
    if (dailyCost >= limits.dailyCostBudgetUsd) {
      return { exceeded: true, warning: true, reason: `Daily cost budget ($${limits.dailyCostBudgetUsd}) reached` };
    }
    if (state.consecutiveFailures >= limits.maxConsecutiveFailures) {
      return {
        exceeded: true,
        warning: true,
        reason: `Maximum consecutive failures (${limits.maxConsecutiveFailures}) reached`
      };
    }

    const ratio = Math.max(
      state.steps / limits.maxStepsPerRun,
      totalTokens / limits.maxTokensPerRun,
      state.costUsd / Math.max(0.0001, limits.maxCostPerRunUsd),
      dailyCost / Math.max(0.0001, limits.dailyCostBudgetUsd)
    );
    const warning = !state.warned && ratio >= limits.warningRatio;
    if (warning) state.warned = true;

    return { exceeded: false, warning };
  }

  public clearRun(runId: string): void {
    this.runs.delete(runId);
  }
}

import { randomUUID } from 'node:crypto';
import type { AgentMode, Skill, SkillExecution } from '@shared/types';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import type { ToolExecutionContext, ToolRegistry } from '@main/agent/tool-registry';
import type { AuditLogger } from '@main/security/audit-logger';

export function interpolateSkillArgs(
  template: Record<string, unknown>,
  params: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    if (typeof v === 'string') {
      out[k] = v.replace(/\{\{(\w+)\}\}/g, (_m, key) =>
        params[key] !== undefined ? String(params[key]) : ''
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

export class SkillRunner {
  constructor(
    private readonly repo: PlatformRepository,
    private readonly toolRegistry: ToolRegistry,
    private readonly auditLogger: AuditLogger
  ) {}

  public async runSkill(params: {
    skill: Skill;
    args: Record<string, unknown>;
    mode: AgentMode;
    createContext: (runId: string) => ToolExecutionContext;
    llmFallback?: (stepDescription: string, error: string) => Promise<boolean>;
  }): Promise<SkillExecution> {
    const execId = randomUUID();
    const execution: SkillExecution = {
      id: execId,
      skillId: params.skill.id,
      skillVersion: params.skill.version,
      runId: null,
      params: params.args,
      status: 'running',
      usedLlmFallback: false,
      startedAt: Date.now()
    };
    this.repo.recordSkillExecution(execution);

    // Validate required parameters
    for (const p of params.skill.parameters) {
      if (p.required && (params.args[p.name] === undefined || params.args[p.name] === '')) {
        if (p.defaultValue !== undefined) {
          params.args[p.name] = p.defaultValue;
        } else {
          execution.status = 'failed';
          execution.error = `Missing required skill parameter: ${p.name}`;
          execution.endedAt = Date.now();
          this.repo.recordSkillExecution(execution);
          return execution;
        }
      }
    }

    const runId = randomUUID();
    execution.runId = runId;
    const ctx = params.createContext(runId);
    ctx.allowedDomainsOverride = params.skill.allowedDomains;

    this.auditLogger.log({
      runId,
      category: 'skill',
      action: 'skill_execution_started',
      actor: 'skill_runner',
      details: { skillId: params.skill.id, name: params.skill.name, version: params.skill.version }
    });

    try {
      for (const step of params.skill.steps) {
        const concreteArgs = interpolateSkillArgs(step.argsTemplate, params.args);
        let result = await this.toolRegistry.invoke(step.toolName, concreteArgs, ctx);

        // Dynamic target fallback (e.g., if CSS selector changed, retry using text hint)
        if (!result.outcome.success && step.recoveryStrategy === 'ax_fallback' && step.targetHints?.text) {
          const fallbackArgs = { ...concreteArgs };
          delete fallbackArgs.selector;
          delete fallbackArgs.lavrayId;
          fallbackArgs.text = step.targetHints.text;
          result = await this.toolRegistry.invoke(step.toolName, fallbackArgs, ctx);
        }

        if (!result.outcome.success) {
          if (result.permissionDecision === 'denied' || result.permissionDecision === 'rejected') {
            throw new Error(result.outcome.error || 'Permission denied during skill replay');
          }
          if (step.recoveryStrategy === 'llm_fallback' && params.llmFallback) {
            execution.usedLlmFallback = true;
            const recovered = await params.llmFallback(
              step.description,
              result.outcome.error || 'Step failed'
            );
            if (!recovered) {
              throw new Error(result.outcome.error || `Skill step ${step.index} failed`);
            }
          } else {
            throw new Error(result.outcome.error || `Skill step ${step.index} failed`);
          }
        }

        // Verify post-step condition
        if (step.verificationRule.type === 'url_contains' && step.verificationRule.value) {
          const currentUrl = ctx.lastPerception?.url || '';
          if (!currentUrl.includes(step.verificationRule.value)) {
            // Allow base domain match on dynamic query params
            try {
              const expectedHost = new URL(step.verificationRule.value).hostname;
              if (!currentUrl.includes(expectedHost)) {
                throw new Error(
                  `Skill verification failed: expected URL containing "${expectedHost}", got "${currentUrl}"`
                );
              }
            } catch {
              throw new Error(
                `Skill verification failed: expected URL containing "${step.verificationRule.value}"`
              );
            }
          }
        }
      }

      execution.status = 'completed';
      execution.endedAt = Date.now();
      this.repo.recordSkillExecution(execution);
      this.repo.saveSkill({
        ...params.skill,
        lastExecutedAt: Date.now(),
        executionCount: params.skill.executionCount + 1,
        successCount: params.skill.successCount + 1
      });
      return execution;
    } catch (err) {
      execution.status = 'failed';
      execution.error = err instanceof Error ? err.message : String(err);
      execution.endedAt = Date.now();
      this.repo.recordSkillExecution(execution);
      this.repo.saveSkill({
        ...params.skill,
        lastExecutedAt: Date.now(),
        executionCount: params.skill.executionCount + 1
      });
      return execution;
    }
  }
}

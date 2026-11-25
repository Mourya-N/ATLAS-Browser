import { randomUUID } from 'node:crypto';
import type { AgentRun, PermissionTier, Skill, SkillStep } from '@shared/types';
import { extractDomain } from '@main/security/permission-gate';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';

export class SkillRecorder {
  constructor(private readonly repo: PlatformRepository) {}

  public recordFromRun(
    run: AgentRun,
    options: { name?: string; description?: string } = {}
  ): Skill {
    const now = Date.now();
    const steps: SkillStep[] = [];
    const perms = new Set<PermissionTier>();
    const domains = new Set<string>();

    for (const step of run.steps) {
      const exec = step.toolExecution;
      if (!exec || !exec.success) continue;

      perms.add(exec.permissionTier);
      const stepUrl = exec.pageDiff?.currentUrl || (exec.args.url as string | undefined) || '';
      const domain = extractDomain(stepUrl);
      if (domain && domain !== 'internal' && domain !== 'unknown') {
        domains.add(domain);
      }

      const verificationRule: SkillStep['verificationRule'] =
        exec.toolName === 'navigate' && stepUrl
          ? { type: 'url_contains', value: stepUrl }
          : {
              type: 'text_contains',
              value: ''
            };

      steps.push({
        index: steps.length,
        description: step.summary,
        toolName: exec.toolName,
        argsTemplate: { ...exec.args },
        targetHints: {
          selector: typeof exec.args.selector === 'string' ? exec.args.selector : undefined,
          text: typeof exec.args.text === 'string' ? exec.args.text : undefined
        },
        expectedOutcome: step.evidence || `${exec.toolName} succeeded`,
        verificationRule,
        recoveryStrategy: exec.toolName === 'click' || exec.toolName === 'type' ? 'ax_fallback' : 'llm_fallback',
        permissionTier: exec.permissionTier
      });
    }

    const skill: Skill = {
      id: randomUUID(),
      name: options.name?.trim() || `Skill: ${run.goal.slice(0, 48)}`,
      description: options.description?.trim() || run.planSummary || run.goal,
      version: 1,
      parameters: [],
      preconditions: [],
      requiredPermissions: Array.from(perms),
      allowedDomains: Array.from(domains),
      steps,
      createdAt: now,
      updatedAt: now,
      lastExecutedAt: null,
      executionCount: 0,
      successCount: 0
    };

    return this.repo.saveSkill(skill);
  }

  public exportSkillJson(skillId: string): string {
    const skill = this.repo.getSkill(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    return JSON.stringify(
      {
        schemaVersion: 'atlas-skill-v1',
        exportedAt: new Date().toISOString(),
        skill
      },
      null,
      2
    );
  }

  public importSkillJson(rawJson: string): Skill {
    const parsed = JSON.parse(rawJson) as { schemaVersion?: string; skill?: Skill } | Skill;
    const candidate = 'skill' in parsed && parsed.skill ? parsed.skill : (parsed as Skill);
    if (!candidate.name || !Array.isArray(candidate.steps)) {
      throw new Error('Invalid Atlas skill JSON payload');
    }
    const now = Date.now();
    const imported: Skill = {
      ...candidate,
      id: randomUUID(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      executionCount: 0,
      successCount: 0,
      lastExecutedAt: null
    };
    return this.repo.saveSkill(imported);
  }
}

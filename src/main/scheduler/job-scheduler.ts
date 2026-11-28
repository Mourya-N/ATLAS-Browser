import { Notification } from 'electron';
import cronParser from 'cron-parser';
import { randomUUID } from 'node:crypto';
import type { ScheduledJob, ScheduleTriggerType } from '@shared/types';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import type { AuditLogger } from '@main/security/audit-logger';
import type { SkillRunner } from '@main/skills/skill-runner';
import type { ToolExecutionContext } from '@main/agent/tool-registry';

export function computeNextRunAt(
  triggerType: ScheduleTriggerType,
  cronExpression?: string | null,
  runAt?: number | null,
  timezone = 'UTC',
  fromMs = Date.now()
): number | null {
  if (triggerType === 'once') {
    return runAt && runAt > fromMs ? runAt : null;
  }
  if (triggerType === 'event') {
    return null;
  }
  let expr = cronExpression?.trim() || '';
  if (!expr) {
    if (triggerType === 'daily') expr = '0 9 * * *';
    else if (triggerType === 'weekly') expr = '0 9 * * 1';
    else return null;
  }
  try {
    const interval = cronParser.parseExpression(expr, {
      currentDate: new Date(fromMs),
      tz: timezone || 'UTC'
    });
    return interval.next().getTime();
  } catch {
    return null;
  }
}

export class JobScheduler {
  private timer: NodeJS.Timeout | null = null;
  private runningJobs = new Set<string>();

  constructor(
    private readonly repo: PlatformRepository,
    private readonly skillRunner: SkillRunner,
    private readonly auditLogger: AuditLogger,
    private readonly createContext: (runId: string) => ToolExecutionContext | null
  ) {}

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 15_000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public listJobs(): ScheduledJob[] {
    return this.repo.listScheduledJobs();
  }

  public saveJob(input: {
    id?: string;
    name: string;
    skillId: string;
    params?: Record<string, unknown>;
    triggerType: ScheduleTriggerType;
    cronExpression?: string | null;
    runAt?: number | null;
    timezone?: string;
    enabled?: boolean;
    paused?: boolean;
    maxBudgetUsd?: number;
    allowedDomains?: string[];
  }): ScheduledJob {
    const tz = input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const nextRunAt = computeNextRunAt(input.triggerType, input.cronExpression, input.runAt, tz);

    const job: ScheduledJob = {
      id: input.id ?? randomUUID(),
      name: input.name.trim(),
      skillId: input.skillId,
      params: input.params ?? {},
      triggerType: input.triggerType,
      cronExpression: input.cronExpression ?? null,
      runAt: input.runAt ?? null,
      timezone: tz,
      enabled: input.enabled ?? true,
      paused: input.paused ?? false,
      maxBudgetUsd: input.maxBudgetUsd ?? 0.5,
      allowedDomains: input.allowedDomains ?? [],
      lastRunAt: null,
      nextRunAt,
      lastStatus: null,
      lastError: null,
      createdAt: Date.now()
    };

    return this.repo.saveScheduledJob(job);
  }

  public deleteJob(id: string): void {
    this.repo.deleteScheduledJob(id);
  }

  public toggleJob(id: string, patch: { enabled?: boolean; paused?: boolean }): ScheduledJob | null {
    const existing = this.repo.listScheduledJobs().find((j) => j.id === id);
    if (!existing) return null;
    const updated: ScheduledJob = {
      ...existing,
      enabled: patch.enabled ?? existing.enabled,
      paused: patch.paused ?? existing.paused
    };
    if (updated.enabled && !updated.nextRunAt) {
      updated.nextRunAt = computeNextRunAt(
        updated.triggerType,
        updated.cronExpression,
        updated.runAt,
        updated.timezone
      );
    }
    return this.repo.saveScheduledJob(updated);
  }

  public async tick(now = Date.now()): Promise<void> {
    const jobs = this.repo.listScheduledJobs();
    for (const job of jobs) {
      if (!job.enabled || job.paused || !job.nextRunAt || job.nextRunAt > now) continue;
      if (this.runningJobs.has(job.id)) continue;
      await this.executeJob(job);
    }
  }

  public async triggerEventJobs(eventName: string): Promise<void> {
    const jobs = this.repo
      .listScheduledJobs()
      .filter((j) => j.enabled && !j.paused && j.triggerType === 'event' && j.cronExpression === eventName);
    for (const job of jobs) {
      await this.executeJob(job);
    }
  }

  public async executeJob(job: ScheduledJob): Promise<ScheduledJob> {
    if (this.runningJobs.has(job.id)) return job;
    this.runningJobs.add(job.id);

    try {
      const skill = this.repo.getSkill(job.skillId);
      if (!skill) {
        const failed: ScheduledJob = {
          ...job,
          lastRunAt: Date.now(),
          lastStatus: 'failed',
          lastError: `Referenced skill "${job.skillId}" not found`
        };
        return this.repo.saveScheduledJob(failed);
      }

      // Scheduled background runs cannot silently perform sensitive actions
      if (skill.requiredPermissions.includes('sensitive')) {
        const pausedJob: ScheduledJob = {
          ...job,
          paused: true,
          lastRunAt: Date.now(),
          lastStatus: 'paused_permission',
          lastError: 'Skill requires sensitive permissions; manual confirmation required before running.'
        };
        this.auditLogger.log({
          category: 'scheduler',
          action: 'scheduled_job_paused_permission',
          actor: 'job_scheduler',
          details: { jobId: job.id, skillId: skill.id }
        });
        this.notify('LAVRAY Scheduler: Confirmation Needed', `Job "${job.name}" paused — sensitive action requires approval.`);
        return this.repo.saveScheduledJob(pausedJob);
      }

      const exec = await this.skillRunner.runSkill({
        skill: {
          ...skill,
          allowedDomains:
            job.allowedDomains.length > 0 ? job.allowedDomains : skill.allowedDomains
        },
        args: { ...job.params },
        mode: 'agent',
        createContext: (runId) => {
          const ctx = this.createContext(runId);
          if (!ctx) throw new Error('No active browser tab/session available for scheduled run');
          return ctx;
        }
      });

      const nextRunAt =
        job.triggerType === 'once'
          ? null
          : computeNextRunAt(job.triggerType, job.cronExpression, job.runAt, job.timezone, Date.now() + 1000);

      const updated: ScheduledJob = {
        ...job,
        enabled: job.triggerType === 'once' ? false : job.enabled,
        lastRunAt: Date.now(),
        nextRunAt,
        lastStatus: exec.status === 'completed' ? 'completed' : 'failed',
        lastError: exec.error ?? null
      };

      this.auditLogger.log({
        category: 'scheduler',
        action: exec.status === 'completed' ? 'scheduled_job_completed' : 'scheduled_job_failed',
        actor: 'job_scheduler',
        details: { jobId: job.id, skillId: skill.id, status: exec.status, error: exec.error }
      });

      this.notify(
        `LAVRAY Scheduler: ${job.name}`,
        exec.status === 'completed' ? 'Scheduled workflow completed successfully.' : `Failed: ${exec.error}`
      );

      return this.repo.saveScheduledJob(updated);
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  private notify(title: string, body: string): void {
    try {
      if (Notification?.isSupported?.()) {
        new Notification({ title, body }).show();
      }
    } catch {
      // Ignore in headless test mode
    }
  }
}

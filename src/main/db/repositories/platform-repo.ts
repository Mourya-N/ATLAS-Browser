import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  AuditEvent,
  DomainPermissionMode,
  DomainRule,
  MemoryCategory,
  MemoryItem,
  ScheduledJob,
  Skill,
  SkillExecution
} from '@shared/types';

export class PlatformRepository {
  constructor(private readonly db: Database.Database) {}

  // --- Settings ---
  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as
      | { value_json: string }
      | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return fallback;
    }
  }

  setSetting<T>(key: string, value: T): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), Date.now());
  }

  // --- Domain Rules ---
  listDomainRules(): DomainRule[] {
    const now = Date.now();
    // Automatically prune expired rules
    this.db.prepare('DELETE FROM domain_rules WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now);
    const rows = this.db.prepare('SELECT * FROM domain_rules ORDER BY domain ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      id: String(r.id),
      domain: String(r.domain),
      mode: r.mode as DomainPermissionMode,
      expiresAt: (r.expires_at as number | null) ?? null,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    }));
  }

  setDomainRule(domain: string, mode: DomainPermissionMode, expiresAt?: number | null): DomainRule {
    const normalized = domain.toLowerCase().trim();
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT id, created_at FROM domain_rules WHERE domain = ?')
      .get(normalized) as { id: string; created_at: number } | undefined;

    const id = existing?.id ?? randomUUID();
    const createdAt = existing?.created_at ?? now;
    this.db
      .prepare(
        `INSERT INTO domain_rules (id, domain, mode, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(domain) DO UPDATE SET mode = excluded.mode, expires_at = excluded.expires_at, updated_at = excluded.updated_at`
      )
      .run(id, normalized, mode, expiresAt ?? null, createdAt, now);

    return {
      id,
      domain: normalized,
      mode,
      expiresAt: expiresAt ?? null,
      createdAt,
      updatedAt: now
    };
  }

  deleteDomainRule(domainOrId: string): void {
    this.db.prepare('DELETE FROM domain_rules WHERE id = ? OR domain = ?').run(domainOrId, domainOrId);
  }

  // --- Audit ---
  insertAuditEvent(event: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO audit_events (id, run_id, category, action, actor, domain, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        event.runId ?? null,
        event.category,
        event.action,
        event.actor,
        event.domain ?? null,
        JSON.stringify(event.details),
        now
      );
    return { ...event, id, createdAt: now };
  }

  listAuditEvents(query = '', category?: string, limit = 200): AuditEvent[] {
    const pattern = `%${query.trim()}%`;
    let sql = 'SELECT * FROM audit_events WHERE (action LIKE ? OR details_json LIKE ? OR COALESCE(domain, \'\') LIKE ?)';
    const params: unknown[] = [pattern, pattern, pattern];
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      runId: (r.run_id as string | null) ?? null,
      category: r.category as AuditEvent['category'],
      action: String(r.action),
      actor: String(r.actor),
      domain: (r.domain as string | null) ?? null,
      details: JSON.parse(String(r.details_json || '{}')),
      createdAt: Number(r.created_at)
    }));
  }

  deleteAuditEvents(id?: string): void {
    if (id) {
      this.db.prepare('DELETE FROM audit_events WHERE id = ?').run(id);
    } else {
      this.db.prepare('DELETE FROM audit_events').run();
    }
  }

  // --- Skills ---
  listSkills(): Skill[] {
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY updated_at DESC').all() as Record<
      string,
      unknown
    >[];
    return rows.map(this.mapSkillRow);
  }

  getSkill(id: string): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapSkillRow(row) : null;
  }

  saveSkill(skill: Skill): Skill {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO skills (id, name, description, version, parameters_json, preconditions_json, required_permissions_json, allowed_domains_json, steps_json, created_at, updated_at, last_executed_at, execution_count, success_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             version = excluded.version,
             parameters_json = excluded.parameters_json,
             preconditions_json = excluded.preconditions_json,
             required_permissions_json = excluded.required_permissions_json,
             allowed_domains_json = excluded.allowed_domains_json,
             steps_json = excluded.steps_json,
             updated_at = excluded.updated_at,
             last_executed_at = excluded.last_executed_at,
             execution_count = excluded.execution_count,
             success_count = excluded.success_count`
        )
        .run(
          skill.id,
          skill.name,
          skill.description,
          skill.version,
          JSON.stringify(skill.parameters),
          JSON.stringify(skill.preconditions),
          JSON.stringify(skill.requiredPermissions),
          JSON.stringify(skill.allowedDomains),
          JSON.stringify(skill.steps),
          skill.createdAt,
          skill.updatedAt,
          skill.lastExecutedAt ?? null,
          skill.executionCount,
          skill.successCount
        );

      this.db
        .prepare(
          `INSERT OR IGNORE INTO skill_versions (id, skill_id, version, snapshot_json, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), skill.id, skill.version, JSON.stringify(skill), Date.now());
    });
    tx();
    return skill;
  }

  deleteSkill(id: string): void {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  }

  recordSkillExecution(exec: SkillExecution): void {
    this.db
      .prepare(
        `INSERT INTO skill_executions (id, skill_id, skill_version, run_id, params_json, status, used_llm_fallback, error, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           used_llm_fallback = excluded.used_llm_fallback,
           error = excluded.error,
           ended_at = excluded.ended_at`
      )
      .run(
        exec.id,
        exec.skillId,
        exec.skillVersion,
        exec.runId ?? null,
        JSON.stringify(exec.params),
        exec.status,
        exec.usedLlmFallback ? 1 : 0,
        exec.error ?? null,
        exec.startedAt,
        exec.endedAt ?? null
      );
  }

  listSkillExecutions(skillId: string): SkillExecution[] {
    const rows = this.db
      .prepare('SELECT * FROM skill_executions WHERE skill_id = ? ORDER BY started_at DESC LIMIT 50')
      .all(skillId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      skillId: String(r.skill_id),
      skillVersion: Number(r.skill_version),
      runId: (r.run_id as string | null) ?? null,
      params: JSON.parse(String(r.params_json || '{}')),
      status: r.status as SkillExecution['status'],
      usedLlmFallback: Boolean(r.used_llm_fallback),
      error: (r.error as string | null) ?? null,
      startedAt: Number(r.started_at),
      endedAt: (r.ended_at as number | null) ?? null
    }));
  }

  private mapSkillRow(r: Record<string, unknown>): Skill {
    return {
      id: String(r.id),
      name: String(r.name),
      description: String(r.description),
      version: Number(r.version),
      parameters: JSON.parse(String(r.parameters_json || '[]')),
      preconditions: JSON.parse(String(r.preconditions_json || '[]')),
      requiredPermissions: JSON.parse(String(r.required_permissions_json || '[]')),
      allowedDomains: JSON.parse(String(r.allowed_domains_json || '[]')),
      steps: JSON.parse(String(r.steps_json || '[]')),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      lastExecutedAt: (r.last_executed_at as number | null) ?? null,
      executionCount: Number(r.execution_count),
      successCount: Number(r.success_count)
    };
  }

  // --- Memory ---
  listMemory(category?: MemoryCategory, profileId = 'default'): MemoryItem[] {
    const now = Date.now();
    this.db.prepare('DELETE FROM memory WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now);
    const rows = category
      ? (this.db
          .prepare('SELECT * FROM memory WHERE category = ? AND profile_id = ? ORDER BY last_used_at DESC')
          .all(category, profileId) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM memory WHERE profile_id = ? ORDER BY last_used_at DESC')
          .all(profileId) as Record<string, unknown>[]);
    return rows.map(this.mapMemoryRow);
  }

  saveMemory(item: MemoryItem): MemoryItem {
    this.db
      .prepare(
        `INSERT INTO memory (id, profile_id, category, domain, source_url, title, content, confidence, source, user_approved, use_count, expires_at, embedding_json, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           profile_id = excluded.profile_id,
           category = excluded.category,
           domain = excluded.domain,
           source_url = excluded.source_url,
           title = excluded.title,
           content = excluded.content,
           confidence = excluded.confidence,
           user_approved = excluded.user_approved,
           use_count = excluded.use_count,
           expires_at = excluded.expires_at,
           embedding_json = excluded.embedding_json,
           last_used_at = excluded.last_used_at`
      )
      .run(
        item.id,
        item.profileId ?? 'default',
        item.category,
        item.domain ?? null,
        item.sourceUrl ?? null,
        item.title,
        item.content,
        item.confidence,
        item.source,
        item.userApproved ? 1 : 0,
        item.useCount,
        item.expiresAt ?? null,
        item.embedding ? JSON.stringify(item.embedding) : null,
        item.createdAt,
        item.lastUsedAt
      );
    return item;
  }

  deleteMemory(id: string): void {
    this.db.prepare('DELETE FROM memory WHERE id = ?').run(id);
  }

  clearMemory(profileId?: string): void {
    if (profileId) {
      this.db.prepare('DELETE FROM memory WHERE profile_id = ?').run(profileId);
    } else {
      this.db.prepare('DELETE FROM memory').run();
    }
  }

  // --- Page Snapshots (Change Detection) ---
  savePageSnapshot(snap: {
    url: string;
    title: string;
    headings: string[];
    textFingerprint: string;
    textExcerpt: string;
    textLength: number;
    capturedAt: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO page_snapshots (url, title, headings_json, text_fingerprint, text_excerpt, text_length, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET
           title = excluded.title,
           headings_json = excluded.headings_json,
           text_fingerprint = excluded.text_fingerprint,
           text_excerpt = excluded.text_excerpt,
           text_length = excluded.text_length,
           captured_at = excluded.captured_at`
      )
      .run(
        snap.url,
        snap.title,
        JSON.stringify(snap.headings),
        snap.textFingerprint,
        snap.textExcerpt,
        snap.textLength,
        snap.capturedAt
      );
  }

  getPageSnapshot(url: string): {
    url: string;
    title: string;
    headings: string[];
    textFingerprint: string;
    textExcerpt: string;
    textLength: number;
    capturedAt: number;
  } | null {
    const row = this.db.prepare('SELECT * FROM page_snapshots WHERE url = ?').get(url) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      url: String(row.url),
      title: String(row.title),
      headings: JSON.parse(String(row.headings_json || '[]')),
      textFingerprint: String(row.text_fingerprint),
      textExcerpt: String(row.text_excerpt),
      textLength: Number(row.text_length),
      capturedAt: Number(row.captured_at)
    };
  }

  private mapMemoryRow(r: Record<string, unknown>): MemoryItem {
    return {
      id: String(r.id),
      profileId: String(r.profile_id || 'default'),
      category: r.category as MemoryCategory,
      domain: (r.domain as string | null) ?? null,
      sourceUrl: (r.source_url as string | null) ?? null,
      title: String(r.title),
      content: String(r.content),
      confidence: Number(r.confidence),
      source: String(r.source),
      userApproved: Boolean(r.user_approved),
      useCount: Number(r.use_count),
      expiresAt: (r.expires_at as number | null) ?? null,
      embedding: r.embedding_json ? (JSON.parse(String(r.embedding_json)) as number[]) : undefined,
      createdAt: Number(r.created_at),
      lastUsedAt: Number(r.last_used_at)
    };
  }

  // --- Scheduled Jobs ---
  listScheduledJobs(): ScheduledJob[] {
    const rows = this.db.prepare('SELECT * FROM scheduled_jobs ORDER BY created_at DESC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      skillId: String(r.skill_id),
      params: JSON.parse(String(r.params_json || '{}')),
      triggerType: r.trigger_type as ScheduledJob['triggerType'],
      cronExpression: (r.cron_expression as string | null) ?? null,
      runAt: (r.run_at as number | null) ?? null,
      timezone: String(r.timezone),
      enabled: Boolean(r.enabled),
      paused: Boolean(r.paused),
      maxBudgetUsd: Number(r.max_budget_usd),
      allowedDomains: JSON.parse(String(r.allowed_domains_json || '[]')),
      lastRunAt: (r.last_run_at as number | null) ?? null,
      nextRunAt: (r.next_run_at as number | null) ?? null,
      lastStatus: (r.last_status as ScheduledJob['lastStatus']) ?? null,
      lastError: (r.last_error as string | null) ?? null,
      createdAt: Number(r.created_at)
    }));
  }

  saveScheduledJob(job: ScheduledJob): ScheduledJob {
    this.db
      .prepare(
        `INSERT INTO scheduled_jobs (id, name, skill_id, params_json, trigger_type, cron_expression, run_at, timezone, enabled, paused, max_budget_usd, allowed_domains_json, last_run_at, next_run_at, last_status, last_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           skill_id = excluded.skill_id,
           params_json = excluded.params_json,
           trigger_type = excluded.trigger_type,
           cron_expression = excluded.cron_expression,
           run_at = excluded.run_at,
           timezone = excluded.timezone,
           enabled = excluded.enabled,
           paused = excluded.paused,
           max_budget_usd = excluded.max_budget_usd,
           allowed_domains_json = excluded.allowed_domains_json,
           last_run_at = excluded.last_run_at,
           next_run_at = excluded.next_run_at,
           last_status = excluded.last_status,
           last_error = excluded.last_error`
      )
      .run(
        job.id,
        job.name,
        job.skillId,
        JSON.stringify(job.params),
        job.triggerType,
        job.cronExpression ?? null,
        job.runAt ?? null,
        job.timezone,
        job.enabled ? 1 : 0,
        job.paused ? 1 : 0,
        job.maxBudgetUsd,
        JSON.stringify(job.allowedDomains),
        job.lastRunAt ?? null,
        job.nextRunAt ?? null,
        job.lastStatus ?? null,
        job.lastError ?? null,
        job.createdAt
      );
    return job;
  }

  deleteScheduledJob(id: string): void {
    this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id);
  }
}

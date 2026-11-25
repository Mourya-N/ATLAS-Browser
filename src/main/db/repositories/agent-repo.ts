import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  AgentConversation,
  AgentMessage,
  AgentRun,
  AgentStep,
  CostSummary,
  ResearchReport,
  TaskCheckpoint,
  ToolExecutionRecord
} from '@shared/types';

export class AgentRepository {
  constructor(private readonly db: Database.Database) {}

  createConversation(title = 'New Conversation'): AgentConversation {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare('INSERT INTO agent_conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, title, now, now);
    return { id, title, isPrivate: false, createdAt: now, updatedAt: now };
  }

  listConversations(limit = 50): AgentConversation[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_conversations ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      isPrivate: false,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    }));
  }

  updateConversationTitle(id: string, title: string): void {
    this.db
      .prepare('UPDATE agent_conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), id);
  }

  addMessage(msg: Omit<AgentMessage, 'id' | 'createdAt'>): AgentMessage {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO agent_messages (id, conversation_id, role, content, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, msg.conversationId, msg.role, msg.content, msg.runId ?? null, now);
    this.db
      .prepare('UPDATE agent_conversations SET updated_at = ? WHERE id = ?')
      .run(now, msg.conversationId);
    return { ...msg, id, createdAt: now };
  }

  getMessages(conversationId: string): AgentMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      conversationId: String(r.conversation_id),
      role: r.role as AgentMessage['role'],
      content: String(r.content),
      runId: (r.run_id as string | null) ?? null,
      createdAt: Number(r.created_at)
    }));
  }

  clearConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM agent_messages WHERE conversation_id = ?').run(conversationId);
  }

  saveRun(run: AgentRun): void {
    this.db
      .prepare(
        `INSERT INTO agent_runs (id, conversation_id, parent_run_id, tab_id, goal, mode, status, plan_summary, subgoals_json, final_answer, failure_reason, total_input_tokens, total_output_tokens, estimated_cost_usd, is_cost_estimated, model, provider, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           plan_summary = excluded.plan_summary,
           subgoals_json = excluded.subgoals_json,
           final_answer = excluded.final_answer,
           failure_reason = excluded.failure_reason,
           total_input_tokens = excluded.total_input_tokens,
           total_output_tokens = excluded.total_output_tokens,
           estimated_cost_usd = excluded.estimated_cost_usd,
           is_cost_estimated = excluded.is_cost_estimated,
           ended_at = excluded.ended_at`
      )
      .run(
        run.id,
        run.conversationId,
        run.parentRunId ?? null,
        run.tabId ?? null,
        run.goal,
        run.mode,
        run.status,
        run.planSummary ?? null,
        JSON.stringify(run.subgoals),
        run.finalAnswer ?? null,
        run.failureReason ?? null,
        run.totalInputTokens,
        run.totalOutputTokens,
        run.estimatedCostUsd,
        run.isCostEstimated ? 1 : 0,
        run.model,
        run.provider,
        run.startedAt,
        run.endedAt ?? null
      );
  }

  saveScreenshot(runId: string, stepId: string, filePath: string, url: string, width: number, height: number): string {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO screenshots (id, run_id, step_id, file_path, url, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, runId, stepId, filePath, url, width, height, Date.now());
    return id;
  }

  saveStep(step: AgentStep): void {
    this.db
      .prepare(
        `INSERT INTO agent_steps (id, run_id, step_index, subgoal_id, phase, summary, decision_explanation, evidence, verification_outcome, screenshot_id, injection_warnings_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           summary = excluded.summary,
           decision_explanation = excluded.decision_explanation,
           evidence = excluded.evidence,
           verification_outcome = excluded.verification_outcome,
           screenshot_id = excluded.screenshot_id`
      )
      .run(
        step.id,
        step.runId,
        step.stepIndex,
        step.subgoalId ?? null,
        step.phase,
        step.summary,
        step.decisionExplanation,
        step.evidence ?? null,
        step.verificationOutcome ?? null,
        step.screenshotId ?? null,
        JSON.stringify(step.injectionWarnings),
        step.createdAt
      );

    if (step.toolExecution) {
      this.saveToolExecution(step.toolExecution);
    }
  }

  saveToolExecution(exec: ToolExecutionRecord): void {
    this.db
      .prepare(
        `INSERT INTO tool_executions (id, run_id, step_id, tool_name, permission_tier, args_json, validated, permission_decision, success, result_json, error, duration_ms, page_diff_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           permission_decision = excluded.permission_decision,
           success = excluded.success,
           result_json = excluded.result_json,
           error = excluded.error,
           duration_ms = excluded.duration_ms,
           page_diff_json = excluded.page_diff_json`
      )
      .run(
        exec.id,
        exec.runId,
        exec.stepId,
        exec.toolName,
        exec.permissionTier,
        JSON.stringify(exec.args),
        exec.validated ? 1 : 0,
        exec.permissionDecision,
        exec.success ? 1 : 0,
        exec.result !== undefined ? JSON.stringify(exec.result) : null,
        exec.error ?? null,
        exec.durationMs,
        exec.pageDiff ? JSON.stringify(exec.pageDiff) : null,
        exec.createdAt
      );
  }

  listRuns(limit = 50): AgentRun[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRunRow(r, []));
  }

  getRun(runId: string): AgentRun | null {
    const r = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;

    const stepRows = this.db
      .prepare(
        `SELECT s.*, sc.file_path AS screenshot_path
         FROM agent_steps s
         LEFT JOIN screenshots sc ON s.screenshot_id = sc.id
         WHERE s.run_id = ?
         ORDER BY s.step_index ASC, s.created_at ASC`
      )
      .all(runId) as Record<string, unknown>[];

    const execRows = this.db
      .prepare('SELECT * FROM tool_executions WHERE run_id = ?')
      .all(runId) as Record<string, unknown>[];
    const execByStep = new Map<string, ToolExecutionRecord>();
    for (const e of execRows) {
      execByStep.set(String(e.step_id), {
        id: String(e.id),
        runId: String(e.run_id),
        stepId: String(e.step_id),
        toolName: String(e.tool_name),
        permissionTier: e.permission_tier as ToolExecutionRecord['permissionTier'],
        args: JSON.parse(String(e.args_json)),
        validated: Boolean(e.validated),
        permissionDecision: e.permission_decision as ToolExecutionRecord['permissionDecision'],
        success: Boolean(e.success),
        result: e.result_json ? JSON.parse(String(e.result_json)) : undefined,
        error: (e.error as string | null) ?? null,
        durationMs: Number(e.duration_ms),
        pageDiff: e.page_diff_json ? JSON.parse(String(e.page_diff_json)) : null,
        createdAt: Number(e.created_at)
      });
    }

    const steps: AgentStep[] = stepRows.map((s) => ({
      id: String(s.id),
      runId: String(s.run_id),
      stepIndex: Number(s.step_index),
      subgoalId: (s.subgoal_id as string | null) ?? null,
      phase: s.phase as AgentStep['phase'],
      summary: String(s.summary),
      decisionExplanation: String(s.decision_explanation),
      evidence: (s.evidence as string | null) ?? null,
      verificationOutcome: (s.verification_outcome as AgentStep['verificationOutcome']) ?? null,
      screenshotId: (s.screenshot_id as string | null) ?? null,
      screenshotPath: (s.screenshot_path as string | null) ?? null,
      injectionWarnings: JSON.parse(String(s.injection_warnings_json || '[]')),
      toolExecution: execByStep.get(String(s.id)) ?? null,
      createdAt: Number(s.created_at)
    }));

    return this.mapRunRow(r, steps);
  }

  recordCost(entry: {
    runId?: string | null;
    skillId?: string | null;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    isEstimated: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO cost_records (id, run_id, skill_id, provider, model, input_tokens, output_tokens, cost_usd, is_estimated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        entry.runId ?? null,
        entry.skillId ?? null,
        entry.provider,
        entry.model,
        entry.inputTokens,
        entry.outputTokens,
        entry.costUsd,
        entry.isEstimated ? 1 : 0,
        Date.now()
      );
  }

  getTodayCostUsd(): number {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const row = this.db
      .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_records WHERE created_at >= ?')
      .get(startOfDay.getTime()) as { total: number };
    return Number(row.total ?? 0);
  }

  getCostSummary(): CostSummary {
    const runAgg = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_runs,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successful_runs,
           SUM(CASE WHEN status IN ('failed', 'budget_exceeded') THEN 1 ELSE 0 END) AS failed_runs,
           AVG(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at ELSE NULL END) AS avg_duration_ms
         FROM agent_runs`
      )
      .get() as Record<string, unknown>;

    const stepAgg = this.db
      .prepare(
        'SELECT COALESCE(AVG(cnt), 0) AS avg_steps FROM (SELECT COUNT(*) AS cnt FROM agent_steps GROUP BY run_id)'
      )
      .get() as { avg_steps: number };

    const costAgg = this.db
      .prepare(
        'SELECT COALESCE(SUM(input_tokens), 0) AS in_tok, COALESCE(SUM(output_tokens), 0) AS out_tok, COALESCE(SUM(cost_usd), 0) AS total_cost FROM cost_records'
      )
      .get() as Record<string, unknown>;

    const byModelRows = this.db
      .prepare(
        'SELECT model, SUM(input_tokens) AS in_tok, SUM(output_tokens) AS out_tok, SUM(cost_usd) AS cost_usd FROM cost_records GROUP BY model'
      )
      .all() as Record<string, unknown>[];

    const bySkillRows = this.db
      .prepare(
        `SELECT c.skill_id, COALESCE(s.name, c.skill_id) AS skill_name, COUNT(*) AS runs, SUM(c.cost_usd) AS cost_usd
         FROM cost_records c
         LEFT JOIN skills s ON c.skill_id = s.id
         WHERE c.skill_id IS NOT NULL
         GROUP BY c.skill_id`
      )
      .all() as Record<string, unknown>[];

    return {
      totalRuns: Number(runAgg.total_runs ?? 0),
      successfulRuns: Number(runAgg.successful_runs ?? 0),
      failedRuns: Number(runAgg.failed_runs ?? 0),
      avgDurationMs: Math.round(Number(runAgg.avg_duration_ms ?? 0)),
      avgSteps: Number(Number(stepAgg.avg_steps ?? 0).toFixed(1)),
      totalInputTokens: Number(costAgg.in_tok ?? 0),
      totalOutputTokens: Number(costAgg.out_tok ?? 0),
      totalCostUsd: Number(Number(costAgg.total_cost ?? 0).toFixed(6)),
      todayCostUsd: Number(this.getTodayCostUsd().toFixed(6)),
      byModel: byModelRows.map((m) => ({
        model: String(m.model),
        inputTokens: Number(m.in_tok),
        outputTokens: Number(m.out_tok),
        costUsd: Number(m.cost_usd)
      })),
      bySkill: bySkillRows.map((s) => ({
        skillId: String(s.skill_id),
        skillName: String(s.skill_name),
        runs: Number(s.runs),
        costUsd: Number(s.cost_usd)
      }))
    };
  }

  private mapRunRow(r: Record<string, unknown>, steps: AgentStep[]): AgentRun {
    return {
      id: String(r.id),
      conversationId: String(r.conversation_id),
      parentRunId: (r.parent_run_id as string | null) ?? null,
      tabId: (r.tab_id as string | null) ?? null,
      goal: String(r.goal),
      mode: r.mode as AgentRun['mode'],
      status: r.status as AgentRun['status'],
      planSummary: (r.plan_summary as string | null) ?? null,
      subgoals: JSON.parse(String(r.subgoals_json || '[]')),
      steps,
      finalAnswer: (r.final_answer as string | null) ?? null,
      failureReason: (r.failure_reason as string | null) ?? null,
      totalInputTokens: Number(r.total_input_tokens),
      totalOutputTokens: Number(r.total_output_tokens),
      estimatedCostUsd: Number(r.estimated_cost_usd),
      isCostEstimated: Boolean(r.is_cost_estimated),
      model: String(r.model),
      provider: String(r.provider),
      isPrivate: false,
      startedAt: Number(r.started_at),
      endedAt: (r.ended_at as number | null) ?? null
    };
  }

  // --- Long-Horizon Task Checkpoints ---
  saveCheckpoint(cp: TaskCheckpoint): void {
    this.db
      .prepare(
        `INSERT INTO task_checkpoints (run_id, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
      )
      .run(cp.runId, JSON.stringify(cp), cp.updatedAt);
  }

  getCheckpoint(runId: string): TaskCheckpoint | null {
    const row = this.db
      .prepare('SELECT state_json FROM task_checkpoints WHERE run_id = ?')
      .get(runId) as { state_json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.state_json) as TaskCheckpoint;
    } catch {
      return null;
    }
  }

  deleteCheckpoint(runId: string): void {
    this.db.prepare('DELETE FROM task_checkpoints WHERE run_id = ?').run(runId);
  }

  listInterruptedRuns(): Array<{ run: AgentRun; checkpoint: TaskCheckpoint }> {
    const rows = this.db
      .prepare(
        `SELECT r.*, c.state_json FROM agent_runs r
         INNER JOIN task_checkpoints c ON c.run_id = r.id
         WHERE r.status IN ('planning', 'running', 'paused', 'awaiting_hitl', 'awaiting_confirmation')
         ORDER BY c.updated_at DESC LIMIT 20`
      )
      .all() as Record<string, unknown>[];
    const out: Array<{ run: AgentRun; checkpoint: TaskCheckpoint }> = [];
    for (const r of rows) {
      try {
        out.push({
          run: this.mapRunRow(r, []),
          checkpoint: JSON.parse(String(r.state_json)) as TaskCheckpoint
        });
      } catch {
        // skip corrupted checkpoint
      }
    }
    return out;
  }

  // --- Research Reports ---
  saveResearchReport(report: ResearchReport): ResearchReport {
    this.db
      .prepare(
        `INSERT INTO research_reports (id, query, report_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET report_json = excluded.report_json`
      )
      .run(report.id, report.query, JSON.stringify(report), report.createdAt);
    return report;
  }

  listResearchReports(limit = 30): ResearchReport[] {
    const rows = this.db
      .prepare('SELECT report_json FROM research_reports ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<{ report_json: string }>;
    return rows.map((r) => JSON.parse(r.report_json) as ResearchReport);
  }

  getResearchReport(id: string): ResearchReport | null {
    const row = this.db
      .prepare('SELECT report_json FROM research_reports WHERE id = ?')
      .get(id) as { report_json: string } | undefined;
    return row ? (JSON.parse(row.report_json) as ResearchReport) : null;
  }
}

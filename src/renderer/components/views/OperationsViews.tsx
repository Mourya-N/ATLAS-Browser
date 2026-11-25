import React, { useEffect, useState } from 'react';
import {
  Activity,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
  X
} from 'lucide-react';
import type {
  AgentRun,
  AuditEvent,
  CostSummary,
  DomainPermissionMode,
  DomainRule,
  McpServerStatus,
  ScheduledJob,
  ScheduleTriggerType,
  Skill
} from '@shared/types';
import { useAtlasStore } from '../../store/useAtlasStore';

const PanelShell: React.FC<{ title: string; icon: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  actions,
  children
}) => {
  const { setOverlayView } = useAtlasStore();
  return (
    <div className="flex h-full flex-col bg-atlas-bg text-atlas-text select-text">
      <div className="flex items-center justify-between border-b border-atlas-border bg-atlas-surface px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="text-atlas-accent">{icon}</span>
          <h1 className="text-base font-bold">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <button type="button" onClick={() => setOverlayView(null)} className="rounded-lg p-1.5 text-atlas-muted hover:bg-atlas-elevated">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  );
};

export const RunsAndReplayView: React.FC = () => {
  const { replayRunId, setOverlayView, activeConversationId, activeTabId } = useAtlasStore();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  const [stepCursor, setStepCursor] = useState(0);
  const [shotUrl, setShotUrl] = useState<string | null>(null);

  useEffect(() => {
    void window.atlas.listRuns().then((list) => {
      setRuns(list);
      const targetId = replayRunId || list[0]?.id;
      if (targetId) {
        void window.atlas.getRun(targetId).then((r) => {
          setSelectedRun(r);
          setStepCursor(0);
        });
      }
    });
  }, [replayRunId]);

  const activeStep = selectedRun?.steps[stepCursor] ?? null;

  useEffect(() => {
    if (activeStep?.screenshotPath) {
      void window.atlas.readScreenshotDataUrl(activeStep.screenshotPath).then(setShotUrl);
    } else {
      setShotUrl(null);
    }
  }, [activeStep?.id]);

  return (
    <PanelShell title="Run History & Replay Viewer" icon={<Activity className="h-5 w-5" />}>
      <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="space-y-2">
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={async () => {
                const full = await window.atlas.getRun(r.id);
                setSelectedRun(full);
                setStepCursor(0);
              }}
              className={`w-full rounded-xl border p-3 text-left space-y-1 ${
                selectedRun?.id === r.id
                  ? 'border-atlas-accent bg-atlas-surface'
                  : 'border-atlas-border bg-atlas-surface/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold truncate">{r.goal}</span>
                <span className="rounded bg-atlas-elevated px-1.5 py-0.5 text-[10px] uppercase">{r.status}</span>
              </div>
              <div className="text-[11px] text-atlas-muted">
                {new Date(r.startedAt).toLocaleString()} • ${r.estimatedCostUsd.toFixed(4)}
              </div>
            </button>
          ))}
        </div>

        <div className="md:col-span-2 rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-4">
          {!selectedRun ? (
            <div className="py-12 text-center text-atlas-muted">Select an agent run to inspect and replay.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-atlas-border pb-3">
                <div>
                  <h2 className="text-sm font-bold">{selectedRun.goal}</h2>
                  <p className="text-atlas-muted mt-0.5">
                    Status: {selectedRun.status} • Model: {selectedRun.model} • Tokens:{' '}
                    {selectedRun.totalInputTokens + selectedRun.totalOutputTokens} • Cost: $
                    {selectedRun.estimatedCostUsd.toFixed(4)}
                    {selectedRun.isCostEstimated ? ' (est.)' : ''}
                  </p>
                  {selectedRun.failureReason && (
                    <p className="mt-1 text-atlas-danger">Failure: {selectedRun.failureReason}</p>
                  )}
                </div>
                {activeConversationId && (
                  <button
                    type="button"
                    onClick={async () => {
                      await window.atlas.startAgentRun({
                        conversationId: activeConversationId,
                        tabId: activeTabId,
                        goal: selectedRun.goal,
                        mode: 'assist' // Safe replay in assist mode — never auto-executes sensitive actions
                      });
                      setOverlayView(null);
                    }}
                    className="shrink-0 rounded-lg bg-atlas-accent px-3 py-1.5 font-semibold text-white"
                  >
                    Safe Replay (Assist Mode)
                  </button>
                )}
              </div>

              {selectedRun.steps.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      Step {stepCursor + 1} of {selectedRun.steps.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={stepCursor === 0}
                        onClick={() => setStepCursor((c) => Math.max(0, c - 1))}
                        className="rounded border border-atlas-border p-1 disabled:opacity-30"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={stepCursor >= selectedRun.steps.length - 1}
                        onClick={() => setStepCursor((c) => Math.min(selectedRun.steps.length - 1, c + 1))}
                        className="rounded border border-atlas-border p-1 disabled:opacity-30"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {activeStep && (
                    <div className="rounded-xl border border-atlas-border bg-atlas-bg p-3.5 space-y-2">
                      <div className="font-bold">
                        [{activeStep.phase}] {activeStep.summary}
                      </div>
                      <p className="text-atlas-muted">{activeStep.decisionExplanation}</p>
                      {activeStep.evidence && (
                        <div className="rounded bg-atlas-surface p-2 font-mono text-[11px]">
                          Evidence: {activeStep.evidence}
                        </div>
                      )}
                      {activeStep.toolExecution && (
                        <div className="rounded bg-atlas-surface p-2 font-mono text-[11px] space-y-1">
                          <div>
                            Tool: {activeStep.toolExecution.toolName} | Tier: {activeStep.toolExecution.permissionTier} | Decision: {activeStep.toolExecution.permissionDecision}
                          </div>
                          <div>Args: {JSON.stringify(activeStep.toolExecution.args)}</div>
                          {activeStep.toolExecution.pageDiff && (
                            <div>
                              Diff: urlChanged={String(activeStep.toolExecution.pageDiff.urlChanged)}, +
                              {activeStep.toolExecution.pageDiff.addedElementsCount}/-
                              {activeStep.toolExecution.pageDiff.removedElementsCount} elements
                            </div>
                          )}
                        </div>
                      )}
                      {shotUrl && (
                        <img src={shotUrl} alt="Step screenshot" className="max-h-72 rounded-lg border border-atlas-border" />
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PanelShell>
  );
};

export const SchedulerView: React.FC = () => {
  const { pushToast } = useAtlasStore();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [name, setName] = useState('');
  const [skillId, setSkillId] = useState('');
  const [triggerType, setTriggerType] = useState<ScheduleTriggerType>('daily');
  const [cronExpression, setCronExpression] = useState('0 9 * * *');

  const load = async () => {
    const [j, s] = await Promise.all([window.atlas.listScheduledJobs(), window.atlas.listSkills()]);
    setJobs(j);
    setSkills(s);
    if (!skillId && s[0]) setSkillId(s[0].id);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <PanelShell title="Scheduled Workflows" icon={<CalendarClock className="h-5 w-5" />}>
      <div className="mx-auto max-w-4xl space-y-5 text-xs">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || !skillId) return;
            await window.atlas.saveScheduledJob({
              name: name.trim(),
              skillId,
              triggerType,
              cronExpression: triggerType === 'cron' || triggerType === 'event' ? cronExpression : undefined
            });
            setName('');
            void load();
          }}
          className="rounded-xl border border-atlas-border bg-atlas-surface p-4 grid grid-cols-1 sm:grid-cols-4 gap-2"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Job name"
            className="rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1.5"
          />
          <select
            value={skillId}
            onChange={(e) => setSkillId(e.target.value)}
            className="rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1.5"
          >
            {skills.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value as ScheduleTriggerType)}
            className="rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1.5"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="cron">Cron Expression</option>
            <option value="once">One-Time</option>
            <option value="event">Event Triggered</option>
          </select>
          <div className="flex gap-1.5">
            {(triggerType === 'cron' || triggerType === 'event') && (
              <input
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                placeholder={triggerType === 'cron' ? '0 9 * * *' : 'event_name'}
                className="w-28 rounded-lg border border-atlas-border bg-atlas-bg px-2 py-1.5 font-mono"
              />
            )}
            <button
              type="submit"
              disabled={!skills.length}
              className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-atlas-accent px-3 py-1.5 font-semibold text-white disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Schedule
            </button>
          </div>
        </form>

        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-xl border border-atlas-border bg-atlas-surface p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-sm">{job.name}</div>
                <div className="text-atlas-muted">
                  Trigger: {job.triggerType} {job.cronExpression ? `(${job.cronExpression})` : ''} • TZ: {job.timezone}
                </div>
                <div className="text-[11px] text-atlas-muted">
                  Next: {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : 'N/A'} • Last Status: {job.lastStatus || 'Never run'}
                </div>
                {job.lastError && <div className="text-atlas-danger mt-0.5">{job.lastError}</div>}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    const updated = await window.atlas.runScheduledJobNow(job.id);
                    pushToast(`Job "${job.name}": ${updated.lastStatus}`, updated.lastStatus === 'completed' ? 'success' : 'warning');
                    void load();
                  }}
                  className="flex items-center gap-1 rounded bg-atlas-accent px-2.5 py-1 font-semibold text-white"
                >
                  <Play className="h-3 w-3" /> Run Now
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await window.atlas.toggleScheduledJob(job.id, { paused: !job.paused });
                    void load();
                  }}
                  className="rounded bg-atlas-elevated p-1.5"
                >
                  {job.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await window.atlas.deleteScheduledJob(job.id);
                    void load();
                  }}
                  className="rounded p-1.5 text-atlas-muted hover:text-atlas-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
};

export const DashboardView: React.FC = () => {
  const [summary, setSummary] = useState<CostSummary | null>(null);

  useEffect(() => {
    void window.atlas.getStatsSummary().then(setSummary);
  }, []);

  return (
    <PanelShell title="Observability & Cost Dashboard" icon={<Activity className="h-5 w-5" />}>
      {summary && (
        <div className="mx-auto max-w-5xl space-y-6 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Runs" value={String(summary.totalRuns)} />
            <StatCard label="Successful / Failed" value={`${summary.successfulRuns} / ${summary.failedRuns}`} />
            <StatCard label="Avg Duration / Steps" value={`${(summary.avgDurationMs / 1000).toFixed(1)}s / ${summary.avgSteps}`} />
            <StatCard label="Total Cost (Today)" value={`$${summary.totalCostUsd.toFixed(4)} ($${summary.todayCostUsd.toFixed(4)})`} />
          </div>

          <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-2">
            <h2 className="font-bold text-sm">Usage by Model</h2>
            <div className="space-y-1.5">
              {summary.byModel.map((m) => (
                <div key={m.model} className="flex items-center justify-between border-b border-atlas-border/40 py-1.5">
                  <span className="font-mono font-semibold">{m.model}</span>
                  <span className="text-atlas-muted">
                    In: {m.inputTokens.toLocaleString()} • Out: {m.outputTokens.toLocaleString()} • ${m.costUsd.toFixed(5)}
                  </span>
                </div>
              ))}
              {summary.byModel.length === 0 && <div className="text-atlas-muted">No model usage recorded yet.</div>}
            </div>
          </div>
        </div>
      )}
    </PanelShell>
  );
};

const StatCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4">
    <div className="text-[11px] uppercase text-atlas-muted font-semibold">{label}</div>
    <div className="mt-1 text-lg font-bold">{value}</div>
  </div>
);

export const AuditAndRulesView: React.FC = () => {
  const { pushToast } = useAtlasStore();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [rules, setRules] = useState<DomainRule[]>([]);
  const [query, setQuery] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newMode, setNewMode] = useState<DomainPermissionMode>('read_only');

  const load = async (q = query) => {
    const [ev, dr] = await Promise.all([
      window.atlas.listAuditEvents(q),
      window.atlas.listDomainRules()
    ]);
    setEvents(ev);
    setRules(dr);
  };

  useEffect(() => {
    void load('');
  }, []);

  return (
    <PanelShell
      title="Audit Logs & Domain Permissions"
      icon={<ShieldAlert className="h-5 w-5" />}
      actions={
        <>
          <button
            type="button"
            onClick={async () => {
              const json = await window.atlas.exportAuditEvents();
              await navigator.clipboard.writeText(json);
              pushToast('Audit log JSON copied to clipboard', 'success');
            }}
            className="flex items-center gap-1 rounded-lg border border-atlas-border bg-atlas-elevated px-3 py-1.5 text-xs font-semibold"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <button
            type="button"
            onClick={async () => {
              await window.atlas.deleteAuditEvents();
              void load('');
            }}
            className="rounded-lg border border-atlas-danger/40 bg-atlas-danger/10 px-3 py-1.5 text-xs font-semibold text-atlas-danger"
          >
            Clear Logs
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-5xl space-y-6 text-xs">
        <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-3">
          <h2 className="font-bold text-sm">Domain Permission Rules</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newDomain.trim()) return;
              await window.atlas.setDomainRule(newDomain.trim(), newMode);
              setNewDomain('');
              void load();
            }}
            className="flex flex-wrap gap-2"
          >
            <input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="example.com"
              className="flex-1 min-w-[180px] rounded-lg border border-atlas-border bg-atlas-bg px-3 py-1.5"
            />
            <select
              value={newMode}
              onChange={(e) => setNewMode(e.target.value as DomainPermissionMode)}
              className="rounded-lg border border-atlas-border bg-atlas-bg px-3 py-1.5"
            >
              <option value="allow">Allow (Non-Sensitive)</option>
              <option value="interact">Interact</option>
              <option value="read_only">Read-Only</option>
              <option value="deny">Deny All Agent Access</option>
            </select>
            <button type="submit" className="rounded-lg bg-atlas-accent px-3 py-1.5 font-semibold text-white">
              Save Rule
            </button>
          </form>
          <div className="space-y-1">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg bg-atlas-bg px-3 py-2">
                <span>
                  <strong>{r.domain}</strong> — <span className="uppercase text-atlas-accent">{r.mode}</span>
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await window.atlas.deleteDomainRule(r.id);
                    void load();
                  }}
                  className="text-atlas-muted hover:text-atlas-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              void load(e.target.value);
            }}
            placeholder="Filter audit events..."
            className="w-full rounded-xl border border-atlas-border bg-atlas-surface px-3 py-2 outline-none"
          />
          {events.map((ev) => (
            <div key={ev.id} className="rounded-xl border border-atlas-border bg-atlas-surface p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold">
                  [{ev.category}] {ev.action}
                </span>
                <span className="text-atlas-muted">{new Date(ev.createdAt).toLocaleString()}</span>
              </div>
              <pre className="overflow-x-auto font-mono text-[11px] text-atlas-muted">
                {JSON.stringify(ev.details)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
};

export const McpServerView: React.FC = () => {
  const { pushToast } = useAtlasStore();
  const [status, setStatus] = useState<McpServerStatus | null>(null);
  const [port, setPort] = useState(47291);

  const load = async () => {
    const s = await window.atlas.getMcpStatus();
    setStatus(s);
    setPort(s.port);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <PanelShell title="Local MCP Tool Server" icon={<Server className="h-5 w-5" />}>
      {status && (
        <div className="mx-auto max-w-3xl space-y-4 text-xs">
          <div className="rounded-xl border border-atlas-border bg-atlas-surface p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold">
                  Status: {status.running ? `Running on http://${status.boundHost}:${status.port}/mcp` : 'Stopped (Disabled by Default)'}
                </div>
                <div className="text-atlas-muted mt-0.5">
                  Requests served: {status.requestCount} • Bound strictly to localhost (127.0.0.1)
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const next = await window.atlas.configureMcp({ enabled: !status.running, port });
                  setStatus(next);
                  pushToast(next.running ? 'MCP server started' : 'MCP server stopped', 'info');
                }}
                className={`rounded-lg px-4 py-2 font-semibold text-white ${
                  status.running ? 'bg-atlas-danger' : 'bg-atlas-accent'
                }`}
              >
                {status.running ? 'Disable & Stop' : 'Enable & Start'}
              </button>
            </div>

            <div className="flex items-center gap-2 border-t border-atlas-border pt-3">
              <span className="font-semibold">Auth Token:</span>
              <code className="rounded bg-atlas-bg px-2 py-1 font-mono">{status.maskedToken}</code>
              <button
                type="button"
                onClick={async () => {
                  const tok = await window.atlas.getMcpToken();
                  await navigator.clipboard.writeText(tok);
                  pushToast('MCP Bearer token copied to clipboard', 'success');
                }}
                className="flex items-center gap-1 rounded bg-atlas-elevated px-2.5 py-1"
              >
                <Copy className="h-3 w-3" /> Copy Token
              </button>
              <button
                type="button"
                onClick={async () => {
                  const next = await window.atlas.rotateMcpToken();
                  setStatus(next);
                  pushToast('MCP token rotated', 'success');
                }}
                className="flex items-center gap-1 rounded bg-atlas-elevated px-2.5 py-1"
              >
                <RefreshCw className="h-3 w-3" /> Rotate
              </button>
            </div>

            <div>
              <div className="font-semibold mb-1.5">Allowlisted Tools</div>
              <div className="flex flex-wrap gap-1.5">
                {status.allowedTools.map((t) => (
                  <span key={t} className="rounded-md bg-atlas-elevated px-2 py-1 font-mono text-[11px]">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </PanelShell>
  );
};

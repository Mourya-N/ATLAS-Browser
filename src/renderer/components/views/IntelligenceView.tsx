import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpenCheck,
  Copy,
  GitCompare,
  History,
  Play,
  Search,
  Sparkles,
  X
} from 'lucide-react';
import type {
  AgentRun,
  CrossTabAnalysis,
  PageChangeResult,
  ResearchReport,
  TaskCheckpoint
} from '@shared/types';
import { useLavrayStore } from '../../store/useLavrayStore';

export const IntelligenceView: React.FC = () => {
  const { tabs, activeTabId, setOverlayView, pushToast, setSelectedContextTabIds } = useLavrayStore();
  const [section, setSection] = useState<'research' | 'page' | 'crosstab' | 'checkpoints'>('research');

  // Research state
  const [researchQuery, setResearchQuery] = useState('Compare open sources and summarize key facts');
  const [reports, setReports] = useState<ResearchReport[]>([]);
  const [activeReport, setActiveReport] = useState<ResearchReport | null>(null);
  const [researchRunning, setResearchRunning] = useState(false);

  // Page understanding state
  const [question, setQuestion] = useState('What is this page about? List key facts and limitations.');
  const [pageResult, setPageResult] = useState<{
    answer: string;
    entities: Array<{ name: string; type: string; relationship?: string }>;
    unavailableNotes: string[];
    relevantChunks: Array<{ index: number; heading: string; text: string; score: number }>;
  } | null>(null);
  const [changeResult, setChangeResult] = useState<PageChangeResult | null>(null);

  // Cross-tab state
  const [selectedTabs, setSelectedTabs] = useState<string[]>([]);
  const [crossTabAnalysis, setCrossTabAnalysis] = useState<CrossTabAnalysis | null>(null);
  const [comparisonMd, setComparisonMd] = useState('');

  // Checkpoints state
  const [interrupted, setInterrupted] = useState<Array<{ run: AgentRun; checkpoint: TaskCheckpoint }>>([]);

  useEffect(() => {
    void window.lavray.listResearchReports().then((list) => {
      setReports(list);
      if (list[0]) setActiveReport(list[0]);
    });
    void window.lavray.listInterruptedRuns().then(setInterrupted);
    const nonPrivate = tabs.filter((t) => !t.isPrivate).map((t) => t.id);
    setSelectedTabs(nonPrivate);
  }, []);

  return (
    <div className="flex h-full flex-col bg-lavray-bg text-lavray-text select-text">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-lavray-border bg-lavray-surface px-6">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-lavray-accent" strokeWidth={1.75} />
          <h1 className="text-[14px] font-semibold tracking-[-0.01em]">
            Research, Page Understanding & Cross-Tab Workspace
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setOverlayView(null)}
          className="rounded-lg p-1.5 text-lavray-muted hover:bg-lavray-shell hover:text-lavray-text"
          aria-label="Close Research Workspace"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-5 border-b border-lavray-border bg-lavray-surface px-6 pt-1 text-xs">
        <TabBtn active={section === 'research'} onClick={() => setSection('research')} icon={<BookOpenCheck className="h-3.5 w-3.5" />} label="Research & Evidence" />
        <TabBtn active={section === 'page'} onClick={() => setSection('page')} icon={<Search className="h-3.5 w-3.5" />} label="Page Understanding & Changes" />
        <TabBtn active={section === 'crosstab'} onClick={() => setSection('crosstab')} icon={<GitCompare className="h-3.5 w-3.5" />} label="Cross-Tab Intelligence" />
        <TabBtn active={section === 'checkpoints'} onClick={() => setSection('checkpoints')} icon={<History className="h-3.5 w-3.5" />} label={`Resumable Tasks (${interrupted.length})`} />
      </div>

      <div className="flex-1 overflow-y-auto p-6 text-xs">
        {section === 'research' && (
          <div className="mx-auto max-w-5xl space-y-4">
            <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-3">
              <div className="font-semibold">Synthesize Evidence-Backed Report from Selected Open Tabs</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {tabs
                  .filter((t) => !t.isPrivate)
                  .map((t) => (
                    <label key={t.id} className="flex items-center gap-2 rounded bg-lavray-bg px-3 py-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTabs.includes(t.id)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selectedTabs, t.id]
                            : selectedTabs.filter((id) => id !== t.id);
                          setSelectedTabs(next);
                          setSelectedContextTabIds(next);
                        }}
                      />
                      <span className="truncate font-medium">{t.title}</span>
                      <span className="truncate text-lavray-muted">{t.url}</span>
                    </label>
                  ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={researchQuery}
                  onChange={(e) => setResearchQuery(e.target.value)}
                  className="flex-1 rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 outline-none"
                />
                <button
                  type="button"
                  disabled={researchRunning}
                  onClick={async () => {
                    setResearchRunning(true);
                    try {
                      const rep = await window.lavray.runResearch(researchQuery, selectedTabs);
                      setActiveReport(rep);
                      setReports(await window.lavray.listResearchReports());
                    } catch (err) {
                      pushToast(err instanceof Error ? err.message : 'Research failed', 'danger');
                    } finally {
                      setResearchRunning(false);
                    }
                  }}
                  className="rounded-lg bg-lavray-accent px-4 py-2 font-semibold text-lavray-accent-fg disabled:opacity-50"
                >
                  {researchRunning ? 'Synthesizing...' : 'Generate Report'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                {reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActiveReport(r)}
                    className={`w-full rounded-xl border p-3 text-left ${
                      activeReport?.id === r.id ? 'border-lavray-accent bg-lavray-surface' : 'border-lavray-border bg-lavray-surface/50'
                    }`}
                  >
                    <div className="font-bold truncate">{r.query}</div>
                    <div className="text-[11px] text-lavray-muted">
                      {r.sources.length} sources • {r.claims.length} claims
                    </div>
                  </button>
                ))}
              </div>

              {activeReport && (
                <div className="md:col-span-2 rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-4">
                  <div className="flex items-center justify-between border-b border-lavray-border pb-2">
                    <h2 className="text-sm font-bold">{activeReport.query}</h2>
                    <button
                      type="button"
                      onClick={async () => {
                        const md = await window.lavray.exportResearchMarkdown(activeReport.id);
                        await navigator.clipboard.writeText(md);
                        pushToast('Markdown report copied to clipboard', 'success');
                      }}
                      className="flex items-center gap-1 rounded bg-lavray-elevated px-2.5 py-1 font-semibold"
                    >
                      <Copy className="h-3 w-3" /> Export Markdown
                    </button>
                  </div>
                  <p className="leading-relaxed">{activeReport.summary}</p>
                  {activeReport.claims.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="font-bold uppercase text-[10px] text-lavray-muted">Claims & Supporting Evidence</div>
                      {activeReport.claims.map((c) => (
                        <div key={c.id} className="rounded-lg border border-lavray-border bg-lavray-bg p-2.5 space-y-1">
                          <div>
                            <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${c.kind === 'fact' ? 'bg-lavray-success/15 text-lavray-success' : 'bg-lavray-accent/15 text-lavray-accent'}`}>
                              {c.kind}
                            </span>
                            <span>{c.claim}</span>
                          </div>
                          {c.supportingQuote && (
                            <div className="text-[11px] text-lavray-muted italic">
                              "{c.supportingQuote}" — {c.sourceTitle} ({c.sourceUrl})
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {activeReport.conflicts.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="font-bold uppercase text-[10px] text-lavray-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Contradictions Detected
                      </div>
                      {activeReport.conflicts.map((cf, i) => (
                        <div key={i} className="rounded-lg border border-lavray-warning/40 bg-lavray-warning/10 p-2.5">
                          <strong>{cf.topic}</strong>: "{cf.statementA}" ({cf.sourceA}) vs "{cf.statementB}" ({cf.sourceB})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'page' && (
          <div className="mx-auto max-w-4xl space-y-4">
            <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className="flex-1 rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 outline-none"
                />
                <button
                  type="button"
                  disabled={!activeTabId}
                  onClick={async () => {
                    if (!activeTabId) return;
                    const res = await window.lavray.understandPage(activeTabId, question);
                    setPageResult(res);
                  }}
                  className="rounded-lg bg-lavray-accent px-4 py-2 font-semibold text-lavray-accent-fg"
                >
                  Analyze Page
                </button>
                <button
                  type="button"
                  disabled={!activeTabId}
                  onClick={async () => {
                    if (!activeTabId) return;
                    setChangeResult(await window.lavray.checkPageChanges(activeTabId));
                  }}
                  className="rounded-lg border border-lavray-border bg-lavray-elevated px-3 py-2 font-semibold"
                >
                  Check Changes Since Last Visit
                </button>
              </div>
            </div>

            {changeResult && (
              <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-1">
                <div className="font-bold">Page Change Detection</div>
                <p>{changeResult.summary}</p>
              </div>
            )}

            {pageResult && (
              <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-3">
                <div className="font-bold text-sm">Grounded Answer</div>
                <p className="whitespace-pre-wrap">{pageResult.answer}</p>
                {pageResult.entities.length > 0 && (
                  <div>
                    <div className="font-semibold text-lavray-muted uppercase text-[10px] mb-1">Extracted Entities</div>
                    <div className="flex flex-wrap gap-1.5">
                      {pageResult.entities.map((e, i) => (
                        <span key={i} className="rounded bg-lavray-elevated px-2 py-1">
                          {e.name} ({e.type})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {pageResult.unavailableNotes.length > 0 && (
                  <div className="text-lavray-warning">
                    Unavailable on page: {pageResult.unavailableNotes.join('; ')}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {section === 'crosstab' && (
          <div className="mx-auto max-w-4xl space-y-4">
            <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-3">
              <div className="font-semibold">Select Non-Private Tabs for AI Inspection</div>
              <div className="space-y-1">
                {tabs
                  .filter((t) => !t.isPrivate)
                  .map((t) => (
                    <label key={t.id} className="flex items-center gap-2 rounded bg-lavray-bg px-3 py-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTabs.includes(t.id)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selectedTabs, t.id]
                            : selectedTabs.filter((id) => id !== t.id);
                          setSelectedTabs(next);
                          setSelectedContextTabIds(next);
                        }}
                      />
                      <span className="truncate font-medium">{t.title}</span>
                      <span className="truncate text-lavray-muted">{t.url}</span>
                    </label>
                  ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => setCrossTabAnalysis(await window.lavray.analyzeCrossTabs(selectedTabs))}
                  className="rounded-lg border border-lavray-border bg-lavray-elevated px-3 py-2 font-semibold"
                >
                  Detect Duplicates & Related Tabs
                </button>
                <button
                  type="button"
                  onClick={async () =>
                    setComparisonMd(await window.lavray.compareCrossTabs('Features, pricing, and key differences', selectedTabs))
                  }
                  className="rounded-lg bg-lavray-accent px-4 py-2 font-semibold text-lavray-accent-fg"
                >
                  Compare Selected Tabs
                </button>
              </div>
            </div>

            {crossTabAnalysis && (
              <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold">{crossTabAnalysis.summary}</div>
                  {crossTabAnalysis.duplicateGroups.length > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        let closed = 0;
                        for (const grp of crossTabAnalysis.duplicateGroups) {
                          for (const dupId of grp.tabIds.slice(1)) {
                            await window.lavray.closeTab(dupId);
                            closed += 1;
                          }
                        }
                        pushToast(`Closed ${closed} duplicate tab(s)`, 'success');
                        setCrossTabAnalysis(await window.lavray.analyzeCrossTabs(selectedTabs));
                      }}
                      className="rounded-lg bg-lavray-warning/20 px-2.5 py-1 text-[11px] font-semibold text-lavray-warning hover:bg-lavray-warning/30"
                    >
                      Approve & Close Duplicates
                    </button>
                  )}
                </div>
                {crossTabAnalysis.duplicateGroups.map((g, i) => (
                  <div key={i} className="text-lavray-warning">
                    Duplicate URL ({g.tabIds.length} tabs): {g.url}
                  </div>
                ))}
                {crossTabAnalysis.relatedPairs.map((p, i) => (
                  <div key={i} className="text-lavray-muted">
                    Related tabs ({Math.round(p.overlapScore * 100)}% overlap): {p.sharedTopics.join(', ')}
                  </div>
                ))}
              </div>
            )}

            {comparisonMd && (
              <pre className="rounded-xl border border-lavray-border bg-lavray-surface p-4 whitespace-pre-wrap font-sans">
                {comparisonMd}
              </pre>
            )}
          </div>
        )}

        {section === 'checkpoints' && (
          <div className="mx-auto max-w-4xl space-y-3">
            {interrupted.map(({ run, checkpoint }) => (
              <div key={run.id} className="flex items-center justify-between rounded-xl border border-lavray-border bg-lavray-surface p-4">
                <div>
                  <div className="font-bold">{run.goal}</div>
                  <div className="text-lavray-muted">
                    Steps completed: {checkpoint.stepCount} • Last URL: {checkpoint.activeUrl || 'N/A'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await window.lavray.resumeCheckpoint(run.id);
                    setOverlayView(null);
                  }}
                  className="flex items-center gap-1 rounded-lg bg-lavray-accent px-3 py-2 font-semibold text-lavray-accent-fg"
                >
                  <Play className="h-3.5 w-3.5" /> Safe Resume
                </button>
              </div>
            ))}
            {interrupted.length === 0 && (
              <div className="py-12 text-center text-lavray-muted">No interrupted tasks awaiting resume.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({
  active,
  onClick,
  icon,
  label
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`relative flex items-center gap-1.5 pb-2.5 pt-1.5 text-[12px] font-medium transition-colors ${
      active ? 'text-lavray-accent font-semibold' : 'text-lavray-muted hover:text-lavray-text'
    }`}
  >
    {icon}
    <span>{label}</span>
    {active && <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-lavray-accent" />}
  </button>
);

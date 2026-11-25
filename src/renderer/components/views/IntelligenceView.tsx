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
import { useAtlasStore } from '../../store/useAtlasStore';

export const IntelligenceView: React.FC = () => {
  const { tabs, activeTabId, setOverlayView, pushToast, setSelectedContextTabIds } = useAtlasStore();
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
    void window.atlas.listResearchReports().then((list) => {
      setReports(list);
      if (list[0]) setActiveReport(list[0]);
    });
    void window.atlas.listInterruptedRuns().then(setInterrupted);
    const nonPrivate = tabs.filter((t) => !t.isPrivate).map((t) => t.id);
    setSelectedTabs(nonPrivate);
  }, []);

  return (
    <div className="flex h-full flex-col bg-atlas-bg text-atlas-text select-text">
      <div className="flex items-center justify-between border-b border-atlas-border bg-atlas-surface px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-5 w-5 text-atlas-accent" />
          <h1 className="text-base font-bold">Research, Page Understanding & Cross-Tab Intelligence</h1>
        </div>
        <button
          type="button"
          onClick={() => setOverlayView(null)}
          className="rounded-lg p-1.5 text-atlas-muted hover:bg-atlas-elevated"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-1 border-b border-atlas-border bg-atlas-surface/50 px-6 py-2 text-xs">
        <TabBtn active={section === 'research'} onClick={() => setSection('research')} icon={<BookOpenCheck className="h-3.5 w-3.5" />} label="Research & Evidence" />
        <TabBtn active={section === 'page'} onClick={() => setSection('page')} icon={<Search className="h-3.5 w-3.5" />} label="Page Understanding & Changes" />
        <TabBtn active={section === 'crosstab'} onClick={() => setSection('crosstab')} icon={<GitCompare className="h-3.5 w-3.5" />} label="Cross-Tab Intelligence" />
        <TabBtn active={section === 'checkpoints'} onClick={() => setSection('checkpoints')} icon={<History className="h-3.5 w-3.5" />} label={`Resumable Tasks (${interrupted.length})`} />
      </div>

      <div className="flex-1 overflow-y-auto p-6 text-xs">
        {section === 'research' && (
          <div className="mx-auto max-w-5xl space-y-4">
            <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-3">
              <div className="font-semibold">Synthesize Evidence-Backed Report from Selected Open Tabs</div>
              <div className="flex gap-2">
                <input
                  value={researchQuery}
                  onChange={(e) => setResearchQuery(e.target.value)}
                  className="flex-1 rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2 outline-none"
                />
                <button
                  type="button"
                  disabled={researchRunning}
                  onClick={async () => {
                    setResearchRunning(true);
                    try {
                      const rep = await window.atlas.runResearch(researchQuery, selectedTabs);
                      setActiveReport(rep);
                      setReports(await window.atlas.listResearchReports());
                    } catch (err) {
                      pushToast(err instanceof Error ? err.message : 'Research failed', 'danger');
                    } finally {
                      setResearchRunning(false);
                    }
                  }}
                  className="rounded-lg bg-atlas-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
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
                      activeReport?.id === r.id ? 'border-atlas-accent bg-atlas-surface' : 'border-atlas-border bg-atlas-surface/50'
                    }`}
                  >
                    <div className="font-bold truncate">{r.query}</div>
                    <div className="text-[11px] text-atlas-muted">
                      {r.sources.length} sources • {r.claims.length} claims
                    </div>
                  </button>
                ))}
              </div>

              {activeReport && (
                <div className="md:col-span-2 rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-4">
                  <div className="flex items-center justify-between border-b border-atlas-border pb-2">
                    <h2 className="text-sm font-bold">{activeReport.query}</h2>
                    <button
                      type="button"
                      onClick={async () => {
                        const md = await window.atlas.exportResearchMarkdown(activeReport.id);
                        await navigator.clipboard.writeText(md);
                        pushToast('Markdown report copied to clipboard', 'success');
                      }}
                      className="flex items-center gap-1 rounded bg-atlas-elevated px-2.5 py-1 font-semibold"
                    >
                      <Copy className="h-3 w-3" /> Export Markdown
                    </button>
                  </div>
                  <p className="leading-relaxed">{activeReport.summary}</p>
                  {activeReport.claims.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="font-bold uppercase text-[10px] text-atlas-muted">Claims & Supporting Evidence</div>
                      {activeReport.claims.map((c) => (
                        <div key={c.id} className="rounded-lg border border-atlas-border bg-atlas-bg p-2.5 space-y-1">
                          <div>
                            <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${c.kind === 'fact' ? 'bg-atlas-success/15 text-atlas-success' : 'bg-atlas-accent/15 text-atlas-accent'}`}>
                              {c.kind}
                            </span>
                            <span>{c.claim}</span>
                          </div>
                          {c.supportingQuote && (
                            <div className="text-[11px] text-atlas-muted italic">
                              "{c.supportingQuote}" — {c.sourceTitle} ({c.sourceUrl})
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {activeReport.conflicts.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="font-bold uppercase text-[10px] text-atlas-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Contradictions Detected
                      </div>
                      {activeReport.conflicts.map((cf, i) => (
                        <div key={i} className="rounded-lg border border-atlas-warning/40 bg-atlas-warning/10 p-2.5">
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
            <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className="flex-1 rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2 outline-none"
                />
                <button
                  type="button"
                  disabled={!activeTabId}
                  onClick={async () => {
                    if (!activeTabId) return;
                    const res = await window.atlas.understandPage(activeTabId, question);
                    setPageResult(res);
                  }}
                  className="rounded-lg bg-atlas-accent px-4 py-2 font-semibold text-white"
                >
                  Analyze Page
                </button>
                <button
                  type="button"
                  disabled={!activeTabId}
                  onClick={async () => {
                    if (!activeTabId) return;
                    setChangeResult(await window.atlas.checkPageChanges(activeTabId));
                  }}
                  className="rounded-lg border border-atlas-border bg-atlas-elevated px-3 py-2 font-semibold"
                >
                  Check Changes Since Last Visit
                </button>
              </div>
            </div>

            {changeResult && (
              <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-1">
                <div className="font-bold">Page Change Detection</div>
                <p>{changeResult.summary}</p>
              </div>
            )}

            {pageResult && (
              <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-3">
                <div className="font-bold text-sm">Grounded Answer</div>
                <p className="whitespace-pre-wrap">{pageResult.answer}</p>
                {pageResult.entities.length > 0 && (
                  <div>
                    <div className="font-semibold text-atlas-muted uppercase text-[10px] mb-1">Extracted Entities</div>
                    <div className="flex flex-wrap gap-1.5">
                      {pageResult.entities.map((e, i) => (
                        <span key={i} className="rounded bg-atlas-elevated px-2 py-1">
                          {e.name} ({e.type})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {pageResult.unavailableNotes.length > 0 && (
                  <div className="text-atlas-warning">
                    Unavailable on page: {pageResult.unavailableNotes.join('; ')}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {section === 'crosstab' && (
          <div className="mx-auto max-w-4xl space-y-4">
            <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-3">
              <div className="font-semibold">Select Non-Private Tabs for AI Inspection</div>
              <div className="space-y-1">
                {tabs
                  .filter((t) => !t.isPrivate)
                  .map((t) => (
                    <label key={t.id} className="flex items-center gap-2 rounded bg-atlas-bg px-3 py-1.5 cursor-pointer">
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
                      <span className="truncate text-atlas-muted">{t.url}</span>
                    </label>
                  ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => setCrossTabAnalysis(await window.atlas.analyzeCrossTabs(selectedTabs))}
                  className="rounded-lg border border-atlas-border bg-atlas-elevated px-3 py-2 font-semibold"
                >
                  Detect Duplicates & Related Tabs
                </button>
                <button
                  type="button"
                  onClick={async () =>
                    setComparisonMd(await window.atlas.compareCrossTabs('Features, pricing, and key differences', selectedTabs))
                  }
                  className="rounded-lg bg-atlas-accent px-4 py-2 font-semibold text-white"
                >
                  Compare Selected Tabs
                </button>
              </div>
            </div>

            {crossTabAnalysis && (
              <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-2">
                <div className="font-bold">{crossTabAnalysis.summary}</div>
                {crossTabAnalysis.duplicateGroups.map((g, i) => (
                  <div key={i} className="text-atlas-warning">
                    Duplicate URL ({g.tabIds.length} tabs): {g.url}
                  </div>
                ))}
                {crossTabAnalysis.relatedPairs.map((p, i) => (
                  <div key={i} className="text-atlas-muted">
                    Related tabs ({Math.round(p.overlapScore * 100)}% overlap): {p.sharedTopics.join(', ')}
                  </div>
                ))}
              </div>
            )}

            {comparisonMd && (
              <pre className="rounded-xl border border-atlas-border bg-atlas-surface p-4 whitespace-pre-wrap font-sans">
                {comparisonMd}
              </pre>
            )}
          </div>
        )}

        {section === 'checkpoints' && (
          <div className="mx-auto max-w-4xl space-y-3">
            {interrupted.map(({ run, checkpoint }) => (
              <div key={run.id} className="flex items-center justify-between rounded-xl border border-atlas-border bg-atlas-surface p-4">
                <div>
                  <div className="font-bold">{run.goal}</div>
                  <div className="text-atlas-muted">
                    Steps completed: {checkpoint.stepCount} • Last URL: {checkpoint.activeUrl || 'N/A'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await window.atlas.resumeCheckpoint(run.id);
                    setOverlayView(null);
                  }}
                  className="flex items-center gap-1 rounded-lg bg-atlas-accent px-3 py-2 font-semibold text-white"
                >
                  <Play className="h-3.5 w-3.5" /> Safe Resume
                </button>
              </div>
            ))}
            {interrupted.length === 0 && (
              <div className="py-12 text-center text-atlas-muted">No interrupted tasks awaiting resume.</div>
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
    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold ${
      active ? 'bg-atlas-accent text-white' : 'text-atlas-muted hover:bg-atlas-elevated'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

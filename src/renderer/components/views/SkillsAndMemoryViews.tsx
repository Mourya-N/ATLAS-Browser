import React, { useEffect, useState } from 'react';
import {
  Brain,
  Copy,
  Download,
  FileJson,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
  X
} from 'lucide-react';
import type { ExtractionResult, MemoryCategory, MemoryItem, Skill } from '@shared/types';
import { useLavrayStore } from '../../store/useLavrayStore';

const ModalShell: React.FC<{ title: string; icon: React.ReactNode; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  onClose,
  actions,
  children
}) => (
  <div className="flex h-full flex-col bg-lavray-bg text-lavray-text select-text">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-lavray-border bg-lavray-surface px-6">
      <div className="flex items-center gap-2.5">
        <span className="text-lavray-accent">{icon}</span>
        <h1 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-lavray-muted hover:bg-lavray-elevated">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
    <div className="flex-1 overflow-y-auto p-6">{children}</div>
  </div>
);

export const SkillsView: React.FC = () => {
  const { setOverlayView, activeTabId, pushToast } = useLavrayStore();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  const load = async () => {
    const list = await window.lavray.listSkills();
    setSkills(list);
    if (selected) {
      setSelected(list.find((s) => s.id === selected.id) ?? null);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <ModalShell
      title="Skills Library (Record & Replay)"
      icon={<Workflow className="h-5 w-5" />}
      onClose={() => setOverlayView(null)}
      actions={
        <>
          <button
            type="button"
            onClick={() => setShowImport((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-lavray-border bg-lavray-elevated px-3 py-1.5 text-xs font-semibold"
          >
            <Upload className="h-3.5 w-3.5" /> Import JSON
          </button>
          <button
            type="button"
            onClick={async () => {
              const now = Date.now();
              const blank: Skill = {
                id: crypto.randomUUID(),
                name: 'New Browser Skill',
                description: 'Navigates to a URL and reads the page',
                version: 1,
                parameters: [{ name: 'url', description: 'Target URL', type: 'string', required: true, defaultValue: 'https://example.com' }],
                preconditions: [],
                requiredPermissions: ['read_only', 'interact'],
                allowedDomains: [],
                steps: [
                  {
                    index: 0,
                    description: 'Navigate to target URL',
                    toolName: 'navigate',
                    argsTemplate: { url: '{{url}}' },
                    expectedOutcome: 'Target page loaded',
                    verificationRule: { type: 'url_contains', value: '{{url}}' },
                    recoveryStrategy: 'retry',
                    permissionTier: 'interact'
                  }
                ],
                createdAt: now,
                updatedAt: now,
                executionCount: 0,
                successCount: 0
              };
              const saved = await window.lavray.saveSkill(blank);
              setSelected(saved);
              void load();
            }}
            className="flex items-center gap-1 rounded-lg bg-lavray-accent px-3 py-1.5 text-xs font-semibold text-lavray-accent-fg"
          >
            <Plus className="h-3.5 w-3.5" /> New Skill
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-5xl space-y-4">
        {showImport && (
          <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-2">
            <textarea
              rows={4}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste exported LAVRAY Skill JSON..."
              className="w-full rounded-lg border border-lavray-border bg-lavray-bg p-2 text-xs font-mono outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                await window.lavray.importSkill(importText);
                setImportText('');
                setShowImport(false);
                pushToast('Skill imported', 'success');
                void load();
              }}
              className="rounded-lg bg-lavray-accent px-3 py-1.5 text-xs font-semibold text-lavray-accent-fg"
            >
              Import Skill
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            {skills.map((s) => {
              const rate = s.executionCount > 0 ? Math.round((s.successCount / s.executionCount) * 100) : 0;
              return (
                <div
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className={`cursor-pointer rounded-xl border p-3.5 text-xs space-y-1.5 ${
                    selected?.id === s.id
                      ? 'border-lavray-accent bg-lavray-surface'
                      : 'border-lavray-border bg-lavray-surface/60 hover:border-lavray-muted'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm">{s.name}</span>
                    <span className="rounded bg-lavray-elevated px-2 py-0.5 text-[10px]">v{s.version}</span>
                  </div>
                  <p className="text-lavray-muted line-clamp-2">{s.description}</p>
                  <div className="flex items-center justify-between pt-1 text-[11px] text-lavray-muted">
                    <span>{s.steps.length} steps • {s.executionCount} runs ({rate}% success)</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const params: Record<string, unknown> = {};
                          for (const p of s.parameters) {
                            params[p.name] = p.defaultValue ?? '';
                          }
                          const exec = await window.lavray.runSkill(s.id, params, activeTabId);
                          pushToast(
                            exec.status === 'completed' ? `Skill "${s.name}" completed` : `Skill failed: ${exec.error}`,
                            exec.status === 'completed' ? 'success' : 'danger'
                          );
                          void load();
                        }}
                        className="flex items-center gap-1 rounded bg-lavray-accent px-2 py-1 text-[10px] font-semibold text-lavray-accent-fg"
                      >
                        <Play className="h-3 w-3" /> Run
                      </button>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const params: Record<string, unknown> = {};
                          for (const p of s.parameters) {
                            params[p.name] = p.defaultValue ?? '';
                          }
                          const exec = await window.lavray.testSkill(s.id, params, activeTabId);
                          pushToast(
                            exec.status === 'completed' ? `Skill test passed` : `Skill test failed: ${exec.error}`,
                            exec.status === 'completed' ? 'success' : 'warning'
                          );
                          void load();
                        }}
                        className="rounded border border-lavray-border bg-lavray-elevated px-2 py-1 text-[10px] font-semibold"
                        title="Test skill with Assist confirmation"
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await window.lavray.duplicateSkill(s.id);
                          void load();
                        }}
                        className="rounded p-1 hover:bg-lavray-elevated"
                        title="Duplicate"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await window.lavray.deleteSkill(s.id);
                          if (selected?.id === s.id) setSelected(null);
                          void load();
                        }}
                        className="rounded p-1 hover:text-lavray-danger"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {skills.length === 0 && (
              <div className="rounded-xl border border-dashed border-lavray-border p-8 text-center text-xs text-lavray-muted">
                No skills saved yet. Complete an agent task and click "Save Skill" or create one above.
              </div>
            )}
          </div>

          {selected && (
            <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 text-xs space-y-3">
              <div className="flex items-center justify-between">
                <input
                  value={selected.name}
                  onChange={(e) => setSelected({ ...selected, name: e.target.value })}
                  className="flex-1 bg-transparent text-sm font-bold outline-none border-b border-transparent focus:border-lavray-accent"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const json = await window.lavray.exportSkill(selected.id);
                    await navigator.clipboard.writeText(json);
                    pushToast('Skill JSON copied to clipboard', 'success');
                  }}
                  className="flex items-center gap-1 rounded bg-lavray-elevated px-2 py-1 text-[11px]"
                >
                  <Download className="h-3 w-3" /> Export JSON
                </button>
              </div>
              <textarea
                rows={2}
                value={selected.description}
                onChange={(e) => setSelected({ ...selected, description: e.target.value })}
                className="w-full rounded-lg border border-lavray-border bg-lavray-bg p-2 outline-none"
              />
              <div>
                <div className="font-semibold mb-1 text-lavray-muted uppercase text-[10px]">
                  Workflow Steps ({selected.steps.length})
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {selected.steps.map((st) => (
                    <div key={st.index} className="rounded-lg border border-lavray-border bg-lavray-bg/60 p-2">
                      <div className="font-semibold">
                        {st.index + 1}. {st.toolName} — {st.description}
                      </div>
                      <div className="text-[11px] font-mono text-lavray-muted truncate">
                        {JSON.stringify(st.argsTemplate)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const updated = await window.lavray.saveSkill({
                    ...selected,
                    version: selected.version + 1,
                    updatedAt: Date.now()
                  });
                  setSelected(updated);
                  pushToast('Skill saved', 'success');
                  void load();
                }}
                className="rounded-lg bg-lavray-accent px-4 py-2 font-semibold text-lavray-accent-fg"
              >
                Save Changes
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
};

export const MemoryView: React.FC = () => {
  const { setOverlayView, pushToast } = useLavrayStore();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MemoryCategory>('user_preference');
  const [domain, setDomain] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const load = async (q = query) => {
    const res = q.trim() ? await window.lavray.searchMemory(q) : await window.lavray.listMemory();
    setItems(res);
  };

  useEffect(() => {
    void load('');
  }, []);

  return (
    <ModalShell
      title="Local Memory & Personalization"
      icon={<Brain className="h-5 w-5" />}
      onClose={() => setOverlayView(null)}
      actions={
        <>
          <button
            type="button"
            onClick={async () => {
              const json = await window.lavray.exportMemory();
              await navigator.clipboard.writeText(json);
              pushToast('Memory exported to clipboard', 'success');
            }}
            className="rounded-lg border border-lavray-border bg-lavray-elevated px-3 py-1.5 text-xs font-semibold"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={async () => {
              await window.lavray.clearMemory();
              void load('');
            }}
            className="rounded-lg border border-lavray-danger/40 bg-lavray-danger/10 px-3 py-1.5 text-xs font-semibold text-lavray-danger"
          >
            Clear All
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center gap-2 rounded-xl border border-lavray-border bg-lavray-surface px-3 py-2">
          <Search className="h-4 w-4 text-lavray-muted" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              void load(e.target.value);
            }}
            placeholder="Semantic search local memories..."
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim() || !content.trim()) return;
            try {
              await window.lavray.saveMemory({
                category,
                domain: domain.trim() || null,
                title: title.trim(),
                content: content.trim()
              });
              setTitle('');
              setContent('');
              setDomain('');
              void load();
            } catch (err) {
              pushToast(err instanceof Error ? err.message : 'Rejected sensitive memory', 'danger');
            }
          }}
          className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-2.5 text-xs"
        >
          <div className="font-semibold">Add Persistent Memory (Passwords/Tokens Automatically Blocked)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as MemoryCategory)}
              className="rounded-lg border border-lavray-border bg-lavray-bg px-2.5 py-1.5"
            >
              <option value="user_preference">User Preference</option>
              <option value="site_preference">Site Preference</option>
              <option value="workflow_preference">Workflow Preference</option>
              <option value="task_knowledge">Reusable Task Knowledge</option>
              <option value="task_summary">Task Summary</option>
            </select>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Optional domain (e.g. docs.spring.io)"
              className="rounded-lg border border-lavray-border bg-lavray-bg px-2.5 py-1.5"
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Memory title"
              className="rounded-lg border border-lavray-border bg-lavray-bg px-2.5 py-1.5"
            />
          </div>
          <textarea
            rows={2}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Preference or reusable workflow detail..."
            className="w-full rounded-lg border border-lavray-border bg-lavray-bg p-2"
          />
          <button type="submit" className="rounded-lg bg-lavray-accent px-4 py-1.5 font-semibold text-lavray-accent-fg">
            Save Memory
          </button>
        </form>

        <div className="space-y-2">
          {items.map((m) => (
            <div key={m.id} className="rounded-xl border border-lavray-border bg-lavray-surface p-3.5 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{m.title}</span>
                  <span className="rounded bg-lavray-elevated px-1.5 py-0.5 text-[10px]">{m.category}</span>
                  {m.domain && <span className="text-[11px] text-lavray-accent">{m.domain}</span>}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await window.lavray.deleteMemory(m.id);
                    void load();
                  }}
                  className="text-lavray-muted hover:text-lavray-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-lavray-muted">{m.content}</p>
              <div className="text-[10px] text-lavray-muted/80">
                Confidence {(m.confidence * 100).toFixed(0)}% • Used {m.useCount}x • Source: {m.source}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ModalShell>
  );
};

export const ExtractionView: React.FC = () => {
  const { setOverlayView, activeTabId, pushToast } = useLavrayStore();
  const [instructions, setInstructions] = useState('Extract item names, prices, and descriptions');
  const [schemaText, setSchemaText] = useState(
    JSON.stringify(
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: ['number', 'null'] },
          description: { type: ['string', 'null'] }
        },
        required: ['name']
      },
      null,
      2
    )
  );
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [running, setRunning] = useState(false);

  return (
    <ModalShell
      title="Structured Data Extraction"
      icon={<FileJson className="h-5 w-5" />}
      onClose={() => setOverlayView(null)}
    >
      <div className="mx-auto max-w-4xl space-y-4 text-xs">
        <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-3">
          <div>
            <label className="block font-semibold mb-1">Extraction Request</label>
            <input
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 outline-none"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Record JSON Schema</label>
            <textarea
              rows={8}
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              className="w-full rounded-lg border border-lavray-border bg-lavray-bg p-3 font-mono outline-none"
            />
          </div>
          <button
            type="button"
            disabled={running || !activeTabId}
            onClick={async () => {
              if (!activeTabId) return;
              setRunning(true);
              try {
                const res = await window.lavray.extractStructured(activeTabId, schemaText, instructions);
                setResult(res);
              } catch (err) {
                pushToast(err instanceof Error ? err.message : 'Extraction failed', 'danger');
              } finally {
                setRunning(false);
              }
            }}
            className="flex items-center gap-1.5 rounded-lg bg-lavray-accent px-4 py-2 font-semibold text-lavray-accent-fg disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> {running ? 'Extracting & Validating...' : 'Extract from Active Tab'}
          </button>
        </div>

        {result && (
          <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className={`font-bold ${result.valid ? 'text-lavray-success' : 'text-lavray-warning'}`}>
                  {result.valid ? 'Schema Validated' : 'Validation Issues'}
                </span>
                <span className="ml-2 text-lavray-muted">
                  ({result.records.length} records, {result.attempts} attempt(s))
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(JSON.stringify(result.records, null, 2));
                    pushToast('JSON copied to clipboard', 'success');
                  }}
                  className="rounded bg-lavray-elevated px-2.5 py-1 font-semibold"
                >
                  Copy JSON
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const csv = await window.lavray.exportCsv(result.records);
                    await navigator.clipboard.writeText(csv);
                    pushToast('CSV copied to clipboard', 'success');
                  }}
                  className="rounded bg-lavray-elevated px-2.5 py-1 font-semibold"
                >
                  Copy CSV
                </button>
              </div>
            </div>
            {result.validationErrors.length > 0 && (
              <div className="rounded-lg bg-lavray-danger/10 p-2 text-lavray-danger">
                {result.validationErrors.join('; ')}
              </div>
            )}
            <pre className="max-h-80 overflow-auto rounded-lg bg-lavray-bg p-3 font-mono text-[11px]">
              {JSON.stringify(result.records, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </ModalShell>
  );
};

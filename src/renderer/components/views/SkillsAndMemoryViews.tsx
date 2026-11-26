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
import { useAtlasStore } from '../../store/useAtlasStore';

const ModalShell: React.FC<{ title: string; icon: React.ReactNode; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  onClose,
  actions,
  children
}) => (
  <div className="flex h-full flex-col bg-atlas-bg text-atlas-text select-text">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-atlas-border bg-atlas-surface px-6">
      <div className="flex items-center gap-2.5">
        <span className="text-atlas-accent">{icon}</span>
        <h1 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-atlas-muted hover:bg-atlas-elevated">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
    <div className="flex-1 overflow-y-auto p-6">{children}</div>
  </div>
);

export const SkillsView: React.FC = () => {
  const { setOverlayView, activeTabId, pushToast } = useAtlasStore();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  const load = async () => {
    const list = await window.atlas.listSkills();
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
            className="flex items-center gap-1 rounded-lg border border-atlas-border bg-atlas-elevated px-3 py-1.5 text-xs font-semibold"
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
              const saved = await window.atlas.saveSkill(blank);
              setSelected(saved);
              void load();
            }}
            className="flex items-center gap-1 rounded-lg bg-atlas-accent px-3 py-1.5 text-xs font-semibold text-atlas-accent-fg"
          >
            <Plus className="h-3.5 w-3.5" /> New Skill
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-5xl space-y-4">
        {showImport && (
          <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-2">
            <textarea
              rows={4}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste exported Atlas Skill JSON..."
              className="w-full rounded-lg border border-atlas-border bg-atlas-bg p-2 text-xs font-mono outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                await window.atlas.importSkill(importText);
                setImportText('');
                setShowImport(false);
                pushToast('Skill imported', 'success');
                void load();
              }}
              className="rounded-lg bg-atlas-accent px-3 py-1.5 text-xs font-semibold text-atlas-accent-fg"
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
                      ? 'border-atlas-accent bg-atlas-surface'
                      : 'border-atlas-border bg-atlas-surface/60 hover:border-atlas-muted'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm">{s.name}</span>
                    <span className="rounded bg-atlas-elevated px-2 py-0.5 text-[10px]">v{s.version}</span>
                  </div>
                  <p className="text-atlas-muted line-clamp-2">{s.description}</p>
                  <div className="flex items-center justify-between pt-1 text-[11px] text-atlas-muted">
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
                          const exec = await window.atlas.runSkill(s.id, params, activeTabId);
                          pushToast(
                            exec.status === 'completed' ? `Skill "${s.name}" completed` : `Skill failed: ${exec.error}`,
                            exec.status === 'completed' ? 'success' : 'danger'
                          );
                          void load();
                        }}
                        className="flex items-center gap-1 rounded bg-atlas-accent px-2 py-1 text-[10px] font-semibold text-atlas-accent-fg"
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
                          const exec = await window.atlas.testSkill(s.id, params, activeTabId);
                          pushToast(
                            exec.status === 'completed' ? `Skill test passed` : `Skill test failed: ${exec.error}`,
                            exec.status === 'completed' ? 'success' : 'warning'
                          );
                          void load();
                        }}
                        className="rounded border border-atlas-border bg-atlas-elevated px-2 py-1 text-[10px] font-semibold"
                        title="Test skill with Assist confirmation"
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await window.atlas.duplicateSkill(s.id);
                          void load();
                        }}
                        className="rounded p-1 hover:bg-atlas-elevated"
                        title="Duplicate"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await window.atlas.deleteSkill(s.id);
                          if (selected?.id === s.id) setSelected(null);
                          void load();
                        }}
                        className="rounded p-1 hover:text-atlas-danger"
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
              <div className="rounded-xl border border-dashed border-atlas-border p-8 text-center text-xs text-atlas-muted">
                No skills saved yet. Complete an agent task and click "Save Skill" or create one above.
              </div>
            )}
          </div>

          {selected && (
            <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 text-xs space-y-3">
              <div className="flex items-center justify-between">
                <input
                  value={selected.name}
                  onChange={(e) => setSelected({ ...selected, name: e.target.value })}
                  className="flex-1 bg-transparent text-sm font-bold outline-none border-b border-transparent focus:border-atlas-accent"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const json = await window.atlas.exportSkill(selected.id);
                    await navigator.clipboard.writeText(json);
                    pushToast('Skill JSON copied to clipboard', 'success');
                  }}
                  className="flex items-center gap-1 rounded bg-atlas-elevated px-2 py-1 text-[11px]"
                >
                  <Download className="h-3 w-3" /> Export JSON
                </button>
              </div>
              <textarea
                rows={2}
                value={selected.description}
                onChange={(e) => setSelected({ ...selected, description: e.target.value })}
                className="w-full rounded-lg border border-atlas-border bg-atlas-bg p-2 outline-none"
              />
              <div>
                <div className="font-semibold mb-1 text-atlas-muted uppercase text-[10px]">
                  Workflow Steps ({selected.steps.length})
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {selected.steps.map((st) => (
                    <div key={st.index} className="rounded-lg border border-atlas-border bg-atlas-bg/60 p-2">
                      <div className="font-semibold">
                        {st.index + 1}. {st.toolName} — {st.description}
                      </div>
                      <div className="text-[11px] font-mono text-atlas-muted truncate">
                        {JSON.stringify(st.argsTemplate)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const updated = await window.atlas.saveSkill({
                    ...selected,
                    version: selected.version + 1,
                    updatedAt: Date.now()
                  });
                  setSelected(updated);
                  pushToast('Skill saved', 'success');
                  void load();
                }}
                className="rounded-lg bg-atlas-accent px-4 py-2 font-semibold text-atlas-accent-fg"
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
  const { setOverlayView, pushToast } = useAtlasStore();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MemoryCategory>('user_preference');
  const [domain, setDomain] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const load = async (q = query) => {
    const res = q.trim() ? await window.atlas.searchMemory(q) : await window.atlas.listMemory();
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
              const json = await window.atlas.exportMemory();
              await navigator.clipboard.writeText(json);
              pushToast('Memory exported to clipboard', 'success');
            }}
            className="rounded-lg border border-atlas-border bg-atlas-elevated px-3 py-1.5 text-xs font-semibold"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={async () => {
              await window.atlas.clearMemory();
              void load('');
            }}
            className="rounded-lg border border-atlas-danger/40 bg-atlas-danger/10 px-3 py-1.5 text-xs font-semibold text-atlas-danger"
          >
            Clear All
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center gap-2 rounded-xl border border-atlas-border bg-atlas-surface px-3 py-2">
          <Search className="h-4 w-4 text-atlas-muted" />
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
              await window.atlas.saveMemory({
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
          className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-2.5 text-xs"
        >
          <div className="font-semibold">Add Persistent Memory (Passwords/Tokens Automatically Blocked)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as MemoryCategory)}
              className="rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1.5"
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
              className="rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1.5"
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Memory title"
              className="rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1.5"
            />
          </div>
          <textarea
            rows={2}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Preference or reusable workflow detail..."
            className="w-full rounded-lg border border-atlas-border bg-atlas-bg p-2"
          />
          <button type="submit" className="rounded-lg bg-atlas-accent px-4 py-1.5 font-semibold text-atlas-accent-fg">
            Save Memory
          </button>
        </form>

        <div className="space-y-2">
          {items.map((m) => (
            <div key={m.id} className="rounded-xl border border-atlas-border bg-atlas-surface p-3.5 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold">{m.title}</span>
                  <span className="rounded bg-atlas-elevated px-1.5 py-0.5 text-[10px]">{m.category}</span>
                  {m.domain && <span className="text-[11px] text-atlas-accent">{m.domain}</span>}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await window.atlas.deleteMemory(m.id);
                    void load();
                  }}
                  className="text-atlas-muted hover:text-atlas-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-atlas-muted">{m.content}</p>
              <div className="text-[10px] text-atlas-muted/80">
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
  const { setOverlayView, activeTabId, pushToast } = useAtlasStore();
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
        <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-3">
          <div>
            <label className="block font-semibold mb-1">Extraction Request</label>
            <input
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="w-full rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2 outline-none"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Record JSON Schema</label>
            <textarea
              rows={8}
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              className="w-full rounded-lg border border-atlas-border bg-atlas-bg p-3 font-mono outline-none"
            />
          </div>
          <button
            type="button"
            disabled={running || !activeTabId}
            onClick={async () => {
              if (!activeTabId) return;
              setRunning(true);
              try {
                const res = await window.atlas.extractStructured(activeTabId, schemaText, instructions);
                setResult(res);
              } catch (err) {
                pushToast(err instanceof Error ? err.message : 'Extraction failed', 'danger');
              } finally {
                setRunning(false);
              }
            }}
            className="flex items-center gap-1.5 rounded-lg bg-atlas-accent px-4 py-2 font-semibold text-atlas-accent-fg disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> {running ? 'Extracting & Validating...' : 'Extract from Active Tab'}
          </button>
        </div>

        {result && (
          <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className={`font-bold ${result.valid ? 'text-atlas-success' : 'text-atlas-warning'}`}>
                  {result.valid ? 'Schema Validated' : 'Validation Issues'}
                </span>
                <span className="ml-2 text-atlas-muted">
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
                  className="rounded bg-atlas-elevated px-2.5 py-1 font-semibold"
                >
                  Copy JSON
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const csv = await window.atlas.exportCsv(result.records);
                    await navigator.clipboard.writeText(csv);
                    pushToast('CSV copied to clipboard', 'success');
                  }}
                  className="rounded bg-atlas-elevated px-2.5 py-1 font-semibold"
                >
                  Copy CSV
                </button>
              </div>
            </div>
            {result.validationErrors.length > 0 && (
              <div className="rounded-lg bg-atlas-danger/10 p-2 text-atlas-danger">
                {result.validationErrors.join('; ')}
              </div>
            )}
            <pre className="max-h-80 overflow-auto rounded-lg bg-atlas-bg p-3 font-mono text-[11px]">
              {JSON.stringify(result.records, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </ModalShell>
  );
};

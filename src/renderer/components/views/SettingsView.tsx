import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Compass,
  Cpu,
  Globe,
  Monitor,
  Moon,
  Palette,
  Settings as SettingsIcon,
  Shield,
  SlidersHorizontal,
  Sun,
  X,
  XCircle
} from 'lucide-react';
import type {
  AppSettings,
  CloudConnectionStatus,
  CloudConsentSettings,
  ProviderTestResult,
  SearchEngineId,
  SelfHostedRuntimeStatus,
  ThemeMode
} from '@shared/types';
import { useLavrayStore } from '../../store/useLavrayStore';

type SettingsSection =
  | 'appearance'
  | 'browser'
  | 'privacy'
  | 'adblock'
  | 'ai'
  | 'research'
  | 'advanced';

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: React.ReactNode }> = [
  { id: 'appearance', label: 'Appearance', icon: <Palette className="h-4 w-4" /> },
  { id: 'browser', label: 'Browser & Tabs', icon: <Compass className="h-4 w-4" /> },
  { id: 'privacy', label: 'Privacy & Security', icon: <Shield className="h-4 w-4" /> },
  { id: 'adblock', label: 'Ad Blocking', icon: <Globe className="h-4 w-4" /> },
  { id: 'ai', label: 'HAYA Agent', icon: <Cpu className="h-4 w-4" /> },
  { id: 'research', label: 'Search & Cloud', icon: <Cloud className="h-4 w-4" /> },
  { id: 'advanced', label: 'Advanced', icon: <SlidersHorizontal className="h-4 w-4" /> }
];

export const SettingsView: React.FC = () => {
  const { settings, setSettings, setVerticalTabs, setOverlayView, setProviderStatus, pushToast } =
    useLavrayStore();
  const [section, setSection] = useState<SettingsSection>('appearance');
  const [local, setLocal] = useState<AppSettings | null>(settings);
  const [selfHostedKeyInput, setSelfHostedKeyInput] = useState('');
  const [braveKeyInput, setBraveKeyInput] = useState('');
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<SelfHostedRuntimeStatus | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudConnectionStatus | null>(null);
  const [cloudEmail, setCloudEmail] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);

  useEffect(() => {
    void window.lavray.getSettings().then((s) => {
      setSettings(s);
      setLocal(s);
    });
    void window.lavray.getCloudStatus().then(setCloudStatus);
  }, []);

  if (!local) return null;

  const update = async (patch: Partial<AppSettings>) => {
    const updated = await window.lavray.updateSettings(patch);
    setSettings(updated);
    setLocal(updated);
    if (patch.verticalTabs !== undefined) {
      setVerticalTabs(updated.verticalTabs);
    }
    const st = await window.lavray.getProviderStatus();
    setProviderStatus(st);
    pushToast('Preferences saved', 'success');
  };

  return (
    <div className="flex h-full flex-col bg-lavray-bg text-lavray-text select-text">
      {/* Top Bar */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-lavray-border bg-lavray-surface px-6">
        <div className="flex items-center gap-2.5">
          <SettingsIcon className="h-4 w-4 text-lavray-accent" strokeWidth={1.75} />
          <h1 className="text-[14px] font-semibold tracking-[-0.01em]">Settings</h1>
        </div>
        <button
          type="button"
          onClick={() => setOverlayView(null)}
          className="rounded-lg p-1.5 text-lavray-muted hover:bg-lavray-shell hover:text-lavray-text transition-colors"
          aria-label="Close Settings"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Two-Pane Settings Layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left Navigation Rail */}
        <aside className="w-52 shrink-0 border-r border-lavray-border bg-lavray-shell/55 p-3 space-y-0.5 select-none">
          {SECTIONS.map((s) => {
            const active = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium transition-colors ${
                  active
                    ? 'bg-lavray-surface text-lavray-accent border border-lavray-border shadow-lavray-sm'
                    : 'text-lavray-secondary hover:bg-lavray-elevated/70 hover:text-lavray-text'
                }`}
              >
                <span className={active ? 'text-lavray-accent' : 'text-lavray-muted'}>{s.icon}</span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Right Detail Canvas */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-2xl space-y-6 text-[13px]">
            {section === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Appearance</h2>
                  <p className="mt-0.5 text-[12px] text-lavray-muted">
                    Choose how LAVRAY looks across browser chrome, workspace panels, dialogs, and reader view.
                  </p>
                </div>

                <div className="space-y-2.5">
                  <label className="block text-[12px] font-medium text-lavray-secondary">Theme</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(
                      [
                        {
                          id: 'light',
                          title: 'Light',
                          desc: 'Warm paper off-white',
                          icon: <Sun className="h-4 w-4" />,
                          split: false,
                          previewBg: 'bg-[#fafaf8]',
                          previewChrome: 'bg-[#f2f2ef] border-[#ddddd7]'
                        },
                        {
                          id: 'dark',
                          title: 'Dark',
                          desc: 'Deep slate obsidian',
                          icon: <Moon className="h-4 w-4" />,
                          split: false,
                          previewBg: 'bg-[#111214]',
                          previewChrome: 'bg-[#1c1e22] border-[#30333a]'
                        },
                        {
                          id: 'system',
                          title: 'System',
                          desc: 'Follow OS preference',
                          icon: <Monitor className="h-4 w-4" />,
                          split: true,
                          previewBg: '',
                          previewChrome: ''
                        }
                      ] as Array<{
                        id: ThemeMode;
                        title: string;
                        desc: string;
                        icon: React.ReactNode;
                        split: boolean;
                        previewBg: string;
                        previewChrome: string;
                      }>
                    ).map((opt) => {
                      const active = local.theme === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          data-theme-option={opt.id}
                          aria-pressed={active}
                          onClick={() => void update({ theme: opt.id })}
                          className={`group rounded-xl border p-3 text-left transition-all ${
                            active
                              ? 'border-lavray-accent bg-lavray-surface ring-2 ring-lavray-accent/15'
                              : 'border-lavray-border bg-lavray-surface hover:border-lavray-border-strong'
                          }`}
                        >
                          {opt.split ? (
                            <div className="mb-2.5 flex h-12 w-full overflow-hidden rounded-lg border border-lavray-border/80">
                              <div className="w-1/2 bg-[#fafaf8] p-1.5 pr-0.5">
                                <div className="h-2.5 w-full rounded-l-sm border-y border-l border-[#ddddd7] bg-[#f2f2ef]" />
                              </div>
                              <div className="w-1/2 bg-[#111214] p-1.5 pl-0.5">
                                <div className="h-2.5 w-full rounded-r-sm border-y border-r border-[#30333a] bg-[#1c1e22]" />
                              </div>
                            </div>
                          ) : (
                            <div
                              className={`mb-2.5 h-12 w-full rounded-lg border border-lavray-border/80 p-1.5 ${opt.previewBg}`}
                            >
                              <div className={`h-2.5 w-full rounded-sm border ${opt.previewChrome}`} />
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-[12.5px] text-lavray-text">{opt.title}</span>
                            <span className={active ? 'text-lavray-accent' : 'text-lavray-muted'}>
                              {opt.icon}
                            </span>
                          </div>
                          <div className="text-[11px] text-lavray-muted mt-0.5">{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-lavray-border pt-4 space-y-1">
                  <ToggleRow
                    label="Vertical tab strip on left sidebar"
                    description="Moves tabs into a collapsible vertical list and streamlines the top bar"
                    checked={local.verticalTabs}
                    onChange={(v) => void update({ verticalTabs: v })}
                  />
                </div>
              </div>
            )}

            {section === 'browser' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Browser & Tabs</h2>
                  <p className="mt-0.5 text-[12px] text-lavray-muted">
                    Configure default navigation, start page, and session continuity.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-medium text-lavray-secondary mb-1.5">
                      Default Web Search Engine
                    </label>
                    <select
                      value={local.searchEngine}
                      onChange={(e) => void update({ searchEngine: e.target.value as SearchEngineId })}
                      className="w-full rounded-lg border border-lavray-border bg-lavray-surface px-3 py-2 text-[12.5px] outline-none focus:border-lavray-accent"
                    >
                      <option value="lavray">LAVRAY Search (Built-in)</option>
                      <option value="duckduckgo">DuckDuckGo</option>
                      <option value="brave">Brave Search</option>
                      <option value="startpage">Startpage</option>
                      <option value="bing">Bing</option>
                      <option value="google">Google</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-lavray-secondary mb-1.5">
                      Home / Start Page URL
                    </label>
                    <input
                      defaultValue={local.homeUrl || 'lavray://newtab'}
                      onBlur={(e) => void update({ homeUrl: e.target.value.trim() || 'lavray://newtab' })}
                      placeholder="lavray://newtab"
                      className="w-full rounded-lg border border-lavray-border bg-lavray-surface px-3 py-2 text-[12.5px] outline-none focus:border-lavray-accent"
                    />
                  </div>
                </div>

                <div className="border-t border-lavray-border pt-4 space-y-1">
                  <ToggleRow
                    label="Restore previous session tabs on startup"
                    description="Non-private tabs and tab groups reopen where you left off"
                    checked={local.restoreSessionOnStart}
                    onChange={(v) => void update({ restoreSessionOnStart: v })}
                  />
                  <ToggleRow
                    label="Vertical tab layout"
                    checked={local.verticalTabs}
                    onChange={(v) => void update({ verticalTabs: v })}
                  />
                </div>
              </div>
            )}

            {section === 'privacy' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Privacy & Security</h2>
                  <p className="mt-0.5 text-[12px] text-lavray-muted">
                    Local-first data boundaries, telemetry controls, and domain permissions.
                  </p>
                </div>

                <div className="border-t border-lavray-border pt-3 space-y-1">
                  <ToggleRow
                    label="Retain agent step screenshots on disk"
                    description="Used for activity timeline replay; automatically pruned by retention window"
                    checked={local.retainScreenshots}
                    onChange={(v) => void update({ retainScreenshots: v })}
                  />
                  <ToggleRow
                    label="Share optional anonymous diagnostics"
                    description="Disabled by default; private tabs never record history or telemetry"
                    checked={local.telemetryEnabled}
                    onChange={(v) => void update({ telemetryEnabled: v })}
                  />
                  <ToggleRow
                    label="Experimental: Page-context scripting tool"
                    description="Allows agent page evaluation only after explicit sensitive confirmation"
                    checked={local.experimentalScriptingEnabled}
                    onChange={(v) => void update({ experimentalScriptingEnabled: v })}
                  />
                </div>

                <div className="border-t border-lavray-border pt-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-lavray-text">Domain Permission Rules & Audit Log</div>
                    <div className="text-[11.5px] text-lavray-muted">
                      Inspect allow/deny rules and security audit events
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOverlayView('audit')}
                    className="rounded-lg border border-lavray-border bg-lavray-surface px-3 py-1.5 text-[12px] font-medium hover:bg-lavray-shell transition-colors"
                  >
                    Open Privacy & Audit
                  </button>
                </div>
              </div>
            )}

            {section === 'adblock' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Ad & Tracker Blocking</h2>
                  <p className="mt-0.5 text-[12px] text-lavray-muted">
                    Native Chromium network request filtering and cosmetic element hiding.
                  </p>
                </div>

                <div className="border-t border-lavray-border pt-3 space-y-1">
                  <ToggleRow
                    label="Enable LAVRAY Shield globally"
                    description="Intercepts matching ad and tracking requests across normal and private tabs"
                    checked={local.adBlockEnabled}
                    onChange={(v) => void update({ adBlockEnabled: v })}
                  />
                </div>

                <div className="border-t border-lavray-border pt-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-lavray-text">Filter Lists & Broken-Site Reports</div>
                    <div className="text-[11.5px] text-lavray-muted">
                      Manage EasyList, EasyPrivacy, Malware lists, and custom rules
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOverlayView('audit')}
                    className="rounded-lg border border-lavray-border bg-lavray-surface px-3 py-1.5 text-[12px] font-medium hover:bg-lavray-shell transition-colors"
                  >
                    Manage Filter Lists
                  </button>
                </div>
              </div>
            )}

            {section === 'ai' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">HAYAGRIVA (HAYA) — AI Model &amp; Agent</h2>
                  <p className="mt-0.5 text-[12px] text-lavray-muted">
                    Configure the local or self-hosted OpenAI-compatible runtime powering HAYA (Ollama, vLLM, llama.cpp) and execution limits.
                  </p>
                </div>

                <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[12px] font-medium text-lavray-secondary mb-1.5">
                        Model ID
                      </label>
                      <input
                        key={local.selfHostedModel}
                        defaultValue={local.selfHostedModel || 'qwen2.5:3b'}
                        onBlur={(e) => {
                          const model = e.target.value.trim() || 'qwen2.5:3b';
                          void update({ selfHostedModel: model, defaultModel: model });
                        }}
                        placeholder="e.g. qwen2.5:3b"
                        className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[12.5px] outline-none focus:border-lavray-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-medium text-lavray-secondary mb-1.5">
                        Inference Server Base URL
                      </label>
                      <input
                        defaultValue={local.selfHostedEndpointUrl || 'http://127.0.0.1:11434/v1'}
                        onBlur={(e) => void update({ selfHostedEndpointUrl: e.target.value.trim() })}
                        placeholder="http://127.0.0.1:11434/v1"
                        className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[12.5px] outline-none focus:border-lavray-accent"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11.5px] text-lavray-muted mb-1">
                      Optional Server Bearer Key (Encrypted)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={selfHostedKeyInput}
                        onChange={(e) => setSelfHostedKeyInput(e.target.value)}
                        placeholder={local.hasSelfHostedApiKey ? 'Configured (enter to update)' : 'Leave blank for local Ollama'}
                        className="flex-1 rounded-lg border border-lavray-border bg-lavray-bg px-3 py-1.5 text-[12px] outline-none focus:border-lavray-accent"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!selfHostedKeyInput.trim()) return;
                          const next = await window.lavray.setApiKey('self_hosted', selfHostedKeyInput.trim());
                          setSettings(next);
                          setLocal(next);
                          setSelfHostedKeyInput('');
                          pushToast('Runtime key encrypted & saved', 'success');
                        }}
                        className="rounded-lg border border-lavray-border bg-lavray-shell px-3 py-1.5 text-[12px] font-medium hover:bg-lavray-elevated"
                      >
                        Save Key
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => setRuntimeStatus(await window.lavray.discoverSelfHostedModels())}
                      className="rounded-lg border border-lavray-border bg-lavray-shell px-3 py-1.5 text-[12px] font-medium hover:bg-lavray-elevated"
                    >
                      Discover Installed Models
                    </button>
                    <button
                      type="button"
                      disabled={testing}
                      onClick={async () => {
                        setTesting(true);
                        try {
                          setTestResult(await window.lavray.testProvider(local.selfHostedModel));
                        } finally {
                          setTesting(false);
                        }
                      }}
                      className="rounded-lg bg-lavray-accent px-3 py-1.5 text-[12px] font-medium text-lavray-accent-fg disabled:opacity-50"
                    >
                      {testing ? 'Checking...' : 'Verify Model'}
                    </button>
                  </div>

                  {runtimeStatus && (
                    <div
                      className={`rounded-lg border p-2.5 text-[11.5px] space-y-1.5 ${
                        runtimeStatus.reachable && runtimeStatus.modelAvailable
                          ? 'border-lavray-success/35 bg-lavray-success/10 text-lavray-success'
                          : 'border-lavray-warning/35 bg-lavray-warning/10 text-lavray-warning'
                      }`}
                    >
                      <div className="font-medium">{runtimeStatus.statusMessage}</div>
                      {runtimeStatus.availableModels.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {runtimeStatus.availableModels.map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => void update({ selfHostedModel: m, defaultModel: m })}
                              className="rounded-md bg-lavray-surface px-2 py-0.5 text-lavray-text border border-lavray-border hover:border-lavray-accent"
                            >
                              Use {m}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {testResult && (
                    <div
                      className={`flex items-start gap-2 rounded-lg border p-2.5 text-[11.5px] ${
                        testResult.ok
                          ? 'border-lavray-success/35 bg-lavray-success/10 text-lavray-success'
                          : 'border-lavray-danger/35 bg-lavray-danger/10 text-lavray-danger'
                      }`}
                    >
                      {testResult.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                        <div className="font-semibold">
                          {testResult.ok
                            ? `Connected (${testResult.model}, ${testResult.latencyMs}ms)`
                            : `Connection Failed`}
                        </div>
                        {testResult.ok ? (
                          <div>
                            Tools: {String(testResult.capabilities.tools)} · Structured Output:{' '}
                            {String(testResult.capabilities.structuredOutput)}
                          </div>
                        ) : (
                          <div>{testResult.error}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Budgets & Behavior */}
                <div className="border-t border-lavray-border pt-4 space-y-3">
                  <div className="text-[12px] font-medium text-lavray-secondary">Execution Budgets</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <NumField
                      label="Max Steps / Run"
                      value={local.budgets.maxStepsPerRun}
                      onChange={(n) => void update({ budgets: { ...local.budgets, maxStepsPerRun: n } })}
                    />
                    <NumField
                      label="Max Tokens / Run"
                      value={local.budgets.maxTokensPerRun}
                      onChange={(n) => void update({ budgets: { ...local.budgets, maxTokensPerRun: n } })}
                    />
                    <NumField
                      label="Max Cost ($)"
                      step="0.1"
                      value={local.budgets.maxCostPerRunUsd}
                      onChange={(n) => void update({ budgets: { ...local.budgets, maxCostPerRunUsd: n } })}
                    />
                    <NumField
                      label="Daily Budget ($)"
                      step="0.5"
                      value={local.budgets.dailyCostBudgetUsd}
                      onChange={(n) => void update({ budgets: { ...local.budgets, dailyCostBudgetUsd: n } })}
                    />
                  </div>
                  <div className="pt-2 space-y-1">
                    <ToggleRow
                      label="Proactive page & tab suggestions"
                      description="Opt-in contextual tips; never auto-executes browser actions"
                      checked={local.proactiveAssistanceEnabled}
                      onChange={(v) => void update({ proactiveAssistanceEnabled: v })}
                    />
                    <ToggleRow
                      label="Spoken voice replies (Web Speech)"
                      checked={local.voiceSpokenResponsesEnabled}
                      onChange={(v) => void update({ voiceSpokenResponsesEnabled: v })}
                    />
                  </div>
                </div>
              </div>
            )}

            {section === 'research' && (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Search & Cloud Sync</h2>
                    <p className="mt-0.5 text-[12px] text-lavray-muted">
                      Local-first search indexing with optional self-hosted backend synchronization.
                    </p>
                  </div>
                  {cloudStatus && (
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        cloudStatus.operatingMode === 'cloud_connected'
                          ? 'bg-lavray-success/12 text-lavray-success'
                          : cloudStatus.operatingMode === 'cloud_degraded'
                          ? 'bg-lavray-warning/12 text-lavray-warning'
                          : 'bg-lavray-shell text-lavray-muted'
                      }`}
                    >
                      {cloudStatus.operatingMode === 'cloud_connected'
                        ? 'Cloud Connected'
                        : cloudStatus.operatingMode === 'cloud_degraded'
                        ? 'Cloud Unreachable'
                        : 'Local Only'}
                    </span>
                  )}
                </div>

                <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-3">
                  <div className="text-[12.5px] font-semibold text-lavray-text">
                    LAVRAY Search Engine Settings
                  </div>
                  <ToggleRow
                    label="Auto-index visited pages into local LAVRAY Search"
                    description="Builds your private SQLite FTS5 + semantic web index as you browse (never indexes Private Windows)"
                    checked={local.autoIndexVisitedPages ?? true}
                    onChange={(v) => void update({ autoIndexVisitedPages: v })}
                  />
                  <div>
                    <label className="block text-[12px] font-medium text-lavray-secondary mb-1.5">
                      Optional Self-Hosted SearXNG JSON Endpoint
                    </label>
                    <input
                      defaultValue={local.searxngEndpointUrl || ''}
                      onBlur={(e) => void update({ searxngEndpointUrl: e.target.value.trim() })}
                      placeholder="e.g. http://127.0.0.1:8080"
                      className="w-full rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[12.5px] outline-none focus:border-lavray-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-lavray-secondary mb-1.5">
                      Optional Brave Search API Key{' '}
                      {local.hasBraveSearchApiKey && (
                        <span className="ml-1 text-lavray-success">(Saved in Encrypted Vault)</span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={braveKeyInput}
                        onChange={(e) => setBraveKeyInput(e.target.value)}
                        placeholder={local.hasBraveSearchApiKey ? '••••••••••••••••' : 'BSA...'}
                        className="flex-1 rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[12.5px] outline-none focus:border-lavray-accent"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!braveKeyInput.trim()) return;
                          const next = await window.lavray.setApiKey('brave_search', braveKeyInput.trim());
                          setLocal(next);
                          setSettings(next);
                          setBraveKeyInput('');
                          pushToast('Brave Search API key saved to encrypted vault', 'success');
                        }}
                        className="rounded-lg bg-lavray-accent px-3 py-2 text-[12px] font-medium text-lavray-accent-fg"
                      >
                        Save Key
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-lavray-secondary mb-1.5">
                      Optional Gemini API Key (Google Search Grounded AI Overview){' '}
                      {local.hasGeminiApiKey && (
                        <span className="ml-1 text-lavray-success">(Saved in Encrypted Vault)</span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={geminiKeyInput}
                        onChange={(e) => setGeminiKeyInput(e.target.value)}
                        placeholder={local.hasGeminiApiKey ? '••••••••••••••••' : 'AIza...'}
                        className="flex-1 rounded-lg border border-lavray-border bg-lavray-bg px-3 py-2 text-[12.5px] outline-none focus:border-lavray-accent"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!geminiKeyInput.trim()) return;
                          const next = await window.lavray.setApiKey('gemini', geminiKeyInput.trim());
                          setLocal(next);
                          setSettings(next);
                          setGeminiKeyInput('');
                          pushToast('Gemini API key saved to encrypted vault', 'success');
                        }}
                        className="rounded-lg bg-lavray-accent px-3 py-2 text-[12px] font-medium text-lavray-accent-fg"
                      >
                        Save Key
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                  <div>
                    <label className="block text-[12px] font-medium text-lavray-secondary mb-1.5">
                      LAVRAY Cloud API Endpoint
                    </label>
                    <input
                      defaultValue={local.cloudEndpointUrl || 'http://127.0.0.1:48080'}
                      onBlur={(e) =>
                        void update({ cloudEndpointUrl: e.target.value.trim() }).then(() =>
                          window.lavray.getCloudStatus().then(setCloudStatus)
                        )
                      }
                      className="w-full rounded-lg border border-lavray-border bg-lavray-surface px-3 py-2 text-[12.5px] outline-none"
                    />
                  </div>
                  <ToggleRow
                    label="Enable Cloud Sync"
                    checked={Boolean(local.cloudModeEnabled)}
                    onChange={(v) =>
                      void update({ cloudModeEnabled: v }).then(() =>
                        window.lavray.getCloudStatus().then(setCloudStatus)
                      )
                    }
                  />
                </div>

                {cloudStatus?.authenticated ? (
                  <div className="rounded-xl border border-lavray-border bg-lavray-surface p-4 space-y-3">
                    <div className="text-[12px] text-lavray-secondary">
                      Signed in{cloudStatus.userEmail ? ` as ${cloudStatus.userEmail}` : ''}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={cloudBusy}
                        onClick={async () => {
                          setCloudBusy(true);
                          try {
                            const r = await window.lavray.syncCloudNow();
                            pushToast(`Synced: ${JSON.stringify(r.synced)}`, 'success');
                          } catch (err) {
                            pushToast(err instanceof Error ? err.message : 'Sync failed', 'danger');
                          } finally {
                            setCloudBusy(false);
                          }
                        }}
                        className="rounded-lg bg-lavray-accent px-3 py-1.5 text-[12px] font-medium text-lavray-accent-fg"
                      >
                        Sync Approved Data
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const json = await window.lavray.exportCloudData();
                          await navigator.clipboard.writeText(json);
                          pushToast('Exported cloud data to clipboard', 'success');
                        }}
                        className="rounded-lg border border-lavray-border px-3 py-1.5 text-[12px]"
                      >
                        Export JSON
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setCloudStatus(await window.lavray.cloudLogout());
                          pushToast('Signed out', 'info');
                        }}
                        className="rounded-lg border border-lavray-border px-3 py-1.5 text-[12px]"
                      >
                        Sign Out
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setCloudStatus(await window.lavray.deleteCloudAccount());
                          pushToast('Cloud account deleted', 'warning');
                        }}
                        className="rounded-lg bg-lavray-danger/12 text-lavray-danger px-3 py-1.5 text-[12px] font-medium"
                      >
                        Delete Account
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 border-t border-lavray-border pt-4">
                    <input
                      type="email"
                      value={cloudEmail}
                      onChange={(e) => setCloudEmail(e.target.value)}
                      placeholder="Email..."
                      className="flex-1 min-w-[160px] rounded-lg border border-lavray-border bg-lavray-surface px-3 py-1.5 text-[12.5px] outline-none"
                    />
                    <input
                      type="password"
                      value={cloudPassword}
                      onChange={(e) => setCloudPassword(e.target.value)}
                      placeholder="Password (min 8 chars)..."
                      className="flex-1 min-w-[150px] rounded-lg border border-lavray-border bg-lavray-surface px-3 py-1.5 text-[12.5px] outline-none"
                    />
                    <button
                      type="button"
                      disabled={cloudBusy}
                      onClick={async () => {
                        setCloudBusy(true);
                        try {
                          setCloudStatus(await window.lavray.cloudLogin({ email: cloudEmail, password: cloudPassword }));
                          setCloudPassword('');
                          pushToast('Signed in', 'success');
                        } catch (err) {
                          pushToast(err instanceof Error ? err.message : 'Login failed', 'danger');
                        } finally {
                          setCloudBusy(false);
                        }
                      }}
                      className="rounded-lg bg-lavray-accent px-3 py-1.5 text-[12px] font-medium text-lavray-accent-fg"
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      disabled={cloudBusy}
                      onClick={async () => {
                        setCloudBusy(true);
                        try {
                          setCloudStatus(await window.lavray.cloudRegister({ email: cloudEmail, password: cloudPassword }));
                          setCloudPassword('');
                          pushToast('Registered account', 'success');
                        } catch (err) {
                          pushToast(err instanceof Error ? err.message : 'Register failed', 'danger');
                        } finally {
                          setCloudBusy(false);
                        }
                      }}
                      className="rounded-lg border border-lavray-border bg-lavray-surface px-3 py-1.5 text-[12px] font-medium"
                    >
                      Register
                    </button>
                  </div>
                )}

                {cloudStatus && (
                  <div className="border-t border-lavray-border pt-4 space-y-1">
                    <div className="mb-2 text-[11.5px] font-medium text-lavray-muted">
                      Sync Permissions (Private tabs are never uploaded)
                    </div>
                    {(
                      [
                        ['allowCloudSearch', 'Allow Cloud Search Queries'],
                        ['allowCloudAi', 'Allow Cloud AI Citation Synthesis'],
                        ['syncBookmarks', 'Sync Non-Private Bookmarks'],
                        ['syncNotes', 'Sync Cloud Notes'],
                        ['syncResearch', 'Sync Research Reports'],
                        ['syncMemory', 'Sync User-Approved Memory'],
                        ['syncSearchHistory', 'Sync Search History']
                      ] as Array<[keyof CloudConsentSettings, string]>
                    ).map(([key, label]) => (
                      <ToggleRow
                        key={key}
                        label={label}
                        checked={Boolean(cloudStatus.consent[key])}
                        onChange={(v) =>
                          void window.lavray.updateCloudConsent({ [key]: v }).then((st) => {
                            setCloudStatus(st);
                            pushToast('Consent updated', 'success');
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {section === 'advanced' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Advanced Tools & Workspaces</h2>
                  <p className="mt-0.5 text-[12px] text-lavray-muted">
                    Direct access to LAVRAY platform modules and automation diagnostics.
                  </p>
                </div>

                <div className="divide-y divide-lavray-border border-y border-lavray-border">
                  {[
                    { title: 'LAVRAY Search Index & Crawler', desc: 'Manage first-party FTS5/PostgreSQL index seeds', view: 'search' as const },
                    { title: 'Local MCP Server', desc: 'Configure localhost Bearer-authenticated MCP tools', view: 'mcp' as const },
                    { title: 'Observability & Token Costs', desc: 'Inspect run success rates, latency, and cost metrics', view: 'dashboard' as const },
                    { title: 'Scheduled Automations', desc: 'Create and pause recurring browser tasks', view: 'scheduler' as const },
                    { title: 'Skills & Local Memory', desc: 'Inspect recorded workflows and stored preferences', view: 'skills' as const }
                  ].map((item) => (
                    <div key={item.view} className="flex items-center justify-between py-3">
                      <div>
                        <div className="font-medium text-lavray-text">{item.title}</div>
                        <div className="text-[11.5px] text-lavray-muted">{item.desc}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOverlayView(item.view)}
                        className="rounded-lg border border-lavray-border bg-lavray-surface px-3 py-1.5 text-[12px] font-medium hover:bg-lavray-shell transition-colors"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ToggleRow: React.FC<{
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, description, checked, onChange }) => (
  <label className="flex items-start justify-between gap-4 rounded-lg py-2 px-1 cursor-pointer hover:bg-lavray-shell/50 transition-colors">
    <div className="min-w-0">
      <div className="text-[12.5px] font-medium text-lavray-text">{label}</div>
      {description && <div className="text-[11.5px] text-lavray-muted mt-0.5">{description}</div>}
    </div>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 rounded border-lavray-border accent-lavray-accent cursor-pointer"
    />
  </label>
);

const NumField: React.FC<{
  label: string;
  value: number;
  step?: string;
  onChange: (v: number) => void;
}> = ({ label, value, step = '1', onChange }) => (
  <div>
    <label className="block text-[11.5px] text-lavray-muted mb-1">{label}</label>
    <input
      type="number"
      step={step}
      defaultValue={value}
      onBlur={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-lg border border-lavray-border bg-lavray-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-lavray-accent"
    />
  </div>
);

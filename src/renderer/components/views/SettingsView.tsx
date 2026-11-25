import React, { useEffect, useState } from 'react';
import { Key, Settings as SettingsIcon, Shield, X } from 'lucide-react';
import type { AppSettings, SearchEngineId, ThemeMode } from '@shared/types';
import { useAtlasStore } from '../../store/useAtlasStore';

export const SettingsView: React.FC = () => {
  const { settings, setSettings, setOverlayView, pushToast } = useAtlasStore();
  const [local, setLocal] = useState<AppSettings | null>(settings);
  const [apiKeyInput, setApiKeyInput] = useState('');

  useEffect(() => {
    void window.atlas.getSettings().then((s) => {
      setSettings(s);
      setLocal(s);
    });
  }, []);

  if (!local) return null;

  const update = async (patch: Partial<AppSettings>) => {
    const updated = await window.atlas.updateSettings(patch);
    setSettings(updated);
    setLocal(updated);
    pushToast('Settings updated', 'success');
  };

  return (
    <div className="flex h-full flex-col bg-atlas-bg text-atlas-text select-text">
      <div className="flex items-center justify-between border-b border-atlas-border bg-atlas-surface px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <SettingsIcon className="h-5 w-5 text-atlas-accent" />
          <h1 className="text-base font-bold">Atlas Browser Settings</h1>
        </div>
        <button
          type="button"
          onClick={() => setOverlayView(null)}
          className="rounded-lg p-1.5 text-atlas-muted hover:bg-atlas-elevated"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6 text-xs">
          {/* AI Provider & Key */}
          <section className="rounded-xl border border-atlas-border bg-atlas-surface p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Key className="h-4 w-4 text-atlas-accent" />
              AI Provider & Encrypted Key Storage (Electron safeStorage)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-atlas-muted mb-1">Provider</label>
                <select
                  value={local.defaultProvider}
                  onChange={(e) =>
                    void update({ defaultProvider: e.target.value as AppSettings['defaultProvider'] })
                  }
                  className="w-full rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2"
                >
                  <option value="gemini">Google Gemini API (Default)</option>
                  <option value="mock">Deterministic Mock (Offline/Test)</option>
                </select>
              </div>
              <div>
                <label className="block text-atlas-muted mb-1">Default Model</label>
                <select
                  value={local.defaultModel}
                  onChange={(e) => void update({ defaultModel: e.target.value })}
                  className="w-full rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2"
                >
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                  <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                  <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span>
                  Gemini API Key Status:{' '}
                  <strong className={local.hasGeminiApiKey ? 'text-atlas-success' : 'text-atlas-warning'}>
                    {local.hasGeminiApiKey ? 'Configured (Encrypted via safeStorage)' : 'Not configured'}
                  </strong>
                </span>
                {local.hasGeminiApiKey && (
                  <button
                    type="button"
                    onClick={async () => {
                      const next = await window.atlas.clearApiKey();
                      setSettings(next);
                      setLocal(next);
                    }}
                    className="text-atlas-danger hover:underline"
                  >
                    Remove Key
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Enter Gemini API key (never saved to localStorage or plaintext config)..."
                  className="flex-1 rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2 outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!apiKeyInput.trim()) return;
                    const next = await window.atlas.setApiKey('gemini', apiKeyInput.trim());
                    setSettings(next);
                    setLocal(next);
                    setApiKeyInput('');
                    pushToast('Gemini API key encrypted and saved', 'success');
                  }}
                  className="rounded-lg bg-atlas-accent px-4 py-2 font-semibold text-white"
                >
                  Save Key
                </button>
              </div>
            </div>
          </section>

          {/* Appearance & Browsing */}
          <section className="rounded-xl border border-atlas-border bg-atlas-surface p-5 space-y-4">
            <h2 className="text-sm font-bold">Browser & Appearance</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-atlas-muted mb-1">Theme</label>
                <select
                  value={local.theme}
                  onChange={(e) => void update({ theme: e.target.value as ThemeMode })}
                  className="w-full rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </div>
              <div>
                <label className="block text-atlas-muted mb-1">Search Engine</label>
                <select
                  value={local.searchEngine}
                  onChange={(e) => void update({ searchEngine: e.target.value as SearchEngineId })}
                  className="w-full rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2"
                >
                  <option value="google">Google</option>
                  <option value="duckduckgo">DuckDuckGo</option>
                  <option value="bing">Bing</option>
                  <option value="brave">Brave Search</option>
                  <option value="startpage">Startpage</option>
                </select>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <ToggleRow
                label="Vertical Tab Strip"
                checked={local.verticalTabs}
                onChange={(v) => void update({ verticalTabs: v })}
              />
              <ToggleRow
                label="Ad & Tracker Blocker (webRequest)"
                checked={local.adBlockEnabled}
                onChange={(v) => void update({ adBlockEnabled: v })}
              />
              <ToggleRow
                label="Restore Previous Session Tabs on Launch"
                checked={local.restoreSessionOnStart}
                onChange={(v) => void update({ restoreSessionOnStart: v })}
              />
              <ToggleRow
                label="Retain Agent Step Screenshots on Disk"
                checked={local.retainScreenshots}
                onChange={(v) => void update({ retainScreenshots: v })}
              />
            </div>
          </section>

          {/* Budgets & Security */}
          <section className="rounded-xl border border-atlas-border bg-atlas-surface p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Shield className="h-4 w-4 text-atlas-accent" />
              Budgets & Security Controls
            </div>
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
                label="Max Cost / Run ($)"
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
            <ToggleRow
              label="Experimental: Enable page-context scripting tool (requires sensitive confirmation)"
              checked={local.experimentalScriptingEnabled}
              onChange={(v) => void update({ experimentalScriptingEnabled: v })}
            />
          </section>
        </div>
      </div>
    </div>
  );
};

const ToggleRow: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({
  label,
  checked,
  onChange
}) => (
  <label className="flex items-center justify-between rounded-lg bg-atlas-bg/60 px-3 py-2 cursor-pointer">
    <span>{label}</span>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
  </label>
);

const NumField: React.FC<{ label: string; value: number; step?: string; onChange: (v: number) => void }> = ({
  label,
  value,
  step = '1',
  onChange
}) => (
  <div>
    <label className="block text-atlas-muted mb-1">{label}</label>
    <input
      type="number"
      step={step}
      defaultValue={value}
      onBlur={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1.5"
    />
  </div>
);

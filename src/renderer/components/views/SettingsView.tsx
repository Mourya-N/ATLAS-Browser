import React, { useEffect, useState } from 'react';
import { CheckCircle2, Cloud, Key, Settings as SettingsIcon, Shield, X, XCircle } from 'lucide-react';
import type {
  AppSettings,
  CloudConnectionStatus,
  CloudConsentSettings,
  ProviderTestResult,
  SearchEngineId,
  ThemeMode
} from '@shared/types';
import { useAtlasStore } from '../../store/useAtlasStore';

export const SettingsView: React.FC = () => {
  const { settings, setSettings, setOverlayView, setProviderStatus, pushToast } = useAtlasStore();
  const [local, setLocal] = useState<AppSettings | null>(settings);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudConnectionStatus | null>(null);
  const [cloudEmail, setCloudEmail] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);

  useEffect(() => {
    void window.atlas.getSettings().then((s) => {
      setSettings(s);
      setLocal(s);
    });
    void window.atlas.getCloudStatus().then(setCloudStatus);
  }, []);

  if (!local) return null;

  const update = async (patch: Partial<AppSettings>) => {
    const updated = await window.atlas.updateSettings(patch);
    setSettings(updated);
    setLocal(updated);
    const st = await window.atlas.getProviderStatus();
    setProviderStatus(st);
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
                    setProviderStatus(await window.atlas.getProviderStatus());
                    pushToast('Gemini API key encrypted and saved', 'success');
                  }}
                  className="rounded-lg bg-atlas-accent px-4 py-2 font-semibold text-white"
                >
                  Save Key
                </button>
                <button
                  type="button"
                  disabled={testing}
                  onClick={async () => {
                    setTesting(true);
                    try {
                      const res = await window.atlas.testProvider(local.defaultModel);
                      setTestResult(res);
                    } finally {
                      setTesting(false);
                    }
                  }}
                  className="rounded-lg border border-atlas-border bg-atlas-elevated px-3 py-2 font-semibold hover:bg-atlas-border disabled:opacity-50"
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
              </div>
              {testResult && (
                <div
                  className={`flex items-start gap-2 rounded-lg border p-2.5 text-[11px] ${
                    testResult.ok
                      ? 'border-atlas-success/40 bg-atlas-success/10 text-atlas-success'
                      : 'border-atlas-danger/40 bg-atlas-danger/10 text-atlas-danger'
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="font-semibold">
                      {testResult.ok
                        ? `Connected (${testResult.provider} / ${testResult.model}, ${testResult.latencyMs}ms)`
                        : `Connection Failed (${testResult.provider})`}
                    </div>
                    {testResult.ok ? (
                      <div>
                        Capabilities: Tools={String(testResult.capabilities.tools)} • Structured Output=
                        {String(testResult.capabilities.structuredOutput)} • Vision=
                        {String(testResult.capabilities.vision)}
                      </div>
                    ) : (
                      <div>{testResult.error}</div>
                    )}
                  </div>
                </div>
              )}
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
              <ToggleRow
                label="Proactive Assistance (Opt-in page & tab suggestions; never auto-executes)"
                checked={local.proactiveAssistanceEnabled}
                onChange={(v) => void update({ proactiveAssistanceEnabled: v })}
              />
              <ToggleRow
                label="Spoken Voice Responses (Web Speech Synthesis)"
                checked={local.voiceSpokenResponsesEnabled}
                onChange={(v) => void update({ voiceSpokenResponsesEnabled: v })}
              />
              <ToggleRow
                label="Telemetry (Disabled by default)"
                checked={local.telemetryEnabled}
                onChange={(v) => void update({ telemetryEnabled: v })}
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

          {/* Atlas Cloud & Granular Consent */}
          <section className="rounded-xl border border-atlas-border bg-atlas-surface p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Cloud className="h-4 w-4 text-atlas-accent" />
                Atlas Cloud & Consent Controls (Optional — Local-First by Default)
              </div>
              {cloudStatus && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                    cloudStatus.operatingMode === 'cloud_connected'
                      ? 'bg-atlas-success/15 text-atlas-success'
                      : cloudStatus.operatingMode === 'cloud_degraded'
                      ? 'bg-atlas-warning/15 text-atlas-warning'
                      : 'bg-atlas-elevated text-atlas-muted'
                  }`}
                >
                  {cloudStatus.operatingMode === 'cloud_connected'
                    ? 'Cloud Connected'
                    : cloudStatus.operatingMode === 'cloud_degraded'
                    ? 'Cloud Unreachable (Local Fallback)'
                    : 'Local-Only Mode'}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-atlas-muted mb-1">Cloud API Endpoint</label>
                <input
                  defaultValue={local.cloudEndpointUrl || 'http://127.0.0.1:48080'}
                  onBlur={(e) => {
                    void update({ cloudEndpointUrl: e.target.value.trim() }).then(() =>
                      window.atlas.getCloudStatus().then(setCloudStatus)
                    );
                  }}
                  className="w-full rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2 outline-none"
                />
              </div>
              <div className="flex items-end">
                <ToggleRow
                  label="Enable Atlas Cloud Connectivity"
                  checked={Boolean(local.cloudModeEnabled)}
                  onChange={(v) => {
                    void update({ cloudModeEnabled: v }).then(() =>
                      window.atlas.getCloudStatus().then(setCloudStatus)
                    );
                  }}
                />
              </div>
            </div>

            {cloudStatus?.authenticated ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-atlas-border bg-atlas-bg/60 p-3">
                <div>
                  Signed in{cloudStatus.userEmail ? ` as ${cloudStatus.userEmail}` : ''} (Encrypted tokens stored in SecretVault)
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={cloudBusy}
                    onClick={async () => {
                      setCloudBusy(true);
                      try {
                        const r = await window.atlas.syncCloudNow();
                        pushToast(`Cloud sync complete: ${JSON.stringify(r.synced)}`, 'success');
                      } catch (err) {
                        pushToast(err instanceof Error ? err.message : 'Sync failed', 'danger');
                      } finally {
                        setCloudBusy(false);
                      }
                    }}
                    className="rounded-lg bg-atlas-accent px-3 py-1.5 font-semibold text-white"
                  >
                    Sync Approved Data
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const json = await window.atlas.exportCloudData();
                      await navigator.clipboard.writeText(json);
                      pushToast('Cloud account data exported to clipboard', 'success');
                    }}
                    className="rounded-lg border border-atlas-border px-3 py-1.5"
                  >
                    Export Cloud Data
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setCloudStatus(await window.atlas.cloudLogout());
                      pushToast('Signed out of Atlas Cloud', 'info');
                    }}
                    className="rounded-lg border border-atlas-border px-3 py-1.5"
                  >
                    Sign Out
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setCloudStatus(await window.atlas.deleteCloudAccount());
                      pushToast('Cloud account and synced data deleted', 'warning');
                    }}
                    className="rounded-lg bg-atlas-danger/15 text-atlas-danger px-3 py-1.5 font-semibold"
                  >
                    Delete Cloud Account
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  value={cloudEmail}
                  onChange={(e) => setCloudEmail(e.target.value)}
                  placeholder="Account email..."
                  className="flex-1 min-w-[180px] rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2 outline-none"
                />
                <input
                  type="password"
                  value={cloudPassword}
                  onChange={(e) => setCloudPassword(e.target.value)}
                  placeholder="Password (min 8 chars)..."
                  className="flex-1 min-w-[160px] rounded-lg border border-atlas-border bg-atlas-bg px-3 py-2 outline-none"
                />
                <button
                  type="button"
                  disabled={cloudBusy}
                  onClick={async () => {
                    setCloudBusy(true);
                    try {
                      setCloudStatus(await window.atlas.cloudLogin({ email: cloudEmail, password: cloudPassword }));
                      setCloudPassword('');
                      pushToast('Signed in to Atlas Cloud', 'success');
                    } catch (err) {
                      pushToast(err instanceof Error ? err.message : 'Login failed', 'danger');
                    } finally {
                      setCloudBusy(false);
                    }
                  }}
                  className="rounded-lg bg-atlas-accent px-3 py-2 font-semibold text-white"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  disabled={cloudBusy}
                  onClick={async () => {
                    setCloudBusy(true);
                    try {
                      setCloudStatus(await window.atlas.cloudRegister({ email: cloudEmail, password: cloudPassword }));
                      setCloudPassword('');
                      pushToast('Registered Atlas Cloud account', 'success');
                    } catch (err) {
                      pushToast(err instanceof Error ? err.message : 'Register failed', 'danger');
                    } finally {
                      setCloudBusy(false);
                    }
                  }}
                  className="rounded-lg border border-atlas-border bg-atlas-elevated px-3 py-2 font-semibold"
                >
                  Register
                </button>
              </div>
            )}

            {cloudStatus && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[11px] font-semibold text-atlas-muted">
                  Explicit Per-Category Consent (Private tabs are NEVER uploaded)
                </div>
                {(
                  [
                    ['allowCloudSearch', 'Allow Cloud Search Queries (Atlas Search)'],
                    ['allowCloudAi', 'Allow Cloud AI Answer & Citation Synthesis'],
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
                    onChange={(v) => {
                      void window.atlas.updateCloudConsent({ [key]: v }).then((st) => {
                        setCloudStatus(st);
                        pushToast('Cloud consent updated', 'success');
                      });
                    }}
                  />
                ))}
              </div>
            )}
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

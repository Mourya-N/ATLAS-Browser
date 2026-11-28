import React, { useEffect, useState } from 'react';
import { RefreshCw, Shield, ShieldOff, Flag, Plus, Trash2 } from 'lucide-react';
import type { TabInfo } from '@shared/types';
import { useLavrayStore } from '../store/useLavrayStore';

interface Props {
  activeTab: TabInfo | null;
  currentDomain: string;
  onClose: () => void;
}

export const AdBlockerPopover: React.FC<Props> = ({ activeTab, currentDomain, onClose }) => {
  const { adBlockStats, setAdBlockStats, pushToast } = useLavrayStore();
  const [updatingLists, setUpdatingLists] = useState(false);
  const [newRule, setNewRule] = useState('');
  const [rulesChanged, setRulesChanged] = useState(false);
  const [trustReport, setTrustReport] = useState<{
    level: 'trusted' | 'caution' | 'warning';
    signals: Array<{ id: string; severity: string; title: string; detail: string }>;
  } | null>(null);

  useEffect(() => {
    void window.lavray.getAdBlockStats().then(setAdBlockStats);
    if (activeTab?.id) {
      void window.lavray.analyzePageTrust(activeTab.id).then(setTrustReport).catch(() => {});
    }
  }, [setAdBlockStats, activeTab?.id, activeTab?.url]);

  if (!adBlockStats) return null;

  const isAllowlisted = Boolean(
    currentDomain && adBlockStats.allowlistedDomains.includes(currentDomain.toLowerCase())
  );
  const isTempDisabled = Boolean(
    currentDomain && adBlockStats.temporaryDisabledDomains?.includes(currentDomain.toLowerCase())
  );
  const isCosmeticDisabled = Boolean(
    currentDomain && adBlockStats.cosmeticDisabledDomains?.includes(currentDomain.toLowerCase())
  );

  const siteProtected = adBlockStats.globalEnabled && !isAllowlisted && !isTempDisabled;

  return (
    <div
      data-testid="adblock-popover"
      className="lavray-glass absolute right-0 top-9 z-50 w-80 rounded-xl border border-lavray-border p-3.5 shadow-lavray-float text-xs space-y-3"
    >
      {/* Header + Global Toggle */}
      <div className="flex items-center justify-between border-b border-lavray-border pb-2.5">
        <div className="flex items-center gap-2">
          {siteProtected ? (
            <Shield className="h-4 w-4 text-lavray-success" />
          ) : (
            <ShieldOff className="h-4 w-4 text-lavray-warning" />
          )}
          <div>
            <div className="font-bold text-lavray-text">LAVRAY Shield</div>
            <div className="text-[11px] text-lavray-muted">
              {!adBlockStats.globalEnabled
                ? 'Disabled globally'
                : isAllowlisted
                ? `Allowlisted on ${currentDomain}`
                : isTempDisabled
                ? `Paused on ${currentDomain}`
                : currentDomain
                ? `Protecting ${currentDomain}`
                : 'Active across all tabs'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={async () => {
            const next = await window.lavray.toggleAdBlockGlobal(!adBlockStats.globalEnabled);
            setAdBlockStats(next);
            setRulesChanged(true);
          }}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
            adBlockStats.globalEnabled
              ? 'bg-lavray-success/15 text-lavray-success'
              : 'bg-lavray-elevated text-lavray-muted'
          }`}
        >
          {adBlockStats.globalEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-lavray-border bg-lavray-bg p-2">
          <div className="text-sm font-bold text-lavray-accent">{adBlockStats.adsBlocked ?? 0}</div>
          <div className="text-[10px] text-lavray-muted">Ads Blocked</div>
        </div>
        <div className="rounded-lg border border-lavray-border bg-lavray-bg p-2">
          <div className="text-sm font-bold text-lavray-accent">{adBlockStats.trackersBlocked ?? 0}</div>
          <div className="text-[10px] text-lavray-muted">Trackers Blocked</div>
        </div>
        <div className="rounded-lg border border-lavray-border bg-lavray-bg p-2">
          <div className="text-sm font-bold text-lavray-text">{activeTab?.blockedCount ?? 0}</div>
          <div className="text-[10px] text-lavray-muted">This Tab</div>
        </div>
      </div>

      {/* Per-Site Controls */}
      {currentDomain && (
        <div className="space-y-1.5 rounded-lg border border-lavray-border bg-lavray-bg p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-lavray-text">Allow ads on {currentDomain}</span>
            <input
              type="checkbox"
              checked={isAllowlisted}
              onChange={async (e) => {
                const next = await window.lavray.toggleAdBlockDomain(currentDomain, e.target.checked);
                setAdBlockStats(next);
                setRulesChanged(true);
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-lavray-muted">Pause for this session</span>
            <input
              type="checkbox"
              checked={isTempDisabled}
              onChange={async (e) => {
                const next = await window.lavray.toggleAdBlockTempDomain(currentDomain, e.target.checked);
                setAdBlockStats(next);
                setRulesChanged(true);
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-lavray-muted">Cosmetic element hiding</span>
            <input
              type="checkbox"
              checked={Boolean(adBlockStats.cosmeticEnabled && !isCosmeticDisabled)}
              onChange={async (e) => {
                const next = await window.lavray.toggleAdBlockCosmeticDomain(currentDomain, !e.target.checked);
                setAdBlockStats(next);
                setRulesChanged(true);
              }}
            />
          </div>
        </div>
      )}

      {/* Refresh Page Prompt */}
      {rulesChanged && activeTab && (
        <button
          type="button"
          onClick={() => {
            void window.lavray.reload(activeTab.id);
            setRulesChanged(false);
            onClose();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-lavray-accent px-3 py-1.5 font-medium text-lavray-accent-fg"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh page to apply rule changes
        </button>
      )}

      {/* Filter Lists */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-lavray-muted uppercase text-[10px]">
            Filter Lists ({adBlockStats.ruleCount} net / {adBlockStats.cosmeticRuleCount ?? 0} cosmetic)
          </span>
          <button
            type="button"
            disabled={updatingLists}
            onClick={async () => {
              setUpdatingLists(true);
              try {
                const next = await window.lavray.updateAdBlockFilterLists();
                setAdBlockStats(next);
                pushToast('Filter lists updated', 'success');
              } catch {
                pushToast('Filter list update failed; previous rules preserved', 'danger');
              } finally {
                setUpdatingLists(false);
              }
            }}
            className="flex items-center gap-1 rounded bg-lavray-elevated px-2 py-0.5 text-[10px] font-semibold hover:bg-lavray-accent/20"
          >
            <RefreshCw className={`h-3 w-3 ${updatingLists ? 'animate-spin' : ''}`} />
            {updatingLists ? 'Updating...' : 'Update Lists'}
          </button>
        </div>

        <div className="max-h-28 overflow-y-auto space-y-1">
          {(adBlockStats.filterLists ?? []).map((list) => (
            <div key={list.id} className="flex items-center justify-between rounded bg-lavray-bg px-2 py-1">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-lavray-text">{list.name}</div>
                <div className="truncate text-[10px] text-lavray-muted">
                  {list.ruleCount} rules • {list.lastUpdatedAt ? new Date(list.lastUpdatedAt).toLocaleDateString() : 'Built-in baseline'}
                  {list.lastError ? ` • Err: ${list.lastError}` : ''}
                </div>
              </div>
              <input
                type="checkbox"
                checked={list.enabled}
                onChange={async (e) => {
                  const next = await window.lavray.toggleAdBlockFilterList(list.id, e.target.checked);
                  setAdBlockStats(next);
                  setRulesChanged(true);
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Custom Rule Input */}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newRule.trim()) return;
          const res = await window.lavray.addAdBlockRule(newRule.trim());
          setAdBlockStats(res.stats);
          if (res.added) {
            setNewRule('');
            setRulesChanged(true);
          } else {
            pushToast('Invalid filter rule syntax', 'danger');
          }
        }}
        className="flex gap-1.5"
      >
        <input
          value={newRule}
          onChange={(e) => setNewRule(e.target.value)}
          placeholder="Add rule (e.g. ||ads.example.com^)"
          className="flex-1 rounded-lg border border-lavray-border bg-lavray-bg px-2 py-1 text-[11px] outline-none"
        />
        <button
          type="submit"
          title="Add custom rule"
          className="rounded-lg bg-lavray-elevated px-2 py-1 text-lavray-text hover:bg-lavray-accent hover:text-lavray-accent-fg transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>

      {(adBlockStats.customRules?.length ?? 0) > 0 && (
        <div className="max-h-20 overflow-y-auto space-y-1">
          {adBlockStats.customRules!.map((rule) => (
            <div key={rule} className="flex items-center justify-between rounded bg-lavray-bg px-2 py-0.5 text-[10px]">
              <span className="truncate font-mono">{rule}</span>
              <button
                type="button"
                onClick={async () => {
                  const next = await window.lavray.removeAdBlockRule(rule);
                  setAdBlockStats(next);
                  setRulesChanged(true);
                }}
                className="text-lavray-muted hover:text-lavray-danger"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Deterministic Page Trust Signals */}
      {trustReport && (
        <div className="rounded-lg border border-lavray-border bg-lavray-bg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[10px] uppercase text-lavray-muted">Page Trust (Deterministic)</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                trustReport.level === 'warning'
                  ? 'bg-lavray-danger/15 text-lavray-danger'
                  : trustReport.level === 'caution'
                  ? 'bg-lavray-warning/15 text-lavray-warning'
                  : 'bg-lavray-success/15 text-lavray-success'
              }`}
            >
              {trustReport.level}
            </span>
          </div>
          {trustReport.signals.slice(0, 3).map((s) => (
            <div key={s.id} className="text-[11px]">
              <span className="font-medium text-lavray-text">{s.title}:</span>{' '}
              <span className="text-lavray-muted">{s.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-between border-t border-lavray-border pt-2 text-[11px]">
        {activeTab && activeTab.url.startsWith('http') ? (
          <button
            type="button"
            onClick={async () => {
              const next = await window.lavray.reportAdBlockBrokenSite(activeTab.url);
              setAdBlockStats(next);
              pushToast('Broken page report recorded locally', 'success');
            }}
            className="flex items-center gap-1 text-lavray-muted hover:text-lavray-warning"
          >
            <Flag className="h-3 w-3" /> Report broken page
          </button>
        ) : (
          <span className="text-lavray-muted">Network + Cosmetic</span>
        )}
        <button type="button" onClick={onClose} className="text-lavray-muted hover:text-lavray-text">
          Close
        </button>
      </div>
    </div>
  );
};

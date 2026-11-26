import React, { useEffect, useState } from 'react';
import { RefreshCw, Shield, ShieldOff, Flag, Plus, Trash2 } from 'lucide-react';
import type { TabInfo } from '@shared/types';
import { useAtlasStore } from '../store/useAtlasStore';

interface Props {
  activeTab: TabInfo | null;
  currentDomain: string;
  onClose: () => void;
}

export const AdBlockerPopover: React.FC<Props> = ({ activeTab, currentDomain, onClose }) => {
  const { adBlockStats, setAdBlockStats, pushToast } = useAtlasStore();
  const [updatingLists, setUpdatingLists] = useState(false);
  const [newRule, setNewRule] = useState('');
  const [rulesChanged, setRulesChanged] = useState(false);
  const [trustReport, setTrustReport] = useState<{
    level: 'trusted' | 'caution' | 'warning';
    signals: Array<{ id: string; severity: string; title: string; detail: string }>;
  } | null>(null);

  useEffect(() => {
    void window.atlas.getAdBlockStats().then(setAdBlockStats);
    if (activeTab?.id) {
      void window.atlas.analyzePageTrust(activeTab.id).then(setTrustReport).catch(() => {});
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
      className="atlas-glass absolute right-0 top-9 z-50 w-80 rounded-xl border border-atlas-border p-3.5 shadow-atlas-float text-xs space-y-3"
    >
      {/* Header + Global Toggle */}
      <div className="flex items-center justify-between border-b border-atlas-border pb-2.5">
        <div className="flex items-center gap-2">
          {siteProtected ? (
            <Shield className="h-4 w-4 text-atlas-success" />
          ) : (
            <ShieldOff className="h-4 w-4 text-atlas-warning" />
          )}
          <div>
            <div className="font-bold text-atlas-text">Atlas Shield</div>
            <div className="text-[11px] text-atlas-muted">
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
            const next = await window.atlas.toggleAdBlockGlobal(!adBlockStats.globalEnabled);
            setAdBlockStats(next);
            setRulesChanged(true);
          }}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
            adBlockStats.globalEnabled
              ? 'bg-atlas-success/15 text-atlas-success'
              : 'bg-atlas-elevated text-atlas-muted'
          }`}
        >
          {adBlockStats.globalEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-atlas-border bg-atlas-bg p-2">
          <div className="text-sm font-bold text-atlas-accent">{adBlockStats.adsBlocked ?? 0}</div>
          <div className="text-[10px] text-atlas-muted">Ads Blocked</div>
        </div>
        <div className="rounded-lg border border-atlas-border bg-atlas-bg p-2">
          <div className="text-sm font-bold text-atlas-accent">{adBlockStats.trackersBlocked ?? 0}</div>
          <div className="text-[10px] text-atlas-muted">Trackers Blocked</div>
        </div>
        <div className="rounded-lg border border-atlas-border bg-atlas-bg p-2">
          <div className="text-sm font-bold text-atlas-text">{activeTab?.blockedCount ?? 0}</div>
          <div className="text-[10px] text-atlas-muted">This Tab</div>
        </div>
      </div>

      {/* Per-Site Controls */}
      {currentDomain && (
        <div className="space-y-1.5 rounded-lg border border-atlas-border bg-atlas-bg p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-atlas-text">Allow ads on {currentDomain}</span>
            <input
              type="checkbox"
              checked={isAllowlisted}
              onChange={async (e) => {
                const next = await window.atlas.toggleAdBlockDomain(currentDomain, e.target.checked);
                setAdBlockStats(next);
                setRulesChanged(true);
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-atlas-muted">Pause for this session</span>
            <input
              type="checkbox"
              checked={isTempDisabled}
              onChange={async (e) => {
                const next = await window.atlas.toggleAdBlockTempDomain(currentDomain, e.target.checked);
                setAdBlockStats(next);
                setRulesChanged(true);
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-atlas-muted">Cosmetic element hiding</span>
            <input
              type="checkbox"
              checked={Boolean(adBlockStats.cosmeticEnabled && !isCosmeticDisabled)}
              onChange={async (e) => {
                const next = await window.atlas.toggleAdBlockCosmeticDomain(currentDomain, !e.target.checked);
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
            void window.atlas.reload(activeTab.id);
            setRulesChanged(false);
            onClose();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-atlas-accent px-3 py-1.5 font-medium text-atlas-accent-fg"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh page to apply rule changes
        </button>
      )}

      {/* Filter Lists */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-atlas-muted uppercase text-[10px]">
            Filter Lists ({adBlockStats.ruleCount} net / {adBlockStats.cosmeticRuleCount ?? 0} cosmetic)
          </span>
          <button
            type="button"
            disabled={updatingLists}
            onClick={async () => {
              setUpdatingLists(true);
              try {
                const next = await window.atlas.updateAdBlockFilterLists();
                setAdBlockStats(next);
                pushToast('Filter lists updated', 'success');
              } catch {
                pushToast('Filter list update failed; previous rules preserved', 'danger');
              } finally {
                setUpdatingLists(false);
              }
            }}
            className="flex items-center gap-1 rounded bg-atlas-elevated px-2 py-0.5 text-[10px] font-semibold hover:bg-atlas-accent/20"
          >
            <RefreshCw className={`h-3 w-3 ${updatingLists ? 'animate-spin' : ''}`} />
            {updatingLists ? 'Updating...' : 'Update Lists'}
          </button>
        </div>

        <div className="max-h-28 overflow-y-auto space-y-1">
          {(adBlockStats.filterLists ?? []).map((list) => (
            <div key={list.id} className="flex items-center justify-between rounded bg-atlas-bg px-2 py-1">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-atlas-text">{list.name}</div>
                <div className="truncate text-[10px] text-atlas-muted">
                  {list.ruleCount} rules • {list.lastUpdatedAt ? new Date(list.lastUpdatedAt).toLocaleDateString() : 'Built-in baseline'}
                  {list.lastError ? ` • Err: ${list.lastError}` : ''}
                </div>
              </div>
              <input
                type="checkbox"
                checked={list.enabled}
                onChange={async (e) => {
                  const next = await window.atlas.toggleAdBlockFilterList(list.id, e.target.checked);
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
          const res = await window.atlas.addAdBlockRule(newRule.trim());
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
          className="flex-1 rounded-lg border border-atlas-border bg-atlas-bg px-2 py-1 text-[11px] outline-none"
        />
        <button
          type="submit"
          title="Add custom rule"
          className="rounded-lg bg-atlas-elevated px-2 py-1 text-atlas-text hover:bg-atlas-accent hover:text-atlas-accent-fg transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>

      {(adBlockStats.customRules?.length ?? 0) > 0 && (
        <div className="max-h-20 overflow-y-auto space-y-1">
          {adBlockStats.customRules!.map((rule) => (
            <div key={rule} className="flex items-center justify-between rounded bg-atlas-bg px-2 py-0.5 text-[10px]">
              <span className="truncate font-mono">{rule}</span>
              <button
                type="button"
                onClick={async () => {
                  const next = await window.atlas.removeAdBlockRule(rule);
                  setAdBlockStats(next);
                  setRulesChanged(true);
                }}
                className="text-atlas-muted hover:text-atlas-danger"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Deterministic Page Trust Signals */}
      {trustReport && (
        <div className="rounded-lg border border-atlas-border bg-atlas-bg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[10px] uppercase text-atlas-muted">Page Trust (Deterministic)</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                trustReport.level === 'warning'
                  ? 'bg-atlas-danger/15 text-atlas-danger'
                  : trustReport.level === 'caution'
                  ? 'bg-atlas-warning/15 text-atlas-warning'
                  : 'bg-atlas-success/15 text-atlas-success'
              }`}
            >
              {trustReport.level}
            </span>
          </div>
          {trustReport.signals.slice(0, 3).map((s) => (
            <div key={s.id} className="text-[11px]">
              <span className="font-medium text-atlas-text">{s.title}:</span>{' '}
              <span className="text-atlas-muted">{s.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-between border-t border-atlas-border pt-2 text-[11px]">
        {activeTab && activeTab.url.startsWith('http') ? (
          <button
            type="button"
            onClick={async () => {
              const next = await window.atlas.reportAdBlockBrokenSite(activeTab.url);
              setAdBlockStats(next);
              pushToast('Broken page report recorded locally', 'success');
            }}
            className="flex items-center gap-1 text-atlas-muted hover:text-atlas-warning"
          >
            <Flag className="h-3 w-3" /> Report broken page
          </button>
        ) : (
          <span className="text-atlas-muted">Network + Cosmetic</span>
        )}
        <button type="button" onClick={onClose} className="text-atlas-muted hover:text-atlas-text">
          Close
        </button>
      </div>
    </div>
  );
};

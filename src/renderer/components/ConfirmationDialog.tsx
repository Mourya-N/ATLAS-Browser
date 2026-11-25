import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAtlasStore } from '../store/useAtlasStore';

export const ConfirmationDialog: React.FC = () => {
  const { confirmationQueue, shiftConfirmation } = useAtlasStore();
  const current = confirmationQueue[0] ?? null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [rememberDomain, setRememberDomain] = useState(false);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (current && !dlg.open) {
      setRememberDomain(false);
      dlg.showModal();
    } else if (!current && dlg.open) {
      dlg.close();
    }
  }, [current?.id]);

  if (!current) return null;

  const respond = async (approved: boolean) => {
    await window.atlas.respondConfirmation({
      requestId: current.id,
      approved,
      rememberForDomain: approved && rememberDomain && current.tier !== 'sensitive',
      domainRuleMode: approved && rememberDomain ? 'interact' : undefined
    });
    shiftConfirmation();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        void respond(false);
      }}
      className="w-full max-w-lg rounded-2xl border border-atlas-border bg-atlas-surface p-0 text-atlas-text shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-atlas-border px-5 py-4 bg-atlas-warning/10">
        <ShieldAlert className="h-6 w-6 text-atlas-warning shrink-0" />
        <div>
          <h2 className="text-sm font-bold">Action Confirmation Required</h2>
          <p className="text-xs text-atlas-muted">
            Permission Tier: <span className="font-semibold uppercase text-atlas-warning">{current.tier}</span>
          </p>
        </div>
      </div>

      <div className="p-5 space-y-3 text-xs">
        <InfoRow label="Website Domain" value={current.domain} />
        <InfoRow label="Current Page" value={current.currentUrl} mono />
        <InfoRow label="Action" value={`${current.toolName} — ${current.actionSummary}`} />
        <InfoRow label="Target Element" value={current.targetDescription} />
        <InfoRow label="Data Submitted" value={current.submittedDataSummary} />
        <InfoRow label="Expected Consequence" value={current.expectedConsequence} />
        <div className="flex items-center justify-between rounded-lg bg-atlas-elevated px-3 py-2">
          <span className="text-atlas-muted font-medium">Reversible</span>
          <span className={`font-bold ${current.reversible ? 'text-atlas-success' : 'text-atlas-danger'}`}>
            {current.reversible ? 'Yes' : 'No (Irreversible / High Impact)'}
          </span>
        </div>

        {current.tier !== 'sensitive' && (
          <label className="flex items-center gap-2 pt-1 text-xs text-atlas-muted cursor-pointer">
            <input
              type="checkbox"
              checked={rememberDomain}
              onChange={(e) => setRememberDomain(e.target.checked)}
              className="rounded border-atlas-border"
            />
            Allow non-sensitive interactions on {current.domain}
          </label>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-atlas-border px-5 py-3.5">
        <button
          type="button"
          onClick={() => void respond(false)}
          className="rounded-xl border border-atlas-border bg-atlas-elevated px-4 py-2 text-xs font-semibold hover:bg-atlas-border"
        >
          Reject Action
        </button>
        <button
          type="button"
          onClick={() => void respond(true)}
          className="rounded-xl bg-atlas-accent px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          Approve & Continue
        </button>
      </div>
    </dialog>
  );
};

const InfoRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="rounded-lg border border-atlas-border bg-atlas-bg/60 px-3 py-2">
    <div className="text-[10px] font-semibold uppercase text-atlas-muted">{label}</div>
    <div className={`mt-0.5 break-all text-atlas-text ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</div>
  </div>
);

import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useLavrayStore } from '../store/useLavrayStore';

export const ConfirmationDialog: React.FC = () => {
  const { confirmationQueue, shiftConfirmation } = useLavrayStore();
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
    await window.lavray.respondConfirmation({
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
      className="lavray-glass w-full max-w-lg rounded-xl border border-lavray-border p-0 text-lavray-text shadow-lavray-float backdrop:bg-black/25"
    >
      <div className="flex items-center gap-3 border-b border-lavray-border px-5 py-3.5">
        <ShieldAlert className="h-5 w-5 text-lavray-warning shrink-0" strokeWidth={1.75} />
        <div>
          <h2 className="text-[13.5px] font-semibold">Action Confirmation Required</h2>
          <p className="text-[11.5px] text-lavray-muted">
            Permission Tier:{' '}
            <span className="font-semibold uppercase text-lavray-warning">{current.tier}</span>
          </p>
        </div>
      </div>

      <div className="p-5 space-y-2.5 text-xs">
        <InfoRow label="Domain" value={current.domain} />
        <InfoRow label="URL" value={current.currentUrl} mono />
        <InfoRow label="Action" value={`${current.toolName} — ${current.actionSummary}`} />
        <InfoRow label="Target" value={current.targetDescription} />
        <InfoRow label="Data" value={current.submittedDataSummary} />
        <InfoRow label="Consequence" value={current.expectedConsequence} />

        <div className="flex items-center justify-between border-t border-lavray-border pt-2.5">
          <span className="text-lavray-muted font-medium">Reversible</span>
          <span className={`font-semibold ${current.reversible ? 'text-lavray-success' : 'text-lavray-danger'}`}>
            {current.reversible ? 'Yes' : 'No — High impact'}
          </span>
        </div>

        {current.tier !== 'sensitive' && (
          <label className="flex items-center gap-2 pt-1 text-xs text-lavray-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={rememberDomain}
              onChange={(e) => setRememberDomain(e.target.checked)}
              className="rounded border-lavray-border accent-lavray-accent"
            />
            Allow non-sensitive interactions on {current.domain}
          </label>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-lavray-border px-5 py-3 bg-lavray-shell/50">
        <button
          type="button"
          onClick={() => void respond(false)}
          className="rounded-lg border border-lavray-border bg-lavray-surface px-3.5 py-1.5 text-xs font-medium text-lavray-text hover:bg-lavray-shell transition-colors"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => void respond(true)}
          className="rounded-lg bg-lavray-accent px-3.5 py-1.5 text-xs font-medium text-lavray-accent-fg hover:opacity-90 transition-opacity"
        >
          Approve & Continue
        </button>
      </div>
    </dialog>
  );
};

const InfoRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="grid grid-cols-4 gap-2 py-1 border-b border-lavray-border/50 last:border-b-0">
    <div className="text-[11px] font-medium text-lavray-muted">{label}</div>
    <div className={`col-span-3 break-all text-lavray-text ${mono ? 'font-mono text-[11px]' : ''}`}>
      {value}
    </div>
  </div>
);

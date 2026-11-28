import React from 'react';
import { Hand, Play, ShieldAlert, Square } from 'lucide-react';
import { useLavrayStore } from '../store/useLavrayStore';

export const HitlBanner: React.FC = () => {
  const { hitlPause, setHitlPause } = useLavrayStore();
  if (!hitlPause) return null;

  return (
    <div className="flex h-10 items-center justify-between border-b border-lavray-warning/35 bg-lavray-warning/10 px-4 text-xs">
      <div className="flex items-center gap-2 text-lavray-warning font-medium min-w-0">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span className="truncate">Paused for manual action ({hitlPause.reason}): {hitlPause.explanation}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={async () => {
            await window.lavray.resumeAgentRun(hitlPause.runId);
            setHitlPause(null);
          }}
          className="flex items-center gap-1 rounded-md bg-lavray-success px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
        >
          <Play className="h-3 w-3" /> Continue
        </button>
        <button
          type="button"
          onClick={async () => {
            await window.lavray.takeoverAgentRun(hitlPause.runId);
            setHitlPause(null);
          }}
          className="flex items-center gap-1 rounded-md border border-lavray-border bg-lavray-surface px-2.5 py-1 text-[11px] font-medium text-lavray-text hover:bg-lavray-shell"
        >
          <Hand className="h-3 w-3" /> Take Control
        </button>
        <button
          type="button"
          onClick={async () => {
            await window.lavray.stopAgentRun(hitlPause.runId);
            setHitlPause(null);
          }}
          className="flex items-center gap-1 rounded-md border border-lavray-danger/40 bg-lavray-danger/10 px-2.5 py-1 text-[11px] font-medium text-lavray-danger"
        >
          <Square className="h-3 w-3" /> Stop
        </button>
      </div>
    </div>
  );
};

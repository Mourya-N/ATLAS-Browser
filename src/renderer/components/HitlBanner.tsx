import React from 'react';
import { Hand, Play, ShieldAlert, Square } from 'lucide-react';
import { useAtlasStore } from '../store/useAtlasStore';

export const HitlBanner: React.FC = () => {
  const { hitlPause, setHitlPause } = useAtlasStore();
  if (!hitlPause) return null;

  return (
    <div className="flex h-10 items-center justify-between border-b border-atlas-warning/35 bg-atlas-warning/10 px-4 text-xs">
      <div className="flex items-center gap-2 text-atlas-warning font-medium min-w-0">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span className="truncate">Paused for manual action ({hitlPause.reason}): {hitlPause.explanation}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={async () => {
            await window.atlas.resumeAgentRun(hitlPause.runId);
            setHitlPause(null);
          }}
          className="flex items-center gap-1 rounded-md bg-atlas-success px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
        >
          <Play className="h-3 w-3" /> Continue
        </button>
        <button
          type="button"
          onClick={async () => {
            await window.atlas.takeoverAgentRun(hitlPause.runId);
            setHitlPause(null);
          }}
          className="flex items-center gap-1 rounded-md border border-atlas-border bg-atlas-surface px-2.5 py-1 text-[11px] font-medium text-atlas-text hover:bg-atlas-shell"
        >
          <Hand className="h-3 w-3" /> Take Control
        </button>
        <button
          type="button"
          onClick={async () => {
            await window.atlas.stopAgentRun(hitlPause.runId);
            setHitlPause(null);
          }}
          className="flex items-center gap-1 rounded-md border border-atlas-danger/40 bg-atlas-danger/10 px-2.5 py-1 text-[11px] font-medium text-atlas-danger"
        >
          <Square className="h-3 w-3" /> Stop
        </button>
      </div>
    </div>
  );
};

import React from 'react';
import { Hand, Play, Square } from 'lucide-react';
import { useAtlasStore } from '../store/useAtlasStore';

export const HitlBanner: React.FC = () => {
  const { hitlPause, setHitlPause } = useAtlasStore();

  if (!hitlPause) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-atlas-warning/40 bg-atlas-warning/15 px-4 py-2 text-xs text-atlas-text">
      <div className="flex items-center gap-2.5 min-w-0">
        <Hand className="h-4 w-4 text-atlas-warning shrink-0" />
        <div className="min-w-0">
          <span className="font-bold uppercase tracking-wide text-atlas-warning mr-2">
            Human Intervention ({hitlPause.reason.replace('_', ' ')})
          </span>
          <span className="text-atlas-text">{hitlPause.explanation}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={async () => {
            await window.atlas.activateTab(hitlPause.tabId);
            await window.atlas.takeoverAgentRun(hitlPause.runId);
          }}
          className="rounded-lg border border-atlas-border bg-atlas-surface px-2.5 py-1 font-semibold hover:bg-atlas-elevated"
        >
          Take Over
        </button>
        <button
          type="button"
          onClick={async () => {
            await window.atlas.resumeHitl(hitlPause.runId);
            setHitlPause(null);
          }}
          className="flex items-center gap-1 rounded-lg bg-atlas-success px-2.5 py-1 font-semibold text-white hover:opacity-90"
        >
          <Play className="h-3 w-3" /> Resume Agent
        </button>
        <button
          type="button"
          onClick={async () => {
            await window.atlas.stopAgentRun(hitlPause.runId);
            setHitlPause(null);
          }}
          className="flex items-center gap-1 rounded-lg bg-atlas-danger px-2.5 py-1 font-semibold text-white hover:opacity-90"
        >
          <Square className="h-3 w-3" /> Cancel
        </button>
      </div>
    </div>
  );
};

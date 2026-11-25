import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useAtlasStore } from '../store/useAtlasStore';

export const FindBar: React.FC = () => {
  const { findBarOpen, setFindBarOpen, activeTabId } = useAtlasStore();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (findBarOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (activeTabId) {
      void window.atlas.stopFindInPage(activeTabId);
    }
  }, [findBarOpen, activeTabId]);

  if (!findBarOpen) return null;

  const find = (forward: boolean, findNext: boolean) => {
    if (activeTabId && query) {
      void window.atlas.findInPage(activeTabId, query, forward, findNext);
    }
  };

  return (
    <div className="fixed right-96 top-24 z-40 flex items-center gap-1.5 rounded-xl border border-atlas-border bg-atlas-surface px-3 py-1.5 shadow-2xl">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (activeTabId && e.target.value) {
            void window.atlas.findInPage(activeTabId, e.target.value, true, false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') find(!e.shiftKey, true);
          if (e.key === 'Escape') setFindBarOpen(false);
        }}
        placeholder="Find in page..."
        className="w-48 bg-transparent text-xs text-atlas-text outline-none select-text"
      />
      <button
        type="button"
        onClick={() => find(false, true)}
        className="rounded p-1 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text"
        aria-label="Previous match"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => find(true, true)}
        className="rounded p-1 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text"
        aria-label="Next match"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setFindBarOpen(false)}
        className="rounded p-1 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text"
        aria-label="Close find bar"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

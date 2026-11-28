import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useLavrayStore } from '../store/useLavrayStore';

export const FindBar: React.FC = () => {
  const { findBarOpen, setFindBarOpen, activeTabId, agentPanelOpen, agentPanelWidth, verticalTabs } =
    useLavrayStore();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (findBarOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (activeTabId) {
      void window.lavray.stopFindInPage(activeTabId);
    }
  }, [findBarOpen, activeTabId]);

  if (!findBarOpen) return null;

  const find = (forward: boolean, findNext: boolean) => {
    if (activeTabId && query) {
      void window.lavray.findInPage(activeTabId, query, forward, findNext);
    }
  };

  return (
    <div
      style={{ right: agentPanelOpen ? agentPanelWidth + 16 : 16 }}
      className={`lavray-glass fixed z-40 flex items-center gap-1 rounded-xl border border-lavray-border px-3 py-1.5 shadow-lavray-float ${
        verticalTabs ? 'top-14' : 'top-[90px]'
      }`}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (activeTabId && e.target.value) {
            void window.lavray.findInPage(activeTabId, e.target.value, true, false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') find(!e.shiftKey, true);
          if (e.key === 'Escape') setFindBarOpen(false);
        }}
        placeholder="Find in page..."
        className="w-48 bg-transparent text-xs text-lavray-text placeholder:text-lavray-muted outline-none select-text"
      />
      <button
        type="button"
        onClick={() => find(false, true)}
        className="rounded-md p-1 text-lavray-muted hover:bg-lavray-shell hover:text-lavray-text"
        aria-label="Previous match"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => find(true, true)}
        className="rounded-md p-1 text-lavray-muted hover:bg-lavray-shell hover:text-lavray-text"
        aria-label="Next match"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setFindBarOpen(false)}
        className="rounded-md p-1 text-lavray-muted hover:bg-lavray-shell hover:text-lavray-text"
        aria-label="Close find bar"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

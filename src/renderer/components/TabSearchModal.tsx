import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useAtlasStore } from '../store/useAtlasStore';

export const TabSearchModal: React.FC = () => {
  const { tabSearchOpen, setTabSearchOpen, tabs, activeTabId } = useAtlasStore();
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (tabSearchOpen && !dlg.open) {
      setQuery('');
      dlg.showModal();
    } else if (!tabSearchOpen && dlg.open) {
      dlg.close();
    }
  }, [tabSearchOpen]);

  if (!tabSearchOpen) return null;

  const filtered = tabs.filter((t) => {
    const q = query.toLowerCase();
    return (
      (t.customTitle || t.title).toLowerCase().includes(q) ||
      t.url.toLowerCase().includes(q)
    );
  });

  return (
    <dialog
      ref={dialogRef}
      onClose={() => setTabSearchOpen(false)}
      onClick={(e) => {
        if (e.target === dialogRef.current) setTabSearchOpen(false);
      }}
      className="atlas-glass w-full max-w-lg rounded-xl border border-atlas-border p-0 text-atlas-text shadow-atlas-float backdrop:bg-black/20"
    >
      <div className="flex items-center gap-2.5 border-b border-atlas-border px-4 py-3">
        <Search className="h-4 w-4 text-atlas-muted" strokeWidth={1.75} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to open tab..."
          className="flex-1 bg-transparent text-[13px] outline-none select-text"
        />
        <button
          type="button"
          onClick={() => setTabSearchOpen(false)}
          className="rounded-lg p-1 text-atlas-muted hover:bg-atlas-shell hover:text-atlas-text"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto p-1.5 space-y-0.5">
        {filtered.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              void window.atlas.activateTab(tab.id);
              setTabSearchOpen(false);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${
              tab.id === activeTabId
                ? 'bg-atlas-accent/12 text-atlas-accent'
                : 'hover:bg-atlas-shell text-atlas-text'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {tab.customTitle || (tab.url === 'atlas://newtab' ? 'New Tab' : tab.title)}
              </div>
              <div className="truncate text-[11px] text-atlas-muted">{tab.url}</div>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-xs text-atlas-muted">No matching open tabs</div>
        )}
      </div>
    </dialog>
  );
};

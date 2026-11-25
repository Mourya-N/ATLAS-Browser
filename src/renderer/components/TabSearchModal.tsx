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
      className="w-full max-w-lg rounded-2xl border border-atlas-border bg-atlas-surface p-0 text-atlas-text shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-atlas-border px-4 py-3">
        <Search className="h-4 w-4 text-atlas-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search open tabs..."
          className="flex-1 bg-transparent text-sm outline-none select-text"
        />
        <button
          type="button"
          onClick={() => setTabSearchOpen(false)}
          className="rounded p-1 text-atlas-muted hover:bg-atlas-elevated"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto p-2 space-y-1">
        {filtered.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              void window.atlas.activateTab(tab.id);
              setTabSearchOpen(false);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${
              tab.id === activeTabId ? 'bg-atlas-accent/15 text-atlas-accent' : 'hover:bg-atlas-elevated'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{tab.customTitle || tab.title}</div>
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

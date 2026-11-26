import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Compass,
  ExternalLink,
  History,
  Lock,
  Search,
  Settings,
  Sparkles
} from 'lucide-react';
import type { HistoryEntry, ReadingListItem } from '@shared/types';
import { useAtlasStore } from '../store/useAtlasStore';

export const NewTabView: React.FC = () => {
  const { activeTabId, isPrivateWindow, setOverlayView, openAtlasSearch } = useAtlasStore();
  const [query, setQuery] = useState('');
  const [topSites, setTopSites] = useState<HistoryEntry[]>([]);
  const [readingList, setReadingList] = useState<ReadingListItem[]>([]);

  useEffect(() => {
    if (isPrivateWindow) return;
    void window.atlas
      .getTopSites()
      .then((list) => setTopSites(list.slice(0, 8)))
      .catch(() => {});
    void window.atlas
      .listReadingList()
      .then((list) => setReadingList(list.slice(0, 4)))
      .catch(() => {});
  }, [isPrivateWindow]);

  const openUrl = async (url: string) => {
    setOverlayView(null);
    if (activeTabId) {
      await window.atlas.navigate(activeTabId, url);
    } else {
      await window.atlas.createTab({ url, activate: true });
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    await openUrl(trimmed);
  };

  const getHost = (raw: string) => {
    try {
      return new URL(raw).hostname.replace(/^www\./, '');
    } catch {
      return raw;
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-atlas-bg text-atlas-text select-text">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-8 py-12">
        {/* Identity Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-atlas-border bg-atlas-surface text-atlas-accent shadow-atlas-sm">
              {isPrivateWindow ? (
                <Lock className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Compass className="h-[18px] w-[18px]" strokeWidth={1.75} />
              )}
            </span>
            <div>
              <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-atlas-text">
                {isPrivateWindow ? 'Private Window' : 'Atlas'}
              </h1>
              <p className="text-[12px] text-atlas-muted">
                {isPrivateWindow
                  ? 'History, cookies, and form data stay isolated and are cleared when closed.'
                  : 'Local-first browser with grounded search and isolated web contexts'}
              </p>
            </div>
          </div>
        </div>

        {/* Focused Search & URL Entry */}
        <form onSubmit={(e) => void handleSearchSubmit(e)} className="mb-8">
          <div className="flex items-center gap-2 rounded-xl border border-atlas-border bg-atlas-surface px-3.5 py-2.5 shadow-atlas-sm focus-within:border-atlas-accent/80 focus-within:ring-2 focus-within:ring-atlas-accent/15 transition-all">
            <Search className="h-4 w-4 shrink-0 text-atlas-muted" strokeWidth={1.75} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter URL or search the web..."
              className="flex-1 bg-transparent text-[14px] text-atlas-text placeholder:text-atlas-muted outline-none"
            />
            {query.trim() && (
              <button
                type="button"
                onClick={() => openAtlasSearch(query.trim())}
                className="rounded-lg border border-atlas-border bg-atlas-shell px-2.5 py-1 text-[11.5px] font-medium text-atlas-secondary hover:text-atlas-text transition-colors"
              >
                Search Atlas Index
              </button>
            )}
            <button
              type="submit"
              aria-label="Go"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-atlas-accent text-atlas-accent-fg hover:opacity-90 transition-opacity"
            >
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </form>

        {/* Purposeful Asymmetric Bento: Top Sites + Reading / Workspace */}
        {!isPrivateWindow && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Primary Left Bento Panel (8 cols): Frequently Visited */}
            <div className="md:col-span-8 rounded-xl border border-atlas-border bg-atlas-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-atlas-muted">
                  Frequently Visited
                </h2>
                <button
                  type="button"
                  onClick={() => setOverlayView('history')}
                  className="text-[11.5px] font-medium text-atlas-secondary hover:text-atlas-accent transition-colors"
                >
                  Full history
                </button>
              </div>

              {topSites.length > 0 ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {topSites.map((site) => {
                    const host = getHost(site.url);
                    const monogram = (
                      host.match(/[A-Za-z]/)?.[0] ||
                      site.title?.match(/[A-Za-z]/)?.[0] ||
                      'A'
                    ).toUpperCase();
                    return (
                      <button
                        key={site.id}
                        type="button"
                        onClick={() => void openUrl(site.url)}
                        className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-atlas-shell transition-colors"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-atlas-border bg-atlas-bg text-[11px] font-semibold text-atlas-secondary">
                          {site.favicon ? (
                            <img src={site.favicon} alt="" className="h-4 w-4 rounded-sm object-contain" />
                          ) : (
                            monogram
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-medium text-atlas-text group-hover:text-atlas-accent transition-colors">
                            {site.title || host}
                          </div>
                          <div className="truncate text-[11px] text-atlas-muted">{host}</div>
                        </div>
                        <ExternalLink className="h-3 w-3 shrink-0 text-atlas-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="py-7 text-center text-[12.5px] text-atlas-muted">
                  Sites you visit appear here automatically for quick access.
                </div>
              )}
            </div>

            {/* Secondary Right Bento Panel (4 cols): Saved Reading & Shortcuts */}
            <div className="md:col-span-4 flex flex-col justify-between rounded-xl border border-atlas-border bg-atlas-surface p-4">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-atlas-muted">
                    {readingList.length > 0 ? 'Reading List' : 'Workspaces'}
                  </h2>
                  {readingList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOverlayView('reader')}
                      className="text-[11.5px] font-medium text-atlas-secondary hover:text-atlas-accent"
                    >
                      Open
                    </button>
                  )}
                </div>

                {readingList.length > 0 ? (
                  <div className="space-y-1">
                    {readingList.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void openUrl(item.url)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-atlas-shell transition-colors"
                      >
                        <span className="truncate text-[12px] font-medium text-atlas-text">
                          {item.title}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-atlas-muted">{item.progress}%</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <QuickShortcut
                      icon={<Search className="h-3.5 w-3.5" />}
                      label="Atlas Search"
                      onClick={() => openAtlasSearch('')}
                    />
                    <QuickShortcut
                      icon={<Sparkles className="h-3.5 w-3.5" />}
                      label="Research Workspace"
                      onClick={() => setOverlayView('intelligence')}
                    />
                    <QuickShortcut
                      icon={<Bookmark className="h-3.5 w-3.5" />}
                      label="Bookmarks"
                      onClick={() => setOverlayView('bookmarks')}
                    />
                    <QuickShortcut
                      icon={<BookOpen className="h-3.5 w-3.5" />}
                      label="Reading List"
                      onClick={() => setOverlayView('reader')}
                    />
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-atlas-border flex items-center justify-between text-[11.5px] text-atlas-muted">
                <button
                  type="button"
                  onClick={() => setOverlayView('history')}
                  className="inline-flex items-center gap-1 hover:text-atlas-text transition-colors"
                >
                  <History className="h-3 w-3" /> History
                </button>
                <button
                  type="button"
                  onClick={() => setOverlayView('settings')}
                  className="inline-flex items-center gap-1 hover:text-atlas-text transition-colors"
                >
                  <Settings className="h-3 w-3" /> Appearance
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const QuickShortcut: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> = ({
  icon,
  label,
  onClick
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium text-atlas-secondary hover:bg-atlas-shell hover:text-atlas-text transition-colors"
  >
    <span className="text-atlas-muted">{icon}</span>
    <span>{label}</span>
  </button>
);

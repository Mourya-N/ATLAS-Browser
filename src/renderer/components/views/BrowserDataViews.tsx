import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  Download,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  History,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react';
import type { BookmarkEntry, BookmarkFolder, HistoryEntry } from '@shared/types';
import { useLavrayStore } from '../../store/useLavrayStore';

const ViewShell: React.FC<{
  title: string;
  icon: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, actions, children }) => {
  const { setOverlayView } = useLavrayStore();
  return (
    <div className="flex h-full flex-col bg-lavray-bg text-lavray-text select-text">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-lavray-border bg-lavray-surface px-6">
        <div className="flex items-center gap-2.5">
          <span className="text-lavray-accent">{icon}</span>
          <h1 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={() => setOverlayView(null)}
            className="rounded-lg p-1.5 text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text"
            aria-label="Close view"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  );
};

export const HistoryView: React.FC = () => {
  const { activeTabId, setOverlayView } = useLavrayStore();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [topSites, setTopSites] = useState<HistoryEntry[]>([]);

  const load = async (q = query) => {
    const [list, top] = await Promise.all([
      window.lavray.listHistory(q),
      window.lavray.getTopSites()
    ]);
    setEntries(list);
    setTopSites(top);
  };

  useEffect(() => {
    void load('');
  }, []);

  const openUrl = async (url: string) => {
    setOverlayView(null);
    if (activeTabId) await window.lavray.navigate(activeTabId, url);
    else await window.lavray.createTab({ url, activate: true });
  };

  return (
    <ViewShell
      title="Browsing History"
      icon={<History className="h-5 w-5" />}
      actions={
        <button
          type="button"
          onClick={async () => {
            await window.lavray.clearHistory();
            void load('');
          }}
          className="rounded-lg border border-lavray-danger/40 bg-lavray-danger/10 px-3 py-1.5 text-xs font-semibold text-lavray-danger hover:bg-lavray-danger/20"
        >
          Clear All History
        </button>
      }
    >
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-2 rounded-xl border border-lavray-border bg-lavray-surface px-3 py-2">
          <Search className="h-4 w-4 text-lavray-muted" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              void load(e.target.value);
            }}
            placeholder="Search visited pages by title or URL..."
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        {topSites.length > 0 && !query && (
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-lavray-muted">
              Most Visited Sites
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {topSites.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void openUrl(s.url)}
                  className="rounded-xl border border-lavray-border bg-lavray-surface p-3 text-left hover:border-lavray-accent"
                >
                  <div className="truncate text-xs font-semibold">{s.title}</div>
                  <div className="truncate text-[11px] text-lavray-muted">{s.url}</div>
                  <div className="mt-1 text-[10px] text-lavray-accent">{s.visitCount} visits</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {entries.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-lavray-border bg-lavray-surface px-4 py-2.5 text-xs"
            >
              <button
                type="button"
                onClick={() => void openUrl(item.url)}
                className="min-w-0 flex-1 text-left hover:text-lavray-accent"
              >
                <div className="truncate font-semibold">{item.title}</div>
                <div className="truncate text-[11px] text-lavray-muted">{item.url}</div>
              </button>
              <span className="shrink-0 text-[11px] text-lavray-muted">
                {new Date(item.lastVisitedAt).toLocaleString()}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await window.lavray.deleteHistory(item.id);
                  void load();
                }}
                className="rounded p-1 text-lavray-muted hover:text-lavray-danger"
                aria-label="Delete history item"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {entries.length === 0 && (
            <div className="py-12 text-center text-sm text-lavray-muted">No history records found.</div>
          )}
        </div>
      </div>
    </ViewShell>
  );
};

export const BookmarksView: React.FC = () => {
  const { activeTabId, tabs, setOverlayView } = useLavrayStore();
  const [query, setQuery] = useState('');
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const load = async (q = query) => {
    const res = await window.lavray.listBookmarks(q);
    setBookmarks(res.bookmarks);
    setFolders(res.folders);
  };

  useEffect(() => {
    void load('');
  }, []);

  const visible = selectedFolder
    ? bookmarks.filter((b) => b.folderId === selectedFolder)
    : bookmarks;

  return (
    <ViewShell title="Bookmarks" icon={<Bookmark className="h-5 w-5" />}>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-1 min-w-[220px] items-center gap-2 rounded-xl border border-lavray-border bg-lavray-surface px-3 py-2">
            <Search className="h-4 w-4 text-lavray-muted" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                void load(e.target.value);
              }}
              placeholder="Search bookmarks..."
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New folder name"
              className="rounded-xl border border-lavray-border bg-lavray-surface px-3 py-2 text-xs outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                if (!newFolderName.trim()) return;
                await window.lavray.createBookmarkFolder(newFolderName.trim());
                setNewFolderName('');
                void load();
              }}
              className="flex items-center gap-1 rounded-xl bg-lavray-elevated px-3 py-2 text-xs font-semibold hover:bg-lavray-border"
            >
              <FolderPlus className="h-3.5 w-3.5" /> Folder
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedFolder(null)}
            className={`rounded-lg px-3 py-1 text-xs font-medium ${
              selectedFolder === null ? 'bg-lavray-accent text-lavray-accent-fg' : 'bg-lavray-surface border border-lavray-border'
            }`}
          >
            All ({bookmarks.length})
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedFolder(f.id)}
              className={`rounded-lg px-3 py-1 text-xs font-medium ${
                selectedFolder === f.id ? 'bg-lavray-accent text-lavray-accent-fg' : 'bg-lavray-surface border border-lavray-border'
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newUrl.trim()) return;
            await window.lavray.addBookmark(newUrl.trim(), newTitle.trim() || newUrl.trim(), selectedFolder);
            setNewTitle('');
            setNewUrl('');
            void load();
          }}
          className="flex flex-wrap gap-2 rounded-xl border border-lavray-border bg-lavray-surface p-3"
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title"
            className="flex-1 min-w-[160px] rounded-lg border border-lavray-border bg-lavray-bg px-2.5 py-1.5 text-xs outline-none"
          />
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1 min-w-[220px] rounded-lg border border-lavray-border bg-lavray-bg px-2.5 py-1.5 text-xs outline-none"
          />
          <button
            type="submit"
            className="flex items-center gap-1 rounded-lg bg-lavray-accent px-3 py-1.5 text-xs font-semibold text-lavray-accent-fg"
          >
            <Plus className="h-3.5 w-3.5" /> Add Bookmark
          </button>
          {activeTabId && (
            <button
              type="button"
              onClick={async () => {
                const t = tabs.find((x) => x.id === activeTabId);
                if (!t) return;
                await window.lavray.addBookmark(t.url, t.title, selectedFolder);
                void load();
              }}
              className="rounded-lg bg-lavray-elevated px-3 py-1.5 text-xs font-semibold"
            >
              Bookmark Active Tab
            </button>
          )}
        </form>

        <div className="space-y-1.5">
          {visible.map((bm) => (
            <div
              key={bm.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-lavray-border bg-lavray-surface px-4 py-2.5 text-xs"
            >
              <button
                type="button"
                onClick={async () => {
                  setOverlayView(null);
                  if (activeTabId) await window.lavray.navigate(activeTabId, bm.url);
                }}
                className="min-w-0 flex-1 text-left hover:text-lavray-accent"
              >
                <div className="truncate font-semibold">{bm.title}</div>
                <div className="truncate text-[11px] text-lavray-muted">{bm.url}</div>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await window.lavray.deleteBookmark(bm.id);
                  void load();
                }}
                className="rounded p-1 text-lavray-muted hover:text-lavray-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </ViewShell>
  );
};

export const DownloadsView: React.FC = () => {
  const { downloads, setDownloads } = useLavrayStore();

  useEffect(() => {
    void window.lavray.listDownloads().then(setDownloads);
  }, []);

  return (
    <ViewShell title="Downloads" icon={<Download className="h-5 w-5" />}>
      <div className="mx-auto max-w-4xl space-y-2.5">
        {downloads.map((d) => {
          const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
          return (
            <div
              key={d.id}
              className="rounded-xl border border-lavray-border bg-lavray-surface p-4 text-xs space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">
                    {d.filename}{' '}
                    {d.isDangerous && (
                      <span className="ml-1 rounded bg-lavray-warning/15 px-1.5 py-0.5 text-[10px] text-lavray-warning">
                        Executable/Sensitive
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-lavray-muted">{d.url}</div>
                </div>
                <span className="rounded bg-lavray-elevated px-2 py-0.5 text-[10px] font-bold uppercase">
                  {d.state}
                </span>
              </div>

              {(d.state === 'progressing' || d.state === 'paused') && (
                <div className="h-1.5 w-full rounded-full bg-lavray-elevated overflow-hidden">
                  <div className="h-full bg-lavray-accent" style={{ width: `${pct}%` }} />
                </div>
              )}

              <div className="flex items-center justify-between text-[11px] text-lavray-muted">
                <span>
                  {(d.receivedBytes / 1024).toFixed(1)} KB
                  {d.totalBytes > 0 ? ` / ${(d.totalBytes / 1024).toFixed(1)} KB (${pct}%)` : ''}
                </span>
                <div className="flex items-center gap-1.5">
                  {d.state === 'progressing' && (
                    <button
                      type="button"
                      onClick={() => void window.lavray.downloadAction(d.id, 'pause')}
                      className="flex items-center gap-1 rounded bg-lavray-elevated px-2 py-1 hover:bg-lavray-border"
                    >
                      <Pause className="h-3 w-3" /> Pause
                    </button>
                  )}
                  {d.state === 'paused' && (
                    <button
                      type="button"
                      onClick={() => void window.lavray.downloadAction(d.id, 'resume')}
                      className="flex items-center gap-1 rounded bg-lavray-elevated px-2 py-1 hover:bg-lavray-border"
                    >
                      <Play className="h-3 w-3" /> Resume
                    </button>
                  )}
                  {(d.state === 'progressing' || d.state === 'paused') && (
                    <button
                      type="button"
                      onClick={() => void window.lavray.downloadAction(d.id, 'cancel')}
                      className="rounded bg-lavray-danger/15 px-2 py-1 text-lavray-danger"
                    >
                      Cancel
                    </button>
                  )}
                  {d.state === 'completed' && (
                    <>
                      <button
                        type="button"
                        onClick={() => void window.lavray.downloadAction(d.id, 'open')}
                        className="flex items-center gap-1 rounded bg-lavray-accent/15 px-2 py-1 text-lavray-accent"
                      >
                        <ExternalLink className="h-3 w-3" /> Open
                      </button>
                      <button
                        type="button"
                        onClick={() => void window.lavray.downloadAction(d.id, 'reveal')}
                        className="flex items-center gap-1 rounded bg-lavray-elevated px-2 py-1"
                      >
                        <FolderOpen className="h-3 w-3" /> Reveal
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {downloads.length === 0 && (
          <div className="py-12 text-center text-sm text-lavray-muted">No downloads yet.</div>
        )}
      </div>
    </ViewShell>
  );
};

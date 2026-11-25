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
import { useAtlasStore } from '../../store/useAtlasStore';

const ViewShell: React.FC<{
  title: string;
  icon: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, actions, children }) => {
  const { setOverlayView } = useAtlasStore();
  return (
    <div className="flex h-full flex-col bg-atlas-bg text-atlas-text select-text">
      <div className="flex items-center justify-between border-b border-atlas-border bg-atlas-surface px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="text-atlas-accent">{icon}</span>
          <h1 className="text-base font-bold">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={() => setOverlayView(null)}
            className="rounded-lg p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text"
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
  const { activeTabId, setOverlayView } = useAtlasStore();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [topSites, setTopSites] = useState<HistoryEntry[]>([]);

  const load = async (q = query) => {
    const [list, top] = await Promise.all([
      window.atlas.listHistory(q),
      window.atlas.getTopSites()
    ]);
    setEntries(list);
    setTopSites(top);
  };

  useEffect(() => {
    void load('');
  }, []);

  const openUrl = async (url: string) => {
    setOverlayView(null);
    if (activeTabId) await window.atlas.navigate(activeTabId, url);
    else await window.atlas.createTab({ url, activate: true });
  };

  return (
    <ViewShell
      title="Browsing History"
      icon={<History className="h-5 w-5" />}
      actions={
        <button
          type="button"
          onClick={async () => {
            await window.atlas.clearHistory();
            void load('');
          }}
          className="rounded-lg border border-atlas-danger/40 bg-atlas-danger/10 px-3 py-1.5 text-xs font-semibold text-atlas-danger hover:bg-atlas-danger/20"
        >
          Clear All History
        </button>
      }
    >
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-2 rounded-xl border border-atlas-border bg-atlas-surface px-3 py-2">
          <Search className="h-4 w-4 text-atlas-muted" />
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
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-atlas-muted">
              Most Visited Sites
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {topSites.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void openUrl(s.url)}
                  className="rounded-xl border border-atlas-border bg-atlas-surface p-3 text-left hover:border-atlas-accent"
                >
                  <div className="truncate text-xs font-semibold">{s.title}</div>
                  <div className="truncate text-[11px] text-atlas-muted">{s.url}</div>
                  <div className="mt-1 text-[10px] text-atlas-accent">{s.visitCount} visits</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          {entries.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-atlas-border bg-atlas-surface px-4 py-2.5 text-xs"
            >
              <button
                type="button"
                onClick={() => void openUrl(item.url)}
                className="min-w-0 flex-1 text-left hover:text-atlas-accent"
              >
                <div className="truncate font-semibold">{item.title}</div>
                <div className="truncate text-[11px] text-atlas-muted">{item.url}</div>
              </button>
              <span className="shrink-0 text-[11px] text-atlas-muted">
                {new Date(item.lastVisitedAt).toLocaleString()}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await window.atlas.deleteHistory(item.id);
                  void load();
                }}
                className="rounded p-1 text-atlas-muted hover:text-atlas-danger"
                aria-label="Delete history item"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {entries.length === 0 && (
            <div className="py-12 text-center text-sm text-atlas-muted">No history records found.</div>
          )}
        </div>
      </div>
    </ViewShell>
  );
};

export const BookmarksView: React.FC = () => {
  const { activeTabId, tabs, setOverlayView } = useAtlasStore();
  const [query, setQuery] = useState('');
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const load = async (q = query) => {
    const res = await window.atlas.listBookmarks(q);
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
          <div className="flex flex-1 min-w-[220px] items-center gap-2 rounded-xl border border-atlas-border bg-atlas-surface px-3 py-2">
            <Search className="h-4 w-4 text-atlas-muted" />
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
              className="rounded-xl border border-atlas-border bg-atlas-surface px-3 py-2 text-xs outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                if (!newFolderName.trim()) return;
                await window.atlas.createBookmarkFolder(newFolderName.trim());
                setNewFolderName('');
                void load();
              }}
              className="flex items-center gap-1 rounded-xl bg-atlas-elevated px-3 py-2 text-xs font-semibold hover:bg-atlas-border"
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
              selectedFolder === null ? 'bg-atlas-accent text-white' : 'bg-atlas-surface border border-atlas-border'
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
                selectedFolder === f.id ? 'bg-atlas-accent text-white' : 'bg-atlas-surface border border-atlas-border'
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
            await window.atlas.addBookmark(newUrl.trim(), newTitle.trim() || newUrl.trim(), selectedFolder);
            setNewTitle('');
            setNewUrl('');
            void load();
          }}
          className="flex flex-wrap gap-2 rounded-xl border border-atlas-border bg-atlas-surface p-3"
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title"
            className="flex-1 min-w-[160px] rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1.5 text-xs outline-none"
          />
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1 min-w-[220px] rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1.5 text-xs outline-none"
          />
          <button
            type="submit"
            className="flex items-center gap-1 rounded-lg bg-atlas-accent px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Add Bookmark
          </button>
          {activeTabId && (
            <button
              type="button"
              onClick={async () => {
                const t = tabs.find((x) => x.id === activeTabId);
                if (!t) return;
                await window.atlas.addBookmark(t.url, t.title, selectedFolder);
                void load();
              }}
              className="rounded-lg bg-atlas-elevated px-3 py-1.5 text-xs font-semibold"
            >
              Bookmark Active Tab
            </button>
          )}
        </form>

        <div className="space-y-1.5">
          {visible.map((bm) => (
            <div
              key={bm.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-atlas-border bg-atlas-surface px-4 py-2.5 text-xs"
            >
              <button
                type="button"
                onClick={async () => {
                  setOverlayView(null);
                  if (activeTabId) await window.atlas.navigate(activeTabId, bm.url);
                }}
                className="min-w-0 flex-1 text-left hover:text-atlas-accent"
              >
                <div className="truncate font-semibold">{bm.title}</div>
                <div className="truncate text-[11px] text-atlas-muted">{bm.url}</div>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await window.atlas.deleteBookmark(bm.id);
                  void load();
                }}
                className="rounded p-1 text-atlas-muted hover:text-atlas-danger"
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
  const { downloads, setDownloads } = useAtlasStore();

  useEffect(() => {
    void window.atlas.listDownloads().then(setDownloads);
  }, []);

  return (
    <ViewShell title="Downloads" icon={<Download className="h-5 w-5" />}>
      <div className="mx-auto max-w-4xl space-y-2.5">
        {downloads.map((d) => {
          const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
          return (
            <div
              key={d.id}
              className="rounded-xl border border-atlas-border bg-atlas-surface p-4 text-xs space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">
                    {d.filename}{' '}
                    {d.isDangerous && (
                      <span className="ml-1 rounded bg-atlas-warning/15 px-1.5 py-0.5 text-[10px] text-atlas-warning">
                        Executable/Sensitive
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-atlas-muted">{d.url}</div>
                </div>
                <span className="rounded bg-atlas-elevated px-2 py-0.5 text-[10px] font-bold uppercase">
                  {d.state}
                </span>
              </div>

              {(d.state === 'progressing' || d.state === 'paused') && (
                <div className="h-1.5 w-full rounded-full bg-atlas-elevated overflow-hidden">
                  <div className="h-full bg-atlas-accent" style={{ width: `${pct}%` }} />
                </div>
              )}

              <div className="flex items-center justify-between text-[11px] text-atlas-muted">
                <span>
                  {(d.receivedBytes / 1024).toFixed(1)} KB
                  {d.totalBytes > 0 ? ` / ${(d.totalBytes / 1024).toFixed(1)} KB (${pct}%)` : ''}
                </span>
                <div className="flex items-center gap-1.5">
                  {d.state === 'progressing' && (
                    <button
                      type="button"
                      onClick={() => void window.atlas.downloadAction(d.id, 'pause')}
                      className="flex items-center gap-1 rounded bg-atlas-elevated px-2 py-1 hover:bg-atlas-border"
                    >
                      <Pause className="h-3 w-3" /> Pause
                    </button>
                  )}
                  {d.state === 'paused' && (
                    <button
                      type="button"
                      onClick={() => void window.atlas.downloadAction(d.id, 'resume')}
                      className="flex items-center gap-1 rounded bg-atlas-elevated px-2 py-1 hover:bg-atlas-border"
                    >
                      <Play className="h-3 w-3" /> Resume
                    </button>
                  )}
                  {(d.state === 'progressing' || d.state === 'paused') && (
                    <button
                      type="button"
                      onClick={() => void window.atlas.downloadAction(d.id, 'cancel')}
                      className="rounded bg-atlas-danger/15 px-2 py-1 text-atlas-danger"
                    >
                      Cancel
                    </button>
                  )}
                  {d.state === 'completed' && (
                    <>
                      <button
                        type="button"
                        onClick={() => void window.atlas.downloadAction(d.id, 'open')}
                        className="flex items-center gap-1 rounded bg-atlas-accent/15 px-2 py-1 text-atlas-accent"
                      >
                        <ExternalLink className="h-3 w-3" /> Open
                      </button>
                      <button
                        type="button"
                        onClick={() => void window.atlas.downloadAction(d.id, 'reveal')}
                        className="flex items-center gap-1 rounded bg-atlas-elevated px-2 py-1"
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
          <div className="py-12 text-center text-sm text-atlas-muted">No downloads yet.</div>
        )}
      </div>
    </ViewShell>
  );
};

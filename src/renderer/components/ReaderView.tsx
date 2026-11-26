import React, { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, BookOpen, List, Minus, Plus, Trash2, X } from 'lucide-react';
import type { ReaderArticle, ReadingListItem } from '@shared/types';
import { useAtlasStore } from '../store/useAtlasStore';

export const ReaderView: React.FC = () => {
  const { activeTabId, tabs, settings, setOverlayView, pushToast } = useAtlasStore();
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const appIsDark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [article, setArticle] = useState<ReaderArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [fontSize, setFontSize] = useState(18);
  const [width, setWidth] = useState<'narrow' | 'medium' | 'wide'>('medium');
  const [readerTheme, setReaderTheme] = useState<'light' | 'sepia' | 'dark'>(
    appIsDark ? 'dark' : 'light'
  );
  const [progress, setProgress] = useState(0);
  const [showList, setShowList] = useState(false);
  const [readingList, setReadingList] = useState<ReadingListItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadList = async () => {
    try {
      setReadingList(await window.atlas.listReadingList());
    } catch {
      // non-fatal
    }
  };

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    if (!activeTabId) return;
    setLoading(true);
    void window.atlas.extractReaderArticle(activeTabId).then((res) => {
      setArticle(res);
      setLoading(false);
    });
  }, [activeTabId]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 100);
  };

  const surfaceStyles =
    readerTheme === 'light'
      ? 'bg-[#fafaf8] text-[#18181b] border-[#ddddd7]'
      : readerTheme === 'sepia'
      ? 'bg-[#f4eee1] text-[#352b1d] border-[#dfd4be]'
      : 'bg-[#141619] text-[#e6e7ea] border-[#2c2f36]';

  const widthClass =
    width === 'narrow' ? 'max-w-xl' : width === 'wide' ? 'max-w-3xl' : 'max-w-2xl';

  return (
    <div className={`flex h-full flex-col ${surfaceStyles}`}>
      <div className="h-[2px] w-full bg-current/10">
        <div className="h-full bg-atlas-accent transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex h-12 shrink-0 items-center justify-between border-b border-current/10 px-6 text-xs">
        <div className="flex items-center gap-2 font-semibold">
          <BookOpen className="h-4 w-4 text-atlas-accent" strokeWidth={1.75} />
          <span>Reading View</span>
          <span className="font-normal opacity-60">{progress}%</span>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1 rounded-lg border border-current/15 px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => setFontSize((f) => Math.max(14, f - 1))}
              className="rounded p-1 hover:bg-current/10"
              aria-label="Decrease font size"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="w-8 text-center text-[11px]">{fontSize}px</span>
            <button
              type="button"
              onClick={() => setFontSize((f) => Math.min(26, f + 1))}
              className="rounded p-1 hover:bg-current/10"
              aria-label="Increase font size"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          <select
            value={width}
            onChange={(e) => setWidth(e.target.value as 'narrow' | 'medium' | 'wide')}
            className="rounded-lg border border-current/15 bg-transparent px-2 py-1 text-[11.5px] outline-none"
          >
            <option value="narrow">Narrow</option>
            <option value="medium">Comfortable</option>
            <option value="wide">Wide</option>
          </select>

          <select
            value={readerTheme}
            onChange={(e) => setReaderTheme(e.target.value as 'light' | 'sepia' | 'dark')}
            className="rounded-lg border border-current/15 bg-transparent px-2 py-1 text-[11.5px] outline-none"
          >
            <option value="light">Paper Light</option>
            <option value="sepia">Warm Sepia</option>
            <option value="dark">Slate Dark</option>
          </select>

          <button
            type="button"
            disabled={!article || !activeTab || activeTab.isPrivate}
            onClick={async () => {
              if (!article || !activeTab) return;
              try {
                await window.atlas.saveReadingListItem({
                  tabId: activeTab.id,
                  url: activeTab.url,
                  title: article.title,
                  siteName: article.siteName ?? null,
                  excerpt: article.textContent.slice(0, 220),
                  progress
                });
                await loadList();
                pushToast('Saved to Reading List', 'success');
              } catch (err) {
                pushToast(err instanceof Error ? err.message : 'Could not save', 'danger');
              }
            }}
            title={activeTab?.isPrivate ? 'Private tabs are excluded' : 'Save to Reading List'}
            className="flex items-center gap-1 rounded-lg border border-current/15 px-2.5 py-1 text-[11.5px] font-medium hover:bg-current/10 disabled:opacity-40"
          >
            <BookmarkPlus className="h-3.5 w-3.5" /> Save
          </button>

          <button
            type="button"
            onClick={() => setShowList((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-current/15 px-2.5 py-1 text-[11.5px] font-medium hover:bg-current/10"
          >
            <List className="h-3.5 w-3.5" /> Saved ({readingList.length})
          </button>

          <button
            type="button"
            onClick={() => setOverlayView(null)}
            className="rounded-lg p-1.5 opacity-70 hover:bg-current/10 hover:opacity-100"
            aria-label="Exit reading mode"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showList && (
        <div className="border-b border-current/10 bg-current/[0.03] px-6 py-4 text-xs space-y-2 max-h-60 overflow-y-auto">
          <div className="font-semibold">Reading List ({readingList.length})</div>
          {readingList.length === 0 ? (
            <div className="opacity-65">No saved articles yet.</div>
          ) : (
            <div className="divide-y divide-current/10">
              {readingList.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (activeTabId) {
                        await window.atlas.navigate(activeTabId, item.url);
                        setShowList(false);
                      }
                    }}
                    className="min-w-0 flex-1 text-left hover:underline"
                  >
                    <div className="truncate font-medium">{item.title}</div>
                    <div className="truncate text-[10.5px] opacity-65">
                      {item.progress}% · {new Date(item.savedAt).toLocaleDateString()} · {item.url}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await window.atlas.deleteReadingListItem(item.id);
                      await loadList();
                    }}
                    className="opacity-60 hover:opacity-100"
                    aria-label="Remove item"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-8 py-12 select-text">
        {loading ? (
          <div className="text-center text-sm opacity-65">Preparing article...</div>
        ) : !article ? (
          <div className="mx-auto max-w-md text-center text-sm opacity-70">
            No readable article structure found on the active page.
          </div>
        ) : (
          <article className={`mx-auto ${widthClass} space-y-6 font-serif`} style={{ fontSize }}>
            <header className="space-y-2.5 border-b border-current/15 pb-6">
              <h1 className="text-3xl font-bold leading-tight tracking-[-0.02em] font-sans">
                {article.title}
              </h1>
              <div className="flex flex-wrap gap-3 text-xs font-sans opacity-70">
                {article.byline && <span>{article.byline}</span>}
                {article.siteName && <span>{article.siteName}</span>}
                {article.publishedTime && <span>{article.publishedTime}</span>}
              </div>
            </header>
            <div
              className="leading-[1.72] space-y-4"
              dangerouslySetInnerHTML={{ __html: article.contentHtml }}
            />
          </article>
        )}
      </div>
    </div>
  );
};

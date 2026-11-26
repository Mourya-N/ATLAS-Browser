import React, { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, BookOpen, List, Minus, Plus, Trash2, X } from 'lucide-react';
import type { ReaderArticle, ReadingListItem } from '@shared/types';
import { useAtlasStore } from '../store/useAtlasStore';

export const ReaderView: React.FC = () => {
  const { activeTabId, tabs, setOverlayView, pushToast } = useAtlasStore();
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const [article, setArticle] = useState<ReaderArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [fontSize, setFontSize] = useState(18);
  const [width, setWidth] = useState<'narrow' | 'medium' | 'wide'>('medium');
  const [readerTheme, setReaderTheme] = useState<'dark' | 'light' | 'sepia'>('dark');
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

  const themeClasses =
    readerTheme === 'light'
      ? 'bg-white text-slate-900'
      : readerTheme === 'sepia'
      ? 'bg-[#f4ecd8] text-[#3b2f1e]'
      : 'bg-[#0f172a] text-slate-100';

  const widthClass =
    width === 'narrow' ? 'max-w-xl' : width === 'wide' ? 'max-w-4xl' : 'max-w-2xl';

  return (
    <div className={`flex h-full flex-col ${themeClasses}`}>
      <div className="h-1 w-full bg-atlas-border">
        <div className="h-full bg-atlas-accent transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex items-center justify-between border-b border-atlas-border/40 px-6 py-3 text-xs">
        <div className="flex items-center gap-2 font-semibold">
          <BookOpen className="h-4 w-4 text-atlas-accent" />
          <span>Reading Mode</span>
          <span className="opacity-60">({progress}%)</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setFontSize((f) => Math.max(13, f - 1))} className="rounded p-1 hover:bg-black/10">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-8 text-center">{fontSize}px</span>
            <button type="button" onClick={() => setFontSize((f) => Math.min(28, f + 1))} className="rounded p-1 hover:bg-black/10">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <select
            value={width}
            onChange={(e) => setWidth(e.target.value as 'narrow' | 'medium' | 'wide')}
            className="rounded border border-atlas-border/50 bg-transparent px-2 py-1"
          >
            <option value="narrow">Narrow</option>
            <option value="medium">Medium</option>
            <option value="wide">Wide</option>
          </select>

          <select
            value={readerTheme}
            onChange={(e) => setReaderTheme(e.target.value as 'dark' | 'light' | 'sepia')}
            className="rounded border border-atlas-border/50 bg-transparent px-2 py-1"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="sepia">Sepia</option>
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
                pushToast('Saved to local Reading List', 'success');
              } catch (err) {
                pushToast(err instanceof Error ? err.message : 'Could not save', 'danger');
              }
            }}
            title={activeTab?.isPrivate ? 'Private tabs are not saved to Reading List' : 'Save to Reading List'}
            className="flex items-center gap-1 rounded border border-atlas-border/50 px-2 py-1 hover:bg-black/10 disabled:opacity-40"
          >
            <BookmarkPlus className="h-3.5 w-3.5" /> Save
          </button>

          <button
            type="button"
            onClick={() => setShowList((v) => !v)}
            className="flex items-center gap-1 rounded border border-atlas-border/50 px-2 py-1 hover:bg-black/10"
          >
            <List className="h-3.5 w-3.5" /> List ({readingList.length})
          </button>

          <button
            type="button"
            onClick={() => setOverlayView(null)}
            className="rounded-lg p-1.5 hover:bg-black/10"
            aria-label="Exit reading mode"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showList && (
        <div className="border-b border-atlas-border/40 bg-black/20 px-6 py-4 text-xs space-y-2 max-h-64 overflow-y-auto">
          <div className="font-semibold">Local Reading List ({readingList.length})</div>
          {readingList.length === 0 ? (
            <div className="opacity-70">Your Reading List is empty. Click "Save" on any non-private article to read it later.</div>
          ) : (
            <div className="space-y-1.5">
              {readingList.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-atlas-border/40 px-3 py-2">
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
                    <div className="truncate text-[10px] opacity-70">
                      {item.status} • {item.progress}% • {new Date(item.savedAt).toLocaleDateString()} • {item.url}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await window.atlas.deleteReadingListItem(item.id);
                      await loadList();
                    }}
                    className="opacity-70 hover:opacity-100"
                    aria-label="Remove from reading list"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-10 select-text">
        {loading ? (
          <div className="text-center text-sm opacity-70">Extracting article content...</div>
        ) : !article ? (
          <div className="mx-auto max-w-md text-center text-sm opacity-75">
            Could not extract a readable article from the current page.
          </div>
        ) : (
          <article className={`mx-auto ${widthClass} space-y-6`} style={{ fontSize }}>
            <header className="space-y-2 border-b border-atlas-border/40 pb-5">
              <h1 className="text-3xl font-bold leading-tight">{article.title}</h1>
              <div className="flex flex-wrap gap-3 text-xs opacity-75">
                {article.byline && <span>By {article.byline}</span>}
                {article.siteName && <span>{article.siteName}</span>}
                {article.publishedTime && <span>{article.publishedTime}</span>}
              </div>
            </header>
            <div
              className="prose prose-invert max-w-none leading-relaxed space-y-4"
              dangerouslySetInnerHTML={{ __html: article.contentHtml }}
            />
          </article>
        )}
      </div>
    </div>
  );
};

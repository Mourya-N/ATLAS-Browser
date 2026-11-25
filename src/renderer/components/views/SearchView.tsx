import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Cloud,
  ExternalLink,
  FolderPlus,
  GitCompare,
  Globe,
  HardDrive,
  Search,
  Sparkles,
  X
} from 'lucide-react';
import type { SearchMode, SearchResponse } from '@shared/types';
import { useAtlasStore } from '../../store/useAtlasStore';

const MODES: Array<{ id: SearchMode; label: string }> = [
  { id: 'web', label: 'Web' },
  { id: 'news', label: 'News' },
  { id: 'docs', label: 'Tech Docs' },
  { id: 'research', label: 'Research' },
  { id: 'current_page', label: 'Current Page' },
  { id: 'cross_tab', label: 'Cross-Tab' },
  { id: 'personal_knowledge', label: 'Personal Knowledge' }
];

export const SearchView: React.FC = () => {
  const {
    activeTabId,
    searchInitialQuery,
    setOverlayView,
    pushToast
  } = useAtlasStore();

  const [query, setQuery] = useState(searchInitialQuery || '');
  const [mode, setMode] = useState<SearchMode>('research');
  const [timeRange, setTimeRange] = useState<'any' | 'day' | 'week' | 'month' | 'year'>('any');
  const [domainFilter, setDomainFilter] = useState('');
  const [includeOpenTabs, setIncludeOpenTabs] = useState(true);
  const [includePersonalKnowledge, setIncludePersonalKnowledge] = useState(true);
  const [includeAiAnswer, setIncludeAiAnswer] = useState(true);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [showPassages, setShowPassages] = useState(false);

  const runSearch = async (overrideQuery?: string, overrideMode?: SearchMode) => {
    const q = (overrideQuery ?? query).trim();
    if (!q) return;
    setLoading(true);
    try {
      const domains = domainFilter
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await window.atlas.executeSearch({
        query: q,
        mode: overrideMode ?? mode,
        filters: {
          domains: domains.length > 0 ? domains : undefined,
          timeRange,
          includeOpenTabs,
          includePersonalKnowledge,
          includeAiAnswer,
          limit: 15
        }
      });
      setResponse(res);
      setSelectedUrls([]);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Search failed', 'danger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (searchInitialQuery.trim()) {
      setQuery(searchInitialQuery);
      void runSearch(searchInitialQuery);
    }
  }, [searchInitialQuery]);

  const toggleSelect = (url: string) => {
    setSelectedUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  const openInCurrentTab = async (url: string) => {
    if (!activeTabId) {
      await window.atlas.createTab({ url, activate: true });
    } else {
      await window.atlas.navigate(activeTabId, url);
    }
    setOverlayView(null);
  };

  const openInNewTab = async (url: string) => {
    await window.atlas.createTab({ url, activate: true });
    setOverlayView(null);
  };

  const openSelectedInGroup = async () => {
    const urls = selectedUrls.filter((u) => u.startsWith('http://') || u.startsWith('https://'));
    if (urls.length === 0) {
      pushToast('Select one or more HTTP/HTTPS results first', 'warning');
      return;
    }
    await window.atlas.openSearchGroup(`Search: ${query.slice(0, 28)}`, urls);
    pushToast(`Opened ${urls.length} result(s) in a tab group`, 'success');
    setOverlayView(null);
  };

  const compareSelected = async () => {
    const urls = selectedUrls.filter((u) => u.startsWith('http://') || u.startsWith('https://'));
    if (urls.length < 2) {
      pushToast('Select at least 2 web results to compare', 'warning');
      return;
    }
    const { tabs } = await window.atlas.openSearchGroup(`Compare: ${query.slice(0, 20)}`, urls.slice(0, 5));
    const md = await window.atlas.compareCrossTabs(
      `Compare selected search results for: ${query}`,
      tabs.map((t) => t.id)
    );
    await window.atlas.saveCloudNote({
      title: `Comparison: ${query}`,
      content: md,
      tags: ['comparison', 'atlas-search']
    }).catch(() => undefined);
    setOverlayView('intelligence');
    pushToast('Opened selected results and generated cross-tab comparison', 'success');
  };

  const saveSelectedToResearch = async () => {
    if (!response) return;
    const chosen =
      selectedUrls.length > 0
        ? response.results.filter((r) => selectedUrls.includes(r.url))
        : response.results.slice(0, 4);
    if (chosen.length === 0) return;

    await window.atlas.saveSearchToResearch(
      query,
      chosen.map((c) => ({ url: c.url, title: c.title, snippet: c.snippet }))
    );
    pushToast('Saved search results to Research & Evidence collection', 'success');
  };

  return (
    <div className="flex h-full flex-col bg-atlas-bg text-atlas-text select-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-atlas-border bg-atlas-surface px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <Search className="h-5 w-5 text-atlas-accent" />
          <h1 className="text-base font-bold">Atlas Intelligent Search</h1>
          {response && (
            <span className="flex items-center gap-1 rounded-full bg-atlas-elevated px-2.5 py-0.5 text-[10px] font-medium text-atlas-muted">
              {response.sourceMode === 'local_fallback' ? (
                <>
                  <HardDrive className="h-3 w-3" /> Local-First Mode
                </>
              ) : (
                <>
                  <Cloud className="h-3 w-3 text-atlas-accent" /> {response.sourceMode === 'hybrid' ? 'Hybrid Cloud + Local' : 'Atlas Cloud'}
                </>
              )}
              {response.cacheHit && ' • Cached'}
              {` • ${response.latencyMs}ms`}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOverlayView(null)}
          className="rounded-lg p-1.5 text-atlas-muted hover:bg-atlas-elevated"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search Bar & Modes */}
      <div className="border-b border-atlas-border bg-atlas-surface/60 px-6 py-4 space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
          className="flex gap-2 max-w-5xl"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a research question or search across the web, open tabs, and personal knowledge..."
            className="flex-1 rounded-xl border border-atlas-border bg-atlas-bg px-4 py-2.5 text-sm outline-none focus:border-atlas-accent"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-xl bg-atlas-accent px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-1.5 text-xs max-w-5xl">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                if (query.trim()) void runSearch(query, m.id);
              }}
              className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                mode === m.id
                  ? 'bg-atlas-accent text-white'
                  : 'bg-atlas-elevated text-atlas-muted hover:text-atlas-text'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-atlas-muted max-w-5xl">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as typeof timeRange)}
            className="rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1 text-atlas-text"
          >
            <option value="any">Any time</option>
            <option value="day">Past 24h</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
            <option value="year">Past year</option>
          </select>

          <input
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            placeholder="Filter domains (e.g. postgresql.org, owasp.org)"
            className="w-64 rounded-lg border border-atlas-border bg-atlas-bg px-2.5 py-1 text-atlas-text outline-none"
          />

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeOpenTabs}
              onChange={(e) => setIncludeOpenTabs(e.target.checked)}
            />
            Include non-private open tabs
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includePersonalKnowledge}
              onChange={(e) => setIncludePersonalKnowledge(e.target.checked)}
            />
            Include bookmarks & memory
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeAiAnswer}
              onChange={(e) => setIncludeAiAnswer(e.target.checked)}
            />
            AI answer with citations
          </label>
        </div>
      </div>

      {/* Results Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {!response ? (
          <div className="mx-auto max-w-3xl rounded-xl border border-atlas-border bg-atlas-surface p-6 text-xs text-atlas-muted space-y-2">
            <div className="font-semibold text-atlas-text">Atlas Hybrid Search Engine</div>
            <p>
              Combines configured search APIs, authorized non-private tabs, local bookmarks, approved memory, and cited AI synthesis. Private tabs are always excluded from cloud requests, and conventional results remain available even if AI generation is disabled or fails.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
            {/* Left / Main Column: Ranked Results */}
            <div className="lg:col-span-2 space-y-4">
              {/* Selection Actions & Query Info */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-atlas-border bg-atlas-surface p-3">
                <div className="text-[11px] text-atlas-muted">
                  <strong>{response.results.length}</strong> result(s)
                  {response.duplicatesRemoved > 0 && ` • ${response.duplicatesRemoved} duplicate(s) merged`}
                  {response.reranked && ' • Reranked'}
                  {' • Intent: '}
                  <span className="text-atlas-text">{response.understanding.intent}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void openSelectedInGroup()}
                    className="flex items-center gap-1 rounded-lg bg-atlas-elevated px-2.5 py-1 font-medium hover:bg-atlas-border"
                  >
                    <FolderPlus className="h-3.5 w-3.5" /> Open in Group ({selectedUrls.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => void compareSelected()}
                    className="flex items-center gap-1 rounded-lg bg-atlas-elevated px-2.5 py-1 font-medium hover:bg-atlas-border"
                  >
                    <GitCompare className="h-3.5 w-3.5" /> Compare Selected
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveSelectedToResearch()}
                    className="flex items-center gap-1 rounded-lg bg-atlas-accent/15 text-atlas-accent px-2.5 py-1 font-medium hover:bg-atlas-accent/25"
                  >
                    <BookOpenCheck className="h-3.5 w-3.5" /> Save to Research
                  </button>
                </div>
              </div>

              {response.providerErrors.length > 0 && (
                <div className="rounded-xl border border-atlas-warning/40 bg-atlas-warning/10 p-3 text-[11px] text-atlas-warning">
                  Partial provider notice:{' '}
                  {response.providerErrors.map((e) => `${e.providerId} (${e.error})`).join('; ')}
                </div>
              )}

              {response.suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-atlas-muted">Suggestions:</span>
                  {response.suggestions.map((s) => (
                    <button
                      key={s.text}
                      type="button"
                      onClick={() => {
                        setQuery(s.text);
                        void runSearch(s.text);
                      }}
                      className="rounded-full border border-atlas-border bg-atlas-surface px-2.5 py-0.5 hover:border-atlas-accent"
                    >
                      {s.text}
                    </button>
                  ))}
                </div>
              )}

              {response.results.length === 0 ? (
                <div className="rounded-xl border border-atlas-border bg-atlas-surface p-6 text-center text-atlas-muted">
                  No results matched your query and filters. Enable external search providers in Settings or add local bookmarks/memory/tabs.
                </div>
              ) : (
                <div className="space-y-3">
                  {response.results.map((r) => {
                    const checked = selectedUrls.includes(r.url);
                    return (
                      <div
                        key={r.id}
                        className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-2 hover:border-atlas-accent/50 transition-colors"
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelect(r.url)}
                            className="mt-1"
                            aria-label={`Select ${r.title}`}
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-2 text-[11px] text-atlas-muted">
                              <span className="flex items-center gap-1.5 truncate">
                                <Globe className="h-3 w-3 shrink-0" />
                                <span className="font-medium text-atlas-text">{r.domain}</span>
                                <span>• {r.displayUrl}</span>
                              </span>
                              <span className="shrink-0 rounded bg-atlas-elevated px-1.5 py-0.5 text-[10px]">
                                {r.sourceProvider} • {r.contentType} • {Math.round(r.relevanceScore * 100)}%
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => void openInCurrentTab(r.url)}
                              className="text-left text-sm font-semibold text-atlas-accent hover:underline"
                            >
                              {r.title}
                            </button>

                            <p className="text-atlas-muted leading-relaxed">{r.snippet}</p>

                            <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px]">
                              {r.publishedAt && (
                                <span className="text-atlas-muted">Published: {r.publishedAt}</span>
                              )}
                              <button
                                type="button"
                                onClick={() => void openInCurrentTab(r.url)}
                                className="text-atlas-text hover:text-atlas-accent"
                              >
                                Open here
                              </button>
                              <button
                                type="button"
                                onClick={() => void openInNewTab(r.url)}
                                className="flex items-center gap-1 text-atlas-text hover:text-atlas-accent"
                              >
                                <ExternalLink className="h-3 w-3" /> New tab
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {response.relatedQueries.length > 0 && (
                <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-2">
                  <div className="font-semibold">Related Queries</div>
                  <div className="flex flex-wrap gap-2">
                    {response.relatedQueries.map((rq) => (
                      <button
                        key={rq}
                        type="button"
                        onClick={() => {
                          setQuery(rq);
                          void runSearch(rq);
                        }}
                        className="rounded-lg border border-atlas-border bg-atlas-bg px-3 py-1.5 hover:border-atlas-accent"
                      >
                        {rq}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: AI Cited Answer */}
            <div className="space-y-4">
              {response.aiAnswer && (
                <div className="rounded-xl border border-atlas-border bg-atlas-surface p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold">
                      <Sparkles className="h-4 w-4 text-atlas-accent" />
                      AI Cited Answer
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        response.aiAnswer.status === 'ok'
                          ? 'bg-atlas-success/15 text-atlas-success'
                          : 'bg-atlas-warning/15 text-atlas-warning'
                      }`}
                    >
                      {response.aiAnswer.status}
                    </span>
                  </div>

                  <p className="leading-relaxed text-atlas-text whitespace-pre-wrap">
                    {response.aiAnswer.summary}
                  </p>

                  {response.aiAnswer.contradictions.length > 0 && (
                    <div className="rounded-lg border border-atlas-warning/40 bg-atlas-warning/10 p-2.5 space-y-1 text-[11px]">
                      <div className="flex items-center gap-1 font-semibold text-atlas-warning">
                        <AlertTriangle className="h-3.5 w-3.5" /> Contradicting Claims Detected
                      </div>
                      {response.aiAnswer.contradictions.map((c, idx) => (
                        <div key={idx} className="text-atlas-text">
                          <strong>{c.topic}:</strong> {c.claimA} vs {c.claimB}
                        </div>
                      ))}
                    </div>
                  )}

                  {response.aiAnswer.claims.length > 0 && (
                    <div className="space-y-2">
                      <div className="font-semibold text-[11px] uppercase tracking-wide text-atlas-muted">
                        Verified Claims & Evidence
                      </div>
                      {response.aiAnswer.claims.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-lg border border-atlas-border bg-atlas-bg/60 p-2.5 space-y-1 text-[11px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="rounded bg-atlas-elevated px-1.5 py-0.5 text-[10px] uppercase">
                              {c.kind}
                            </span>
                            {c.verifiedAgainstSource && (
                              <span className="flex items-center gap-1 text-atlas-success text-[10px]">
                                <CheckCircle2 className="h-3 w-3" /> Source Verified
                              </span>
                            )}
                          </div>
                          <div>{c.statement}</div>
                          {c.supportingQuote && (
                            <blockquote className="border-l-2 border-atlas-accent pl-2 italic text-atlas-muted">
                              "{c.supportingQuote}"
                            </blockquote>
                          )}
                          <button
                            type="button"
                            onClick={() => void openInNewTab(c.sourceUrl)}
                            className="text-atlas-accent hover:underline truncate block max-w-full"
                          >
                            {c.sourceTitle}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {response.aiAnswer.citations.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-atlas-border text-[11px]">
                      <div className="font-semibold text-atlas-muted">Sources Cited</div>
                      {response.aiAnswer.citations.map((cit) => (
                        <button
                          key={cit.url}
                          type="button"
                          onClick={() => void openInNewTab(cit.url)}
                          className="flex w-full items-center gap-1.5 text-left text-atlas-accent hover:underline truncate"
                        >
                          <span>[{cit.index}]</span>
                          <span className="truncate">{cit.title} ({cit.domain})</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {response.aiAnswer.passages.length > 0 && (
                    <div className="pt-1 border-t border-atlas-border">
                      <button
                        type="button"
                        onClick={() => setShowPassages((v) => !v)}
                        className="text-[11px] font-semibold text-atlas-accent hover:underline"
                      >
                        {showPassages
                          ? 'Hide inspected source passages'
                          : `Inspect ${response.aiAnswer.passages.length} source passage(s)`}
                      </button>
                      {showPassages && (
                        <div className="mt-2 space-y-2 max-h-72 overflow-y-auto">
                          {response.aiAnswer.passages.map((p, i) => (
                            <div
                              key={`${p.sourceUrl}-${i}`}
                              className="rounded-lg border border-atlas-border bg-atlas-bg p-2 text-[11px] space-y-1"
                            >
                              <div className="font-semibold truncate">{p.sourceTitle}</div>
                              <p className="text-atlas-muted">{p.excerpt}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

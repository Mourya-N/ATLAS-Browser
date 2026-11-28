import React, { useEffect, useRef, useState } from 'react';
import {
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  MapPin,
  Mic,
  Minus,
  Play,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import type { NormalizedSearchResult, OmniboxSuggestion, SearchResponse } from '@shared/types';
import { useLavrayStore } from '../store/useLavrayStore';
import { LavrayMark } from './BrandMarks';

export interface WebSearchViewProps {
  tabQuery: string;
}

type WebTabMode = 'web' | 'images' | 'videos' | 'maps' | 'shopping' | 'news' | 'docs';

const WEB_TABS: Array<{ id: WebTabMode; label: string }> = [
  { id: 'web', label: 'All' },
  { id: 'images', label: 'Images' },
  { id: 'videos', label: 'Videos' },
  { id: 'maps', label: 'Maps' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'news', label: 'News' },
  { id: 'docs', label: 'Docs & Code' }
];

function formatDuration(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getOsmSlippyTiles(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const xFloat = ((lon + 180) / 360) * n;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const centerX = Math.floor(xFloat);
  const centerY = Math.max(0, Math.min(n - 1, Math.floor(yFloat)));
  const pinLeftPct = ((1 + (xFloat - centerX)) / 3) * 100;
  const pinTopPct = ((1 + (yFloat - centerY)) / 3) * 100;
  const tiles: Array<{ key: string; url: string }> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = (((centerX + dx) % n) + n) % n;
      const ty = Math.max(0, Math.min(n - 1, centerY + dy));
      tiles.push({
        key: `${zoom}-${tx}-${ty}-${dx}-${dy}`,
        url: `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`
      });
    }
  }
  return { tiles, pinLeftPct, pinTopPct };
}

function formatBreadcrumb(url: string, domain: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 3)
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });
    return segments.length > 0 ? `${parsed.origin} › ${segments.join(' › ')}` : parsed.origin;
  } catch {
    return domain;
  }
}

function getSiteDisplayName(domain: string): string {
  const clean = domain.replace(/^www\./, '');
  const label = clean.split('.')[0] || clean;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Safely renders **bold** and numeric/currency emphasis inside AI Overview lines without dangerouslySetInnerHTML.
 */
function RichInlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <strong key={i} className="font-semibold text-lavray-text">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

function HighlightedSnippet({ text, terms }: { text: string; terms: string[] }) {
  const cleanTerms = Array.from(new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2))).slice(0, 8);
  if (cleanTerms.length === 0) return <>{text}</>;

  const escaped = cleanTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const rx = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  const parts = text.split(rx);
  const termSet = new Set(cleanTerms);

  return (
    <>
      {parts.map((part, idx) =>
        termSet.has(part.toLowerCase()) ? (
          <strong key={idx} className="font-semibold text-lavray-text">
            {part}
          </strong>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

function SiteFavicon({ favicon, domain, size = 'md' }: { favicon?: string | null; domain: string; size?: 'sm' | 'md' }) {
  const [broken, setBroken] = useState(false);
  const monogram = (domain.replace(/^www\./, '').match(/[A-Za-z0-9]/)?.[0] || 'W').toUpperCase();
  const boxCls = size === 'sm' ? 'h-5 w-5 text-[9.5px]' : 'h-7 w-7 text-[11px]';
  const imgCls = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  if (!favicon || broken) {
    return (
      <span
        className={`flex ${boxCls} shrink-0 items-center justify-center rounded-full border border-lavray-border bg-lavray-surface font-semibold text-lavray-secondary`}
      >
        {monogram}
      </span>
    );
  }
  return (
    <span
      className={`flex ${boxCls} shrink-0 items-center justify-center overflow-hidden rounded-full border border-lavray-border bg-lavray-surface`}
    >
      <img src={favicon} alt="" className={`${imgCls} object-contain`} onError={() => setBroken(true)} />
    </span>
  );
}

export const WebSearchView: React.FC<WebSearchViewProps> = ({ tabQuery }) => {
  const { activeTabId, openLavraySearch } = useLavrayStore();

  const [input, setInput] = useState(tabQuery);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<OmniboxSuggestion[]>([]);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [selectedSugIdx, setSelectedSugIdx] = useState(-1);

  const [mode, setMode] = useState<WebTabMode>('web');
  const [showTools, setShowTools] = useState(false);
  const [timeRange, setTimeRange] = useState<'any' | 'day' | 'week' | 'month' | 'year'>('any');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [selectedImage, setSelectedImage] = useState<NormalizedSearchResult | null>(null);
  const [selectedMapPlace, setSelectedMapPlace] = useState<NormalizedSearchResult | null>(null);
  const [mapZoom, setMapZoom] = useState(13);
  const searchSeqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void window.lavray
      .listSearchHistory()
      .then((hist) => setRecentQueries(Array.from(new Set(hist.map((h) => h.query))).slice(0, 6)))
      .catch(() => {});
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedImage(null);
      }
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const runWebSearch = async (
    q: string,
    targetMode: WebTabMode = mode,
    targetPage = 1,
    targetRange = timeRange,
    disableTypoCorrection = false
  ) => {
    const trimmed = q.trim();
    if (!trimmed) {
      searchSeqRef.current += 1;
      setResponse(null);
      setSelectedImage(null);
      setSelectedMapPlace(null);
      return;
    }
    const seq = ++searchSeqRef.current;
    const pageLimit = targetMode === 'images' || targetMode === 'videos' ? 18 : 10;
    setLoading(true);
    setOverviewLoading(false);
    setOverviewExpanded(false);
    setSelectedImage(null);
    setSelectedMapPlace(null);
    setErrorMsg(null);
    setPage(targetPage);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }

    try {
      // Phase 1: Fast organic web results (non-blocking)
      const fastRes = await window.lavray.executeSearch({
        query: trimmed,
        mode: targetMode,
        filters: {
          timeRange: targetRange,
          page: targetPage,
          limit: pageLimit,
          includeOpenTabs: false,
          includePersonalKnowledge: false,
          includeAiAnswer: false,
          disableTypoCorrection
        }
      });
      if (seq !== searchSeqRef.current) return;
      setResponse(fastRes);
      if (targetMode === 'maps') {
        const firstGeo = fastRes.results.find((r) => Boolean(r.coordinates)) ?? null;
        setSelectedMapPlace(firstGeo);
        setMapZoom(13);
      }
      setLoading(false);

      // Phase 2: Google-style AI Overview for page 1 of "All" web queries (non-navigational, non-tool)
      const isTool = Boolean(fastRes.instantAnswer?.kind && fastRes.instantAnswer.kind !== 'entity');
      const shouldFetchOverview =
        targetMode === 'web' &&
        targetPage === 1 &&
        !isTool &&
        fastRes.understanding.intent !== 'navigational' &&
        (fastRes.results.length > 0 || Boolean(fastRes.instantAnswer));

      if (shouldFetchOverview) {
        setOverviewLoading(true);
        const aiRes = await window.lavray.executeSearch({
          query: trimmed,
          mode: targetMode,
          filters: {
            timeRange: targetRange,
            page: targetPage,
            limit: 10,
            includeOpenTabs: false,
            includePersonalKnowledge: false,
            includeAiAnswer: true,
            disableTypoCorrection
          }
        });
        if (seq !== searchSeqRef.current) return;
        setResponse(aiRes);
        setOverviewLoading(false);
      }
    } catch (err) {
      if (seq !== searchSeqRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : 'Search failed');
      setOverviewLoading(false);
    } finally {
      if (seq === searchSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    setInput(tabQuery);
    setSuggestions([]);
    setSelectedSugIdx(-1);
    if (tabQuery.trim()) {
      void runWebSearch(tabQuery, mode, 1, timeRange, false);
    } else {
      setResponse(null);
    }
  }, [tabQuery]);

  const handleInputChange = async (val: string) => {
    setInput(val);
    setSelectedSugIdx(-1);
    const trimmed = val.trim();
    if (!trimmed) {
      setSuggestions([]);
      return;
    }
    try {
      const omnibox = await window.lavray.getSuggestions(trimmed);
      const historyMatches: OmniboxSuggestion[] = recentQueries
        .filter((rq) => rq.toLowerCase().includes(trimmed.toLowerCase()) && rq.toLowerCase() !== trimmed.toLowerCase())
        .slice(0, 3)
        .map((rq) => ({
          type: 'search',
          title: rq,
          url: `lavray://search?q=${encodeURIComponent(rq)}`,
          subtitle: 'Recent search'
        }));
      const merged = [...historyMatches, ...omnibox.filter((o) => o.type !== 'search')].slice(0, 6);
      setSuggestions(merged);
    } catch {
      setSuggestions([]);
    }
  };

  const submitQuery = (raw: string, disableTypoCorrection = false) => {
    const q = raw.trim();
    if (!q) return;
    setFocused(false);
    setSuggestions([]);
    if (activeTabId && q !== tabQuery.trim()) {
      void window.lavray.navigate(activeTabId, `lavray://search?q=${encodeURIComponent(q)}`);
    } else {
      void runWebSearch(q, mode, 1, timeRange, disableTypoCorrection);
    }
  };

  const openUrl = async (url: string, newTab = false) => {
    if (newTab || !activeTabId) {
      await window.lavray.createTab({ url, activate: true });
    } else {
      await window.lavray.navigate(activeTabId, url);
    }
  };

  const toggleVoiceSearch = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;
    if (!SpeechRec || listening) return;
    try {
      const rec = new SpeechRec();
      rec.lang = 'en-US';
      rec.interimResults = false;
      setListening(true);
      rec.onresult = (ev: any) => {
        const transcript = String(ev?.results?.[0]?.[0]?.transcript || '').trim();
        if (transcript) {
          setInput(transcript);
          submitQuery(transcript);
        }
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      rec.start();
    } catch {
      setListening(false);
    }
  };

  const toggleSpeakOverview = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const clean = text.replace(/\*\*/g, '').replace(/^- /gm, '');
    const utter = new SpeechSynthesisUtterance(clean);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!focused || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSugIdx((idx) => (idx + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSugIdx((idx) => (idx <= 0 ? suggestions.length - 1 : idx - 1));
    } else if (e.key === 'Enter' && selectedSugIdx >= 0) {
      e.preventDefault();
      const chosen = suggestions[selectedSugIdx];
      if (chosen.type === 'search') submitQuery(chosen.title);
      else void openUrl(chosen.url);
    } else if (e.key === 'Escape') {
      setFocused(false);
    }
  };

  const highlightTerms = response?.understanding.coreTokens ?? input.split(/\s+/);

  if (!tabQuery.trim() && !response && !loading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-lavray-bg px-6 text-lavray-text select-text">
        <div className="w-full max-w-xl -mt-12 space-y-6 text-center">
          <div className="inline-flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-lavray-border bg-lavray-surface text-lavray-accent shadow-lavray-sm">
              <LavrayMark className="h-5 w-5" />
            </span>
            <h1 className="text-[28px] font-semibold tracking-[-0.03em]">LAVRAY Search</h1>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitQuery(input);
            }}
            className="relative text-left"
          >
            <div className="flex items-center gap-2 rounded-full border border-lavray-border bg-lavray-surface px-4 py-2.5 shadow-lavray-sm focus-within:border-lavray-accent focus-within:ring-2 focus-within:ring-lavray-accent/15 transition-all">
              <Search className="h-4 w-4 text-lavray-muted shrink-0" strokeWidth={1.75} />
              <input
                ref={inputRef}
                autoFocus
                value={input}
                onFocus={() => setFocused(true)}
                onBlur={() => setTimeout(() => setFocused(false), 160)}
                onChange={(e) => void handleInputChange(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search the web or ask anything..."
                className="flex-1 bg-transparent text-[14.5px] text-lavray-text placeholder:text-lavray-muted outline-none"
              />
              {input && (
                <button
                  type="button"
                  onClick={() => {
                    setInput('');
                    setSuggestions([]);
                  }}
                  aria-label="Clear search"
                  className="rounded-full p-1 text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleVoiceSearch}
                title="Voice search"
                aria-label="Voice search"
                className={`rounded-full p-1 transition-colors ${
                  listening ? 'text-lavray-danger bg-lavray-danger/10' : 'text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text'
                }`}
              >
                <Mic className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            {focused && suggestions.length > 0 && (
              <div className="lavray-glass absolute left-0 right-0 top-12 z-30 rounded-2xl border border-lavray-border p-1.5 shadow-lavray-float">
                {suggestions.map((s, idx) => (
                  <button
                    key={`${s.url}-${idx}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (s.type === 'search') submitQuery(s.title);
                      else void openUrl(s.url);
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition-colors ${
                      idx === selectedSugIdx ? 'bg-lavray-accent/12 text-lavray-accent' : 'hover:bg-lavray-elevated/80'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Search className="h-3.5 w-3.5 text-lavray-muted shrink-0" />
                      <span className="truncate">{s.title}</span>
                    </span>
                    <span className="text-[11px] text-lavray-muted shrink-0">{s.subtitle}</span>
                  </button>
                ))}
              </div>
            )}
          </form>

          <p className="text-[12px] text-lavray-muted">
            Fast, private web search with AI Overviews. Need deep multi-source research?{' '}
            <button
              type="button"
              onClick={() => openLavraySearch(input.trim())}
              className="font-medium text-lavray-accent hover:underline"
            >
              Switch to AI Mode (LAVRAY Intelligent Search)
            </button>
          </p>
        </div>
      </div>
    );
  }

  const instant = response?.instantAnswer ?? null;
  const isPositionZeroTool = instant && instant.kind && instant.kind !== 'entity';
  const isKnowledgePanel = instant && (!instant.kind || instant.kind === 'entity');
  const aiOverview = response?.aiAnswer && response.aiAnswer.status === 'ok' ? response.aiAnswer : null;
  const showAiOverviewSection =
    mode === 'web' &&
    page === 1 &&
    !isPositionZeroTool &&
    (overviewLoading || Boolean(aiOverview));

  const overviewLines = (aiOverview?.summary || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const overviewBullets = overviewLines.filter((l) => /^[-•*]\s+/.test(l));
  const overviewParagraphs = overviewLines.filter((l) => !/^[-•*]\s+/.test(l));
  const overviewSourceCards = (aiOverview?.citations?.length
    ? aiOverview.citations.map((c) => {
        const matched = response?.results.find((r) => r.url === c.url);
        return {
          url: c.url,
          title: c.title,
          domain: c.domain,
          favicon: matched?.favicon,
          snippet: matched?.snippet || '',
          publishedAt: matched?.publishedAt
        };
      })
    : (response?.results ?? []).slice(0, 3).map((r) => ({
        url: r.url,
        title: r.title,
        domain: r.domain,
        favicon: r.favicon,
        snippet: r.snippet,
        publishedAt: r.publishedAt
      }))
  ).slice(0, 3);

  const isMediaVertical = ['images', 'videos', 'maps', 'shopping'].includes(mode);
  const showKnowledgePanel = Boolean(isKnowledgePanel && !isMediaVertical);
  const activeMapPlace =
    mode === 'maps'
      ? selectedMapPlace ?? response?.results.find((r) => Boolean(r.coordinates)) ?? response?.results[0] ?? null
      : null;

  const isLongOverview = (aiOverview?.summary.length ?? 0) > 260 || overviewBullets.length > 2;

  return (
    <div className="flex h-full w-full flex-col bg-lavray-bg text-lavray-text select-text overflow-y-auto">
      {/* Google-style Sticky Search Header */}
      <div className="sticky top-0 z-10 border-b border-lavray-border bg-lavray-surface px-6 pt-3.5">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => {
              if (activeTabId) void window.lavray.navigate(activeTabId, 'lavray://search');
            }}
            className="flex items-center gap-2 text-lavray-text hover:opacity-85 transition-opacity shrink-0"
            title="LAVRAY Search"
          >
            <LavrayMark className="h-5 w-5 text-lavray-accent" />
            <span className="text-[15px] font-semibold tracking-[-0.02em]">LAVRAY</span>
          </button>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitQuery(input);
            }}
            className="relative flex-1 max-w-2xl"
          >
            <div className="flex items-center gap-2 rounded-full border border-lavray-border bg-lavray-bg px-4 py-1.5 shadow-lavray-sm focus-within:border-lavray-accent focus-within:ring-2 focus-within:ring-lavray-accent/15 transition-all">
              <input
                ref={inputRef}
                value={input}
                onFocus={() => setFocused(true)}
                onBlur={() => setTimeout(() => setFocused(false), 160)}
                onChange={(e) => void handleInputChange(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search the web..."
                className="flex-1 bg-transparent text-[14px] text-lavray-text placeholder:text-lavray-muted outline-none"
              />
              {input && (
                <button
                  type="button"
                  onClick={() => {
                    setInput('');
                    setSuggestions([]);
                  }}
                  aria-label="Clear query"
                  className="rounded-full p-1 text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleVoiceSearch}
                title="Voice search"
                aria-label="Voice search"
                className={`rounded-full p-1 transition-colors ${
                  listening ? 'text-lavray-danger bg-lavray-danger/10' : 'text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text'
                }`}
              >
                <Mic className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <button
                type="submit"
                aria-label="Search"
                className="rounded-full p-1 text-lavray-accent hover:bg-lavray-accent/10 transition-colors"
              >
                <Search className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            {focused && suggestions.length > 0 && (
              <div className="lavray-glass absolute left-0 right-0 top-10 z-30 rounded-2xl border border-lavray-border p-1.5 shadow-lavray-float">
                {suggestions.map((s, idx) => (
                  <button
                    key={`${s.url}-${idx}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (s.type === 'search') submitQuery(s.title);
                      else void openUrl(s.url);
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-1.5 text-left text-[12.5px] transition-colors ${
                      idx === selectedSugIdx ? 'bg-lavray-accent/12 text-lavray-accent' : 'hover:bg-lavray-elevated/80'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Search className="h-3.5 w-3.5 text-lavray-muted shrink-0" />
                      <span className="truncate">{s.title}</span>
                    </span>
                    <span className="text-[11px] text-lavray-muted shrink-0">{s.subtitle}</span>
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>

        {/* Google-Style Category Strip: AI Mode | All | News | Docs & Code | Tools */}
        <div className="mt-2.5 flex items-center justify-between gap-4 md:pl-[104px] max-w-4xl">
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => openLavraySearch(input.trim() || tabQuery)}
              className="inline-flex items-center gap-1.5 border-b-2 border-transparent pb-2 text-[12.5px] font-medium text-lavray-muted hover:text-lavray-accent transition-colors"
              title="Open LAVRAY Intelligent Search (Advanced Research)"
            >
              <Sparkles className="h-3.5 w-3.5 text-lavray-accent" />
              <span>AI Mode</span>
            </button>

            {WEB_TABS.map((t) => {
              const active = mode === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setMode(t.id);
                    const q = (input || tabQuery).trim();
                    if (q) void runWebSearch(q, t.id, 1, timeRange, false);
                  }}
                  className={`border-b-2 pb-2 text-[12.5px] font-medium transition-colors ${
                    active
                      ? 'border-lavray-accent text-lavray-accent'
                      : 'border-transparent text-lavray-muted hover:text-lavray-text'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mb-1.5">
            {showTools && (
              <select
                value={timeRange}
                onChange={(e) => {
                  const next = e.target.value as typeof timeRange;
                  setTimeRange(next);
                  const q = (input || tabQuery).trim();
                  if (q) void runWebSearch(q, mode, 1, next, false);
                }}
                aria-label="Time filter"
                className="rounded-md border border-lavray-border bg-lavray-bg px-2 py-0.5 text-[12px] text-lavray-text outline-none cursor-pointer"
              >
                <option value="any">Any time</option>
                <option value="day">Past 24 hours</option>
                <option value="week">Past week</option>
                <option value="month">Past month</option>
                <option value="year">Past year</option>
              </select>
            )}
            <button
              type="button"
              onClick={() => setShowTools((v) => !v)}
              className={`rounded-md px-2.5 py-0.5 text-[12px] font-medium transition-colors ${
                showTools || timeRange !== 'any'
                  ? 'bg-lavray-elevated text-lavray-text'
                  : 'text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text'
              }`}
            >
              Tools ▾
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Container */}
      <div className="mx-auto w-full max-w-6xl px-6 md:pl-[128px] py-4 space-y-6">
        {/* Google-Style AI Overview Block (Top Full-Width 2-Column Section) */}
        {!loading && showAiOverviewSection && (
          <section className="border-b border-lavray-border pb-5">
            <div className="mb-3 flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-lavray-accent" />
              <h2 className="text-[15px] font-semibold tracking-tight text-lavray-text">AI Overview</h2>
              {aiOverview && (
                <button
                  type="button"
                  onClick={() => toggleSpeakOverview(aiOverview.summary)}
                  title={speaking ? 'Stop reading' : 'Listen to AI Overview'}
                  aria-label="Listen to AI Overview"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-lavray-elevated text-lavray-secondary hover:text-lavray-accent transition-colors"
                >
                  {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>
              )}
              {aiOverview && (
                <span className="ml-auto text-[11px] text-lavray-muted">
                  {aiOverview.provider === 'gemini_google_search'
                    ? 'Gemini • Google Search Grounded'
                    : aiOverview.provider === 'lavray_extractive'
                    ? 'LAVRAY Live Web Synthesis'
                    : `HAYA (${aiOverview.model})`}
                </span>
              )}
            </div>

            {overviewLoading && !aiOverview ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 animate-pulse">
                <div className="md:col-span-7 space-y-2.5">
                  <div className="h-3.5 w-full rounded bg-lavray-elevated" />
                  <div className="h-3.5 w-11/12 rounded bg-lavray-elevated" />
                  <div className="h-3.5 w-4/5 rounded bg-lavray-elevated" />
                </div>
                <div className="md:col-span-5 space-y-2">
                  <div className="h-20 rounded-2xl bg-lavray-elevated" />
                  <div className="h-20 rounded-2xl bg-lavray-elevated" />
                </div>
              </div>
            ) : aiOverview ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                {/* Left Overview Narrative */}
                <div className="md:col-span-7 space-y-3">
                  <div className={`relative space-y-3 ${!overviewExpanded && isLongOverview ? 'max-h-56 overflow-hidden' : ''}`}>
                    {overviewParagraphs.map((para, idx) => (
                      <p key={idx} className="text-[14px] leading-relaxed text-lavray-text">
                        <RichInlineText text={para} />
                        {idx === 0 && overviewSourceCards[0] && (
                          <button
                            type="button"
                            onClick={() => void openUrl(overviewSourceCards[0].url)}
                            className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-lavray-border bg-lavray-surface px-2 py-0.5 text-[11px] font-medium text-lavray-secondary hover:border-lavray-accent hover:text-lavray-accent align-middle"
                          >
                            <Link2 className="h-3 w-3" />
                            <span>
                              {getSiteDisplayName(overviewSourceCards[0].domain)}
                              {overviewSourceCards.length > 1 ? ` +${overviewSourceCards.length - 1}` : ''}
                            </span>
                          </button>
                        )}
                      </p>
                    ))}

                    {overviewBullets.length > 0 && (
                      <ul className="space-y-2 pl-4 list-disc text-[13.5px] leading-relaxed text-lavray-text">
                        {overviewBullets.map((b, idx) => (
                          <li key={idx}>
                            <RichInlineText text={b.replace(/^[-•*]\s+/, '')} />
                          </li>
                        ))}
                      </ul>
                    )}

                    {!overviewExpanded && isLongOverview && (
                      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-lavray-bg to-transparent" />
                    )}
                  </div>

                  {isLongOverview && (
                    <button
                      type="button"
                      onClick={() => setOverviewExpanded((v) => !v)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-full border border-lavray-border bg-lavray-surface py-2 text-[13px] font-medium text-lavray-text hover:bg-lavray-elevated transition-colors shadow-lavray-sm"
                    >
                      <span>{overviewExpanded ? 'Show less' : 'Show more'}</span>
                      {overviewExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  )}
                </div>

                {/* Right Source Cards (matching Goodreturns / Groww cards in screenshot) */}
                {overviewSourceCards.length > 0 && (
                  <div className="md:col-span-5 space-y-2.5">
                    {overviewSourceCards.map((card, i) => (
                      <button
                        key={`${card.url}-${i}`}
                        type="button"
                        onClick={() => void openUrl(card.url)}
                        className="flex w-full items-start justify-between gap-3 rounded-2xl border border-lavray-border bg-lavray-surface p-3 text-left hover:border-lavray-accent/60 hover:shadow-lavray-sm transition-all"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 text-[11.5px] text-lavray-muted">
                            <SiteFavicon favicon={card.favicon} domain={card.domain} size="sm" />
                            <span className="truncate font-medium text-lavray-secondary">
                              {getSiteDisplayName(card.domain)}
                            </span>
                          </div>
                          <div className="line-clamp-2 text-[13.5px] font-medium leading-snug text-lavray-text">
                            {card.title}
                          </div>
                          {card.snippet && (
                            <p className="line-clamp-2 text-[12px] leading-snug text-lavray-muted">
                              {card.publishedAt ? `${new Date(card.publishedAt).toLocaleDateString()} — ` : ''}
                              {card.snippet}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        )}

        {/* Organic Web Results + Optional Right-Hand Knowledge Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div
            className={`${
              isMediaVertical
                ? 'lg:col-span-12'
                : showKnowledgePanel
                ? 'lg:col-span-8 max-w-[680px]'
                : 'lg:col-span-9 max-w-[680px]'
            } space-y-5`}
          >
            {loading && (
              <div className="space-y-4 pt-2">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="space-y-1.5 animate-pulse">
                    <div className="h-3 w-48 rounded bg-lavray-elevated" />
                    <div className="h-4 w-80 rounded bg-lavray-elevated" />
                    <div className="h-3 w-full max-w-lg rounded bg-lavray-elevated" />
                  </div>
                ))}
              </div>
            )}

            {!loading && errorMsg && (
              <div className="rounded-xl border border-lavray-danger/30 bg-lavray-danger/10 px-4 py-3 text-[13px] text-lavray-danger">
                {errorMsg}
              </div>
            )}

            {!loading && response && (
              <>
                <div className="text-[12px] text-lavray-muted">
                  {response.pagination.totalResults} result{response.pagination.totalResults === 1 ? '' : 's'} (
                  {(response.latencyMs / 1000).toFixed(2)} seconds)
                  {response.cacheHit && ' • Instant'}
                </div>

                {/* "Did you mean?" / "Showing results for..." Typo Recovery Banner */}
                {response.understanding.correctedQuery &&
                  response.understanding.correctedQuery.toLowerCase() !== response.query.trim().toLowerCase() && (
                    <div className="text-[13.5px] space-y-0.5">
                      <div>
                        <span className="text-lavray-secondary">Showing results for </span>
                        <span className="font-semibold italic text-lavray-accent">
                          {response.understanding.correctedQuery}
                        </span>
                      </div>
                      <div className="text-[12.5px] text-lavray-muted">
                        Search instead for{' '}
                        <button
                          type="button"
                          onClick={() => void runWebSearch(response.query, mode, 1, timeRange, true)}
                          className="text-lavray-accent hover:underline"
                        >
                          {response.query}
                        </button>
                      </div>
                    </div>
                  )}

                {/* Position-Zero Instant Tool Widget (Calculator / Converter / Color / Definition) */}
                {isPositionZeroTool && instant && (
                  <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-4 shadow-lavray-sm space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[11.5px] text-lavray-muted">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <Calculator className="h-3.5 w-3.5 text-lavray-accent" />
                        {instant.subtitle || instant.source}
                      </span>
                      <span>{instant.source}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      {instant.kind === 'color' && (
                        <span
                          className="h-9 w-9 rounded-lg border border-lavray-border shrink-0"
                          style={{ backgroundColor: instant.title }}
                        />
                      )}
                      <div className="text-[22px] font-semibold tracking-tight text-lavray-text">
                        {instant.title}
                      </div>
                    </div>

                    {instant.kind === 'definition' && (
                      <p className="text-[13.5px] leading-relaxed text-lavray-secondary">{instant.summary}</p>
                    )}

                    {instant.facts && instant.facts.length > 0 && (
                      <div className="flex flex-wrap gap-3 pt-1 text-[12px] text-lavray-muted">
                        {instant.facts.map((f, i) => (
                          <span key={i}>
                            <strong className="text-lavray-secondary">{f.label}:</strong> {f.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Vertical & Organic Results */}
                {response.results.length === 0 && !instant ? (
                  <div className="py-8 space-y-2 text-[13.5px] text-lavray-secondary">
                    <p>
                      No {mode === 'web' ? 'web' : mode} results matched <strong className="text-lavray-text">{response.query}</strong>.
                    </p>
                    <p className="text-[12.5px] text-lavray-muted">
                      Try broader keywords, or add a Gemini / Brave Search API key or SearXNG endpoint in{' '}
                      <button
                        type="button"
                        onClick={() => useLavrayStore.getState().setOverlayView('settings')}
                        className="text-lavray-accent hover:underline"
                      >
                        Settings
                      </button>
                      .
                    </p>
                  </div>
                ) : mode === 'images' ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {response.results.map((r) => {
                      const imgSrc = r.thumbnailUrl || r.mediaUrl || '';
                      return (
                        <div
                          key={r.id}
                          className="group flex flex-col overflow-hidden rounded-2xl border border-lavray-border bg-lavray-surface hover:border-lavray-accent/60 hover:shadow-lavray-sm transition-all"
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedImage(r)}
                            className="relative aspect-[4/3] w-full overflow-hidden bg-lavray-elevated flex items-center justify-center"
                            title={`Preview ${r.title}`}
                          >
                            {imgSrc ? (
                              <img
                                src={imgSrc}
                                alt={r.title}
                                loading="lazy"
                                className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                              />
                            ) : (
                              <ImageIcon className="h-7 w-7 text-lavray-muted" />
                            )}
                          </button>
                          <div className="p-2.5 space-y-1">
                            <button
                              type="button"
                              onClick={() => setSelectedImage(r)}
                              className="line-clamp-1 text-left text-[12.5px] font-medium text-lavray-text hover:text-lavray-accent"
                            >
                              {r.title}
                            </button>
                            <button
                              type="button"
                              onClick={() => void openUrl(r.url)}
                              className="flex items-center gap-1.5 w-full text-left text-[11px] text-lavray-muted hover:text-lavray-accent truncate"
                            >
                              <SiteFavicon favicon={r.favicon} domain={r.domain} size="sm" />
                              <span className="truncate">{getSiteDisplayName(r.domain)}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : mode === 'videos' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {response.results.map((r) => {
                      const dur = formatDuration(r.durationSeconds);
                      const thumb = r.thumbnailUrl || '';
                      return (
                        <article
                          key={r.id}
                          className="group flex flex-col overflow-hidden rounded-2xl border border-lavray-border bg-lavray-surface hover:border-lavray-accent/60 hover:shadow-lavray-sm transition-all"
                        >
                          <button
                            type="button"
                            onClick={() => void openUrl(r.mediaUrl || r.url)}
                            className="relative aspect-video w-full overflow-hidden bg-lavray-elevated flex items-center justify-center"
                          >
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={r.title}
                                loading="lazy"
                                className="h-full w-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                              />
                            ) : (
                              <Play className="h-8 w-8 text-lavray-muted" />
                            )}
                            <span className="absolute inset-0 flex items-center justify-center bg-black/15 opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/75 text-white shadow">
                                <Play className="h-4 w-4 ml-0.5 fill-current" />
                              </span>
                            </span>
                            {dur && (
                              <span className="absolute bottom-2 right-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white">
                                {dur}
                              </span>
                            )}
                          </button>
                          <div className="p-3.5 space-y-1.5 flex-1 flex flex-col justify-between">
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => void openUrl(r.mediaUrl || r.url)}
                                className="line-clamp-2 text-left text-[14px] font-medium leading-snug text-lavray-text hover:text-lavray-accent"
                              >
                                {r.title}
                              </button>
                              {r.snippet && (
                                <p className="line-clamp-2 text-[12px] leading-relaxed text-lavray-secondary">
                                  {r.snippet}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-2 pt-1 text-[11.5px] text-lavray-muted">
                              <span className="flex items-center gap-1.5 truncate">
                                <SiteFavicon favicon={r.favicon} domain={r.domain} size="sm" />
                                <span className="truncate font-medium text-lavray-secondary">
                                  {getSiteDisplayName(r.domain)}
                                </span>
                              </span>
                              {r.publishedAt && (
                                <span className="shrink-0">{new Date(r.publishedAt).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : mode === 'maps' ? (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                    <div className="lg:col-span-5 space-y-2.5">
                      {response.results.map((r) => {
                        const isSelected = activeMapPlace?.id === r.id;
                        return (
                          <div
                            key={r.id}
                            className={`rounded-2xl border p-3.5 transition-all ${
                              isSelected
                                ? 'border-lavray-accent bg-lavray-accent/5 shadow-lavray-sm'
                                : 'border-lavray-border bg-lavray-surface hover:border-lavray-accent/50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedMapPlace(r);
                                  setMapZoom(13);
                                }}
                                className="flex-1 text-left space-y-1 min-w-0"
                              >
                                <div className="flex items-center gap-2">
                                  <MapPin className="h-4 w-4 shrink-0 text-lavray-accent" />
                                  <span className="truncate text-[14px] font-semibold text-lavray-text">
                                    {r.title}
                                  </span>
                                </div>
                                {r.coordinates?.category && (
                                  <span className="inline-block rounded-full bg-lavray-elevated px-2 py-0.5 text-[10.5px] font-medium text-lavray-secondary capitalize">
                                    {r.coordinates.category.replace(/_/g, ' ')}
                                  </span>
                                )}
                                <p className="line-clamp-2 text-[12px] leading-relaxed text-lavray-secondary">
                                  {r.coordinates?.displayName || r.snippet}
                                </p>
                                {r.coordinates && (
                                  <div className="text-[11px] font-mono text-lavray-muted">
                                    {r.coordinates.lat.toFixed(4)}, {r.coordinates.lon.toFixed(4)}
                                  </div>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => void openUrl(r.url)}
                                className="shrink-0 rounded-lg border border-lavray-border bg-lavray-bg px-2.5 py-1 text-[11.5px] font-medium text-lavray-accent hover:border-lavray-accent"
                              >
                                Open
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="lg:col-span-7">
                      {activeMapPlace?.coordinates ? (
                        (() => {
                          const { lat, lon, displayName, category } = activeMapPlace.coordinates;
                          const { tiles, pinLeftPct, pinTopPct } = getOsmSlippyTiles(lat, lon, mapZoom);
                          return (
                            <div className="sticky top-28 overflow-hidden rounded-2xl border border-lavray-border bg-lavray-surface shadow-lavray-sm">
                              <div className="relative aspect-[4/3] w-full overflow-hidden bg-lavray-elevated">
                                <div className="grid h-full w-full grid-cols-3 grid-rows-3">
                                  {tiles.map((tile) => (
                                    <img
                                      key={tile.key}
                                      src={tile.url}
                                      alt=""
                                      className="h-full w-full object-cover select-none pointer-events-none"
                                    />
                                  ))}
                                </div>

                                {/* Map Pin */}
                                <div
                                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-full drop-shadow-md"
                                  style={{ left: `${pinLeftPct}%`, top: `${pinTopPct}%` }}
                                >
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-lavray-accent text-white shadow-lg">
                                    <MapPin className="h-4 w-4" />
                                  </div>
                                </div>

                                {/* Zoom Controls */}
                                <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-xl border border-lavray-border bg-lavray-surface/95 shadow-lavray-sm">
                                  <button
                                    type="button"
                                    onClick={() => setMapZoom((z) => Math.min(17, z + 1))}
                                    aria-label="Zoom in"
                                    className="p-2 text-lavray-text hover:bg-lavray-elevated border-b border-lavray-border"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setMapZoom((z) => Math.max(4, z - 1))}
                                    aria-label="Zoom out"
                                    className="p-2 text-lavray-text hover:bg-lavray-elevated"
                                  >
                                    <Minus className="h-3.5 w-3.5" />
                                  </button>
                                </div>

                                <div className="absolute bottom-2 right-2 rounded bg-lavray-surface/85 px-2 py-0.5 text-[10px] text-lavray-muted">
                                  © OpenStreetMap contributors
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-lavray-border p-3.5">
                                <div className="min-w-0 flex-1 space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-[14.5px] font-semibold text-lavray-text">
                                      {activeMapPlace.title}
                                    </span>
                                    {category && (
                                      <span className="rounded-full bg-lavray-elevated px-2 py-0.5 text-[10.5px] text-lavray-muted capitalize">
                                        {category.replace(/_/g, ' ')}
                                      </span>
                                    )}
                                  </div>
                                  <p className="truncate text-[12px] text-lavray-secondary">
                                    {displayName || activeMapPlace.snippet}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void openUrl(activeMapPlace.url)}
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-lavray-accent px-3.5 py-2 text-[12px] font-medium text-lavray-accent-fg hover:opacity-90 shrink-0"
                                >
                                  <span>Open in OpenStreetMap</span>
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="rounded-2xl border border-lavray-border bg-lavray-surface p-6 text-[13px] text-lavray-muted">
                          Select a location to inspect its map coordinates and OpenStreetMap view.
                        </div>
                      )}
                    </div>
                  </div>
                ) : mode === 'shopping' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {response.results.map((r) => (
                      <article
                        key={r.id}
                        className="flex flex-col justify-between overflow-hidden rounded-2xl border border-lavray-border bg-lavray-surface p-4 hover:border-lavray-accent/60 hover:shadow-lavray-sm transition-all space-y-3"
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <SiteFavicon favicon={r.favicon} domain={r.domain} size="sm" />
                              <span className="truncate text-[12px] font-medium text-lavray-secondary">
                                {getSiteDisplayName(r.domain)}
                              </span>
                            </div>
                            {r.priceText && (
                              <span className="shrink-0 rounded-full bg-lavray-accent/12 px-2.5 py-0.5 text-[12px] font-semibold text-lavray-accent">
                                {r.priceText}
                              </span>
                            )}
                          </div>

                          {r.thumbnailUrl && (
                            <div className="aspect-[16/10] w-full overflow-hidden rounded-xl border border-lavray-border bg-lavray-bg flex items-center justify-center">
                              <img
                                src={r.thumbnailUrl}
                                alt={r.title}
                                loading="lazy"
                                className="h-full w-full object-contain p-1.5"
                              />
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => void openUrl(r.url)}
                            className="line-clamp-2 text-left text-[14.5px] font-semibold leading-snug text-lavray-text hover:text-lavray-accent"
                          >
                            {r.title}
                          </button>

                          {r.snippet && (
                            <p className="line-clamp-3 text-[12.5px] leading-relaxed text-lavray-secondary">
                              <HighlightedSnippet text={r.snippet} terms={highlightTerms} />
                            </p>
                          )}
                        </div>

                        <div className="flex items-center justify-between border-t border-lavray-border pt-2.5">
                          <span className="inline-flex items-center gap-1 text-[11px] text-lavray-muted">
                            <ShoppingBag className="h-3 w-3" />
                            <span>{r.domain}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => void openUrl(r.url)}
                            className="inline-flex items-center gap-1 rounded-lg border border-lavray-border bg-lavray-bg px-2.5 py-1 text-[11.5px] font-medium text-lavray-accent hover:border-lavray-accent"
                          >
                            <span>Visit store</span>
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {response.results.map((r) => (
                      <article key={r.id} className="group space-y-1">
                        <div className="flex items-center gap-2.5 text-[12px] text-lavray-muted">
                          <SiteFavicon favicon={r.favicon} domain={r.domain} />
                          <div className="min-w-0 leading-tight">
                            <div className="truncate font-medium text-lavray-text">{getSiteDisplayName(r.domain)}</div>
                            <div className="truncate text-[11px] text-lavray-muted">{formatBreadcrumb(r.url, r.domain)}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-0.5">
                          <button
                            type="button"
                            onClick={() => void openUrl(r.url)}
                            className="text-left text-[18.5px] font-medium leading-snug text-lavray-accent hover:underline"
                          >
                            {r.title}
                          </button>
                          <button
                            type="button"
                            onClick={() => void openUrl(r.url, true)}
                            title="Open in new tab"
                            aria-label={`Open ${r.title} in new tab`}
                            className="opacity-0 group-hover:opacity-100 rounded p-1 text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text transition-opacity"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <p className="text-[13.5px] leading-relaxed text-lavray-secondary line-clamp-3">
                          {r.publishedAt && (
                            <span className="mr-1.5 text-[12px] text-lavray-muted">
                              {new Date(r.publishedAt).toLocaleDateString()} —
                            </span>
                          )}
                          <HighlightedSnippet text={r.snippet} terms={highlightTerms} />
                        </p>
                      </article>
                    ))}
                  </div>
                )}

                {/* Google-style "People also search for" Related Queries Grid */}
                {response.relatedQueries.length > 0 && response.results.length > 0 && (
                  <div className="border-t border-lavray-border pt-4 space-y-2.5">
                    <div className="text-[13px] font-semibold text-lavray-text">People also search for</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {response.relatedQueries.slice(0, 4).map((rq) => (
                        <button
                          key={rq}
                          type="button"
                          onClick={() => submitQuery(rq)}
                          className="flex items-center gap-2.5 rounded-xl border border-lavray-border bg-lavray-surface px-3.5 py-2 text-left text-[12.5px] text-lavray-text hover:border-lavray-accent/60 hover:bg-lavray-elevated/60 transition-colors"
                        >
                          <Search className="h-3.5 w-3.5 text-lavray-muted shrink-0" />
                          <span className="truncate">{rq}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clean Pagination */}
                {response.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-lavray-border pt-4 pb-8 text-[13px]">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => void runWebSearch(tabQuery, mode, page - 1, timeRange)}
                      className="inline-flex items-center gap-1 rounded-lg border border-lavray-border bg-lavray-surface px-3 py-1.5 font-medium text-lavray-text hover:bg-lavray-elevated disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" /> Previous
                    </button>
                    <span className="text-[12px] text-lavray-muted">
                      Page {response.pagination.page} of {response.pagination.totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={!response.pagination.hasMore}
                      onClick={() => void runWebSearch(tabQuery, mode, page + 1, timeRange)}
                      className="inline-flex items-center gap-1 rounded-lg border border-lavray-border bg-lavray-surface px-3 py-1.5 font-medium text-lavray-text hover:bg-lavray-elevated disabled:opacity-40"
                    >
                      Next <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Google-style Right-Hand Knowledge Panel */}
          {!loading && showKnowledgePanel && instant && (
            <aside className="lg:col-span-4">
              <div className="sticky top-28 rounded-2xl border border-lavray-border bg-lavray-surface p-4 shadow-lavray-sm space-y-3">
                {instant.thumbnailUrl && (
                  <div className="overflow-hidden rounded-xl border border-lavray-border bg-lavray-bg max-h-48 flex items-center justify-center">
                    <img
                      src={instant.thumbnailUrl}
                      alt={instant.title}
                      className="max-h-48 w-full object-cover"
                    />
                  </div>
                )}
                <div>
                  <h2 className="text-[18px] font-semibold tracking-tight text-lavray-text">{instant.title}</h2>
                  {instant.subtitle && (
                    <p className="text-[12px] text-lavray-muted mt-0.5">{instant.subtitle}</p>
                  )}
                </div>
                <p className="text-[13px] leading-relaxed text-lavray-secondary">{instant.summary}</p>
                <div className="flex items-center justify-between border-t border-lavray-border pt-2.5 text-[12px]">
                  <span className="text-lavray-muted">Source: {instant.source}</span>
                  <button
                    type="button"
                    onClick={() => void openUrl(instant.url)}
                    className="inline-flex items-center gap-1 font-medium text-lavray-accent hover:underline"
                  >
                    Read more <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Image Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-lavray-border bg-lavray-surface shadow-lavray-float"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-lavray-border px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-semibold text-lavray-text">{selectedImage.title}</h3>
                <p className="truncate text-[11.5px] text-lavray-muted">{selectedImage.domain}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                aria-label="Close image preview"
                className="rounded-full p-1.5 text-lavray-muted hover:bg-lavray-elevated hover:text-lavray-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex max-h-[62vh] items-center justify-center bg-black/90 p-4">
              <img
                src={selectedImage.mediaUrl || selectedImage.thumbnailUrl || selectedImage.url}
                alt={selectedImage.title}
                className="max-h-[56vh] w-auto max-w-full rounded-lg object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12px]">
              <p className="line-clamp-1 text-lavray-secondary flex-1 min-w-0">
                {selectedImage.snippet || selectedImage.title}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void openUrl(selectedImage.mediaUrl || selectedImage.thumbnailUrl || selectedImage.url, true)}
                  className="rounded-lg border border-lavray-border bg-lavray-bg px-3 py-1.5 font-medium text-lavray-text hover:bg-lavray-elevated"
                >
                  Open Image
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = selectedImage.url;
                    setSelectedImage(null);
                    void openUrl(target);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-lavray-accent px-3 py-1.5 font-medium text-lavray-accent-fg hover:opacity-90"
                >
                  <span>Visit Page</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

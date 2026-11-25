import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  Bot,
  Code2,
  Download,
  History,
  Home,
  Lock,
  Menu,
  OctagonAlert,
  RotateCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  Square,
  Star,
  Unlock,
  X
} from 'lucide-react';
import type { OmniboxSuggestion } from '@shared/types';
import { useAtlasStore } from '../store/useAtlasStore';

export const AddressBar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    agentPanelOpen,
    setAgentPanelOpen,
    activeOverlayView,
    setOverlayView,
    openAtlasSearch,
    adBlockStats,
    setAdBlockStats,
    pushToast
  } = useAtlasStore();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const [inputValue, setInputValue] = useState(activeTab?.url || '');
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<OmniboxSuggestion[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused && activeTab) {
      setInputValue(activeTab.url === 'about:blank' ? '' : activeTab.url);
    }
  }, [activeTab?.url, activeTab?.id, focused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleInputChange = async (val: string) => {
    setInputValue(val);
    if (val.trim().length > 0) {
      const sugg = await window.atlas.getSuggestions(val);
      setSuggestions(sugg);
    } else {
      setSuggestions([]);
    }
  };

  const navigateTo = async (target: string) => {
    if (!activeTab) return;
    setSuggestions([]);
    setFocused(false);
    setOverlayView(null);
    await window.atlas.navigate(activeTab.id, target);
  };

  const handleBookmarkCurrent = async () => {
    if (!activeTab || !activeTab.url || activeTab.url === 'about:blank') return;
    await window.atlas.addBookmark(activeTab.url, activeTab.title || activeTab.url);
    pushToast('Bookmarked page', 'success');
  };

  const handleKillSwitch = async () => {
    await window.atlas.triggerKillSwitch();
    pushToast('Emergency Kill Switch activated — all agents & CDP sessions stopped', 'danger');
  };

  const currentDomain = (() => {
    try {
      return activeTab?.url ? new URL(activeTab.url).hostname : '';
    } catch {
      return '';
    }
  })();

  const isAllowlisted = Boolean(
    currentDomain && adBlockStats?.allowlistedDomains.includes(currentDomain)
  );

  return (
    <header className="relative flex h-12 items-center gap-2 border-b border-atlas-border bg-atlas-surface px-3 select-none">
      {/* Navigation Controls */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={!activeTab?.canGoBack}
          onClick={() => activeTab && window.atlas.goBack(activeTab.id)}
          title="Back"
          className="rounded-md p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text disabled:opacity-30"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={!activeTab?.canGoForward}
          onClick={() => activeTab && window.atlas.goForward(activeTab.id)}
          title="Forward"
          className="rounded-md p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text disabled:opacity-30"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() =>
            activeTab &&
            (activeTab.isLoading
              ? window.atlas.stopLoading(activeTab.id)
              : window.atlas.reload(activeTab.id))
          }
          title={activeTab?.isLoading ? 'Stop' : 'Reload'}
          className="rounded-md p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text"
        >
          {activeTab?.isLoading ? <Square className="h-3.5 w-3.5" /> : <RotateCw className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => activeTab && window.atlas.goHome(activeTab.id)}
          title="Home"
          className="rounded-md p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text"
        >
          <Home className="h-4 w-4" />
        </button>
      </div>

      {/* Omnibox */}
      <div className="relative flex-1 max-w-4xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void navigateTo(inputValue);
          }}
          className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 transition-colors ${
            focused
              ? 'border-atlas-accent bg-atlas-bg'
              : 'border-atlas-border bg-atlas-elevated/60 hover:bg-atlas-elevated'
          }`}
        >
          {activeTab?.securityState === 'secure' ? (
            <Lock className="h-3.5 w-3.5 shrink-0 text-atlas-success" aria-label="HTTPS Secure" />
          ) : activeTab?.securityState === 'insecure' ? (
            <Unlock className="h-3.5 w-3.5 shrink-0 text-atlas-warning" aria-label="Not Secure" />
          ) : (
            <Shield className="h-3.5 w-3.5 shrink-0 text-atlas-muted" />
          )}

          <input
            ref={inputRef}
            value={inputValue}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 180)}
            onChange={(e) => void handleInputChange(e.target.value)}
            placeholder="Search or enter website URL..."
            className="flex-1 bg-transparent text-sm text-atlas-text placeholder:text-atlas-muted outline-none select-text"
          />

          {activeTab && activeTab.blockedCount > 0 && (
            <button
              type="button"
              onClick={async () => {
                if (!currentDomain) return;
                const next = await window.atlas.toggleAdBlockDomain(currentDomain, !isAllowlisted);
                setAdBlockStats(next);
              }}
              title={`Blocked ${activeTab.blockedCount} ads/trackers on this tab (click to toggle site allowlist)`}
              className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                isAllowlisted
                  ? 'bg-atlas-warning/15 text-atlas-warning'
                  : 'bg-atlas-accent/15 text-atlas-accent'
              }`}
            >
              {isAllowlisted ? <ShieldAlert className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
              {activeTab.blockedCount}
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleBookmarkCurrent()}
            title="Bookmark this page"
            className="text-atlas-muted hover:text-atlas-warning"
          >
            <Star className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setOverlayView(activeOverlayView === 'reader' ? null : 'reader')}
            title="Reading Mode"
            className={`rounded p-0.5 ${
              activeOverlayView === 'reader' ? 'text-atlas-accent' : 'text-atlas-muted hover:text-atlas-text'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
          </button>
        </form>

        {focused && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-11 z-40 rounded-xl border border-atlas-border bg-atlas-surface p-1.5 shadow-2xl">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setSuggestions([]);
                setFocused(false);
                openAtlasSearch(inputValue);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg bg-atlas-accent/10 px-3 py-2 text-left text-xs text-atlas-accent hover:bg-atlas-accent/20"
            >
              <div className="flex items-center gap-2 truncate font-semibold">
                <Search className="h-3.5 w-3.5 shrink-0" />
                Search Atlas Intelligent Engine for "{inputValue}"
              </div>
              <span className="shrink-0 rounded bg-atlas-accent/20 px-1.5 py-0.5 text-[10px] uppercase">
                Atlas Search
              </span>
            </button>
            {suggestions.map((s, idx) => (
              <button
                key={`${s.url}-${idx}`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  void navigateTo(s.url);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs hover:bg-atlas-elevated"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-atlas-text">{s.title}</div>
                  <div className="truncate text-[11px] text-atlas-muted">{s.url}</div>
                </div>
                <span className="shrink-0 rounded bg-atlas-elevated px-1.5 py-0.5 text-[10px] uppercase text-atlas-muted">
                  {s.subtitle || s.type}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right Toolbar */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => openAtlasSearch('')}
          title="Atlas Intelligent Search"
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${
            activeOverlayView === 'search'
              ? 'bg-atlas-accent text-white'
              : 'text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text'
          }`}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">Search</span>
        </button>

        <button
          type="button"
          onClick={() => setOverlayView(activeOverlayView === 'downloads' ? null : 'downloads')}
          title="Downloads"
          className="rounded-lg p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text"
        >
          <Download className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => void handleKillSwitch()}
          title="Emergency Kill Switch (Cmd/Ctrl+Shift+Esc)"
          className="flex items-center gap-1 rounded-lg border border-atlas-danger/40 bg-atlas-danger/10 px-2 py-1 text-xs font-semibold text-atlas-danger hover:bg-atlas-danger/20"
        >
          <OctagonAlert className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Kill Switch</span>
        </button>

        <button
          type="button"
          onClick={() => setAgentPanelOpen(!agentPanelOpen)}
          title="Toggle Atlas AI Panel"
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            agentPanelOpen
              ? 'bg-atlas-accent text-white'
              : 'bg-atlas-elevated text-atlas-text hover:bg-atlas-accent/20'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Atlas AI
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title="Browser & Platform Menu"
            className="rounded-lg p-1.5 text-atlas-muted hover:bg-atlas-elevated hover:text-atlas-text"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          {menuOpen && (
            <div
              onMouseLeave={() => setMenuOpen(false)}
              className="absolute right-0 top-10 z-50 w-60 rounded-xl border border-atlas-border bg-atlas-surface p-1.5 shadow-2xl text-xs"
            >
              <MenuBtn icon={<History className="h-3.5 w-3.5" />} label="History" onClick={() => { setOverlayView('history'); setMenuOpen(false); }} />
              <MenuBtn icon={<Bookmark className="h-3.5 w-3.5" />} label="Bookmarks" onClick={() => { setOverlayView('bookmarks'); setMenuOpen(false); }} />
              <MenuBtn icon={<Download className="h-3.5 w-3.5" />} label="Downloads" onClick={() => { setOverlayView('downloads'); setMenuOpen(false); }} />
              <div className="my-1 border-t border-atlas-border" />
              <MenuBtn icon={<Bot className="h-3.5 w-3.5" />} label="Skills Library" onClick={() => { setOverlayView('skills'); setMenuOpen(false); }} />
              <MenuBtn icon={<Search className="h-3.5 w-3.5" />} label="Atlas Search Engine" onClick={() => { openAtlasSearch(''); setMenuOpen(false); }} />
              <MenuBtn icon={<Sparkles className="h-3.5 w-3.5" />} label="Research & Intelligence" onClick={() => { setOverlayView('intelligence'); setMenuOpen(false); }} />
              <MenuBtn icon={<Sparkles className="h-3.5 w-3.5" />} label="Structured Extraction" onClick={() => { setOverlayView('extract'); setMenuOpen(false); }} />
              <MenuBtn icon={<BookOpen className="h-3.5 w-3.5" />} label="Local Memory" onClick={() => { setOverlayView('memory'); setMenuOpen(false); }} />
              <MenuBtn icon={<RotateCw className="h-3.5 w-3.5" />} label="Run History & Replay" onClick={() => { setOverlayView('runs'); setMenuOpen(false); }} />
              <MenuBtn icon={<Shield className="h-3.5 w-3.5" />} label="Scheduled Workflows" onClick={() => { setOverlayView('scheduler'); setMenuOpen(false); }} />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Observability & Costs" onClick={() => { setOverlayView('dashboard'); setMenuOpen(false); }} />
              <MenuBtn icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Audit Logs & Rules" onClick={() => { setOverlayView('audit'); setMenuOpen(false); }} />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Local MCP Server" onClick={() => { setOverlayView('mcp'); setMenuOpen(false); }} />
              <div className="my-1 border-t border-atlas-border" />
              <MenuBtn icon={<Lock className="h-3.5 w-3.5" />} label="New Private Window" onClick={() => { void window.atlas.newPrivateWindow(); setMenuOpen(false); }} />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Toggle DevTools" onClick={() => { if (activeTab) void window.atlas.openDevTools(activeTab.id); setMenuOpen(false); }} />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="View Page Source" onClick={() => { if (activeTab) void window.atlas.viewPageSource(activeTab.id); setMenuOpen(false); }} />
              <MenuBtn icon={<Settings className="h-3.5 w-3.5" />} label="Settings" onClick={() => { setOverlayView('settings'); setMenuOpen(false); }} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

const MenuBtn: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void }> = ({
  icon,
  label,
  onClick
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-atlas-text hover:bg-atlas-elevated"
  >
    <span className="text-atlas-muted">{icon}</span>
    <span>{label}</span>
  </button>
);

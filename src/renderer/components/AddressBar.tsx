import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  Bot,
  Code2,
  Compass,
  Download,
  History,
  Home,
  Lock,
  Menu,
  OctagonAlert,
  PanelLeft,
  PanelRight,
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
import { AdBlockerPopover } from './AdBlockerPopover';

export const AddressBar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    sidebarOpen,
    setSidebarOpen,
    verticalTabs,
    agentPanelOpen,
    setAgentPanelOpen,
    activeRun,
    activeOverlayView,
    setOverlayView,
    openAtlasSearch,
    adBlockStats,
    pushToast
  } = useAtlasStore();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const isNewTab = !activeTab?.url || activeTab.url === 'about:blank' || activeTab.url === 'atlas://newtab';
  const [inputValue, setInputValue] = useState(isNewTab ? '' : activeTab.url);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<OmniboxSuggestion[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shieldOpen, setShieldOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const agentBusy = Boolean(
    activeRun && ['planning', 'executing', 'verifying', 'paused', 'awaiting_hitl'].includes(activeRun.status)
  );

  useEffect(() => {
    if (!focused && activeTab) {
      const blank = !activeTab.url || activeTab.url === 'about:blank' || activeTab.url === 'atlas://newtab';
      setInputValue(blank ? '' : activeTab.url);
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
    const trimmed = target.trim();
    if (trimmed.toLowerCase().startsWith('atlas://search')) {
      try {
        const parsed = new URL(trimmed);
        openAtlasSearch(parsed.searchParams.get('q') || '');
        return;
      } catch {
        openAtlasSearch('');
        return;
      }
    }
    setOverlayView(null);
    await window.atlas.navigate(activeTab.id, target);
  };

  const handleBookmarkCurrent = async () => {
    if (!activeTab || isNewTab) return;
    await window.atlas.addBookmark(activeTab.url, activeTab.title || activeTab.url);
    pushToast('Bookmarked page', 'success');
  };

  const handleKillSwitch = async () => {
    await window.atlas.triggerKillSwitch();
    pushToast('Emergency stop activated — active runs halted', 'danger');
  };

  const currentDomain = (() => {
    if (isNewTab || !activeTab?.url) return '';
    try {
      return new URL(activeTab.url).hostname;
    } catch {
      return '';
    }
  })();

  const isAllowlisted = Boolean(
    currentDomain && adBlockStats?.allowlistedDomains.includes(currentDomain)
  );

  return (
    <header
      className={`relative flex h-11 items-center justify-between gap-2.5 border-b border-atlas-border bg-atlas-surface px-3 select-none ${
        verticalTabs ? 'pl-20 app-drag-region' : ''
      }`}
    >
      {/* Left Navigation Controls */}
      <div className="app-no-drag flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title="Toggle Workspace Sidebar (Cmd/Ctrl+B)"
          aria-label="Toggle Workspace Sidebar"
          className={`flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors ${
            sidebarOpen
              ? 'bg-atlas-elevated text-atlas-text'
              : 'text-atlas-secondary hover:bg-atlas-elevated hover:text-atlas-text'
          }`}
        >
          <PanelLeft className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          disabled={!activeTab?.canGoBack}
          onClick={() => activeTab && window.atlas.goBack(activeTab.id)}
          title="Back"
          aria-label="Back"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-atlas-secondary hover:bg-atlas-elevated hover:text-atlas-text disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          disabled={!activeTab?.canGoForward}
          onClick={() => activeTab && window.atlas.goForward(activeTab.id)}
          title="Forward"
          aria-label="Forward"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-atlas-secondary hover:bg-atlas-elevated hover:text-atlas-text disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ArrowRight className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={() =>
            activeTab &&
            (activeTab.isLoading
              ? window.atlas.stopLoading(activeTab.id)
              : window.atlas.reload(activeTab.id))
          }
          title={activeTab?.isLoading ? 'Stop Loading' : 'Reload'}
          aria-label={activeTab?.isLoading ? 'Stop Loading' : 'Reload'}
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-atlas-secondary hover:bg-atlas-elevated hover:text-atlas-text transition-colors"
        >
          {activeTab?.isLoading ? (
            <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <RotateCw className="h-[14px] w-[14px]" strokeWidth={1.75} />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setOverlayView(null);
            if (activeTab) void window.atlas.goHome(activeTab.id);
          }}
          title="Home / Start Page"
          aria-label="Home"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-atlas-secondary hover:bg-atlas-elevated hover:text-atlas-text transition-colors"
        >
          <Home className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>
      </div>

      {/* Centered Precision Omnibox */}
      <div className="app-no-drag relative flex-1 max-w-2xl mx-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void navigateTo(inputValue);
          }}
          className={`relative flex items-center gap-2 rounded-[9px] border px-2.5 h-[30px] transition-colors duration-150 ease-atlas ${
            focused
              ? 'border-atlas-accent/80 bg-atlas-surface ring-2 ring-atlas-accent/15'
              : 'border-atlas-border bg-atlas-shell/70 hover:bg-atlas-shell hover:border-atlas-border-strong'
          }`}
        >
          {/* Connection Status */}
          <span
            title={
              isNewTab
                ? 'Atlas Start Page'
                : activeTab?.securityState === 'secure'
                ? 'Connection is secure (HTTPS)'
                : activeTab?.securityState === 'insecure'
                ? 'Not secure (HTTP)'
                : 'Atlas Internal'
            }
            className="flex items-center shrink-0"
          >
            {isNewTab ? (
              <Compass className="h-3.5 w-3.5 text-atlas-muted" strokeWidth={1.75} />
            ) : activeTab?.securityState === 'secure' ? (
              <Lock className="h-3.5 w-3.5 text-atlas-success" strokeWidth={1.75} aria-label="HTTPS Secure" />
            ) : activeTab?.securityState === 'insecure' ? (
              <Unlock className="h-3.5 w-3.5 text-atlas-warning" strokeWidth={1.75} aria-label="Not Secure" />
            ) : (
              <Shield className="h-3.5 w-3.5 text-atlas-muted" strokeWidth={1.75} />
            )}
          </span>

          <input
            ref={inputRef}
            value={inputValue}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 180)}
            onChange={(e) => void handleInputChange(e.target.value)}
            placeholder="Search or enter website URL..."
            className="flex-1 min-w-0 bg-transparent text-[13px] text-atlas-text placeholder:text-atlas-muted outline-none select-text"
          />

          {/* Compact Inline Page Controls */}
          <div className="flex items-center gap-0.5 shrink-0">
            {activeTab && (
              <div className="relative">
                <button
                  type="button"
                  data-testid="adblock-shield-btn"
                  onClick={() => setShieldOpen((o) => !o)}
                  title={`Atlas Shield: ${activeTab.blockedCount} blocked on this tab`}
                  className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                    isAllowlisted || !adBlockStats?.globalEnabled
                      ? 'text-atlas-warning hover:bg-atlas-elevated'
                      : activeTab.blockedCount > 0
                      ? 'text-atlas-accent hover:bg-atlas-elevated'
                      : 'text-atlas-muted hover:text-atlas-text hover:bg-atlas-elevated'
                  }`}
                >
                  {isAllowlisted ? (
                    <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
                  ) : (
                    <Shield className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  {activeTab.blockedCount > 0 && <span>{activeTab.blockedCount}</span>}
                </button>
                {shieldOpen && (
                  <AdBlockerPopover
                    activeTab={activeTab}
                    currentDomain={currentDomain}
                    onClose={() => setShieldOpen(false)}
                  />
                )}
              </div>
            )}

            {!isNewTab && (
              <>
                <button
                  type="button"
                  onClick={() => void handleBookmarkCurrent()}
                  title="Bookmark this page"
                  aria-label="Bookmark this page"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-atlas-muted hover:text-atlas-warning hover:bg-atlas-elevated transition-colors"
                >
                  <Star className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>

                <button
                  type="button"
                  onClick={() => setOverlayView(activeOverlayView === 'reader' ? null : 'reader')}
                  title="Reading Mode"
                  aria-label="Reading Mode"
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                    activeOverlayView === 'reader'
                      ? 'bg-atlas-accent/12 text-atlas-accent'
                      : 'text-atlas-muted hover:text-atlas-text hover:bg-atlas-elevated'
                  }`}
                >
                  <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </>
            )}
          </div>

          {/* Hairline Page Loading Indicator */}
          {activeTab?.isLoading && (
            <div className="pointer-events-none absolute bottom-0 left-2 right-2 h-[1.5px] overflow-hidden rounded-full bg-atlas-accent/15">
              <div className="atlas-loading-bar h-full w-1/3 rounded-full bg-atlas-accent" />
            </div>
          )}
        </form>

        {/* Liquid Glass Omnibox Suggestions */}
        {focused && suggestions.length > 0 && (
          <div className="atlas-glass absolute left-0 right-0 top-9 z-40 rounded-xl border border-atlas-border p-1.5 shadow-atlas-float">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setSuggestions([]);
                setFocused(false);
                openAtlasSearch(inputValue);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg bg-atlas-accent/10 px-3 py-2 text-left text-xs text-atlas-accent hover:bg-atlas-accent/15 transition-colors"
            >
              <span className="flex items-center gap-2 truncate font-medium">
                <Search className="h-3.5 w-3.5 shrink-0" />
                Search Atlas Index for &ldquo;{inputValue}&rdquo;
              </span>
              <span className="shrink-0 text-[10.5px] font-medium opacity-80">Atlas Search</span>
            </button>
            <div className="mt-1 space-y-0.5">
              {suggestions.map((s, idx) => (
                <button
                  key={`${s.url}-${idx}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void navigateTo(s.url);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-xs hover:bg-atlas-elevated/80 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-atlas-text">{s.title}</div>
                    <div className="truncate text-[11px] text-atlas-muted">{s.url}</div>
                  </div>
                  <span className="shrink-0 text-[10.5px] text-atlas-muted">{s.subtitle || s.type}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right Utility Cluster */}
      <div className="app-no-drag flex items-center gap-1 shrink-0">
        {agentBusy && (
          <button
            type="button"
            onClick={() => void handleKillSwitch()}
            title="Emergency Stop Agent (Cmd/Ctrl+Shift+Esc)"
            className="flex h-7 items-center gap-1.5 rounded-[7px] border border-atlas-danger/35 bg-atlas-danger/10 px-2.5 text-[11.5px] font-medium text-atlas-danger hover:bg-atlas-danger/15 transition-colors"
          >
            <OctagonAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Stop</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => (activeOverlayView === 'search' ? setOverlayView(null) : openAtlasSearch(''))}
          title="Atlas Intelligent Search"
          aria-label="Atlas Intelligent Search"
          className={`flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] font-medium transition-colors ${
            activeOverlayView === 'search'
              ? 'bg-atlas-accent/12 text-atlas-accent'
              : 'text-atlas-secondary hover:bg-atlas-elevated hover:text-atlas-text'
          }`}
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="hidden xl:inline">Search</span>
        </button>

        <button
          type="button"
          onClick={() => setAgentPanelOpen(!agentPanelOpen)}
          title="Toggle Atlas AI Panel"
          aria-label="Toggle Atlas AI Panel"
          className={`flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 text-[12px] font-medium transition-colors ${
            agentPanelOpen
              ? 'border-atlas-accent/35 bg-atlas-accent/10 text-atlas-accent'
              : 'border-atlas-border bg-atlas-surface text-atlas-secondary hover:bg-atlas-elevated hover:text-atlas-text'
          }`}
        >
          <PanelRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>Assistant</span>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title="Browser & Workspace Menu"
            aria-label="Browser Menu"
            className={`flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors ${
              menuOpen
                ? 'bg-atlas-elevated text-atlas-text'
                : 'text-atlas-secondary hover:bg-atlas-elevated hover:text-atlas-text'
            }`}
          >
            {menuOpen ? <X className="h-4 w-4" strokeWidth={1.75} /> : <Menu className="h-4 w-4" strokeWidth={1.75} />}
          </button>

          {menuOpen && (
            <div
              onMouseLeave={() => setMenuOpen(false)}
              className="atlas-glass absolute right-0 top-9 z-50 w-60 rounded-xl border border-atlas-border p-1.5 shadow-atlas-float text-xs"
            >
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-atlas-muted">
                Library
              </div>
              <MenuBtn icon={<History className="h-3.5 w-3.5" />} label="History" onClick={() => { setOverlayView('history'); setMenuOpen(false); }} />
              <MenuBtn icon={<Bookmark className="h-3.5 w-3.5" />} label="Bookmarks" onClick={() => { setOverlayView('bookmarks'); setMenuOpen(false); }} />
              <MenuBtn icon={<Download className="h-3.5 w-3.5" />} label="Downloads" onClick={() => { setOverlayView('downloads'); setMenuOpen(false); }} />

              <div className="my-1 border-t border-atlas-border" />
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-atlas-muted">
                Research & Automation
              </div>
              <MenuBtn icon={<Search className="h-3.5 w-3.5" />} label="Atlas Search" onClick={() => { openAtlasSearch(''); setMenuOpen(false); }} />
              <MenuBtn icon={<Sparkles className="h-3.5 w-3.5" />} label="Research Workspace" onClick={() => { setOverlayView('intelligence'); setMenuOpen(false); }} />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Structured Extraction" onClick={() => { setOverlayView('extract'); setMenuOpen(false); }} />
              <MenuBtn icon={<Bot className="h-3.5 w-3.5" />} label="Skills Library" onClick={() => { setOverlayView('skills'); setMenuOpen(false); }} />
              <MenuBtn icon={<BookOpen className="h-3.5 w-3.5" />} label="Local Memory" onClick={() => { setOverlayView('memory'); setMenuOpen(false); }} />
              <MenuBtn icon={<RotateCw className="h-3.5 w-3.5" />} label="Run History & Replay" onClick={() => { setOverlayView('runs'); setMenuOpen(false); }} />
              <MenuBtn icon={<Shield className="h-3.5 w-3.5" />} label="Scheduled Tasks" onClick={() => { setOverlayView('scheduler'); setMenuOpen(false); }} />

              <div className="my-1 border-t border-atlas-border" />
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-atlas-muted">
                Privacy & System
              </div>
              <MenuBtn icon={<Lock className="h-3.5 w-3.5" />} label="New Private Window" onClick={() => { void window.atlas.newPrivateWindow(); setMenuOpen(false); }} />
              <MenuBtn icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Privacy, Rules & Audit" onClick={() => { setOverlayView('audit'); setMenuOpen(false); }} />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Observability & Costs" onClick={() => { setOverlayView('dashboard'); setMenuOpen(false); }} />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Local MCP Server" onClick={() => { setOverlayView('mcp'); setMenuOpen(false); }} />
              <MenuBtn icon={<OctagonAlert className="h-3.5 w-3.5" />} label="Emergency Stop Agent" danger onClick={() => { void handleKillSwitch(); setMenuOpen(false); }} />
              <div className="my-1 border-t border-atlas-border" />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Developer Tools" onClick={() => { if (activeTab && !isNewTab) void window.atlas.openDevTools(activeTab.id); setMenuOpen(false); }} />
              <MenuBtn icon={<Settings className="h-3.5 w-3.5" />} label="Settings" onClick={() => { setOverlayView('settings'); setMenuOpen(false); }} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

const MenuBtn: React.FC<{ icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }> = ({
  icon,
  label,
  danger,
  onClick
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
      danger ? 'text-atlas-danger hover:bg-atlas-danger/10' : 'text-atlas-text hover:bg-atlas-elevated/80'
    }`}
  >
    <span className={danger ? 'text-atlas-danger' : 'text-atlas-muted'}>{icon}</span>
    <span>{label}</span>
  </button>
);

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
  PanelLeft,
  RotateCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  Square,
  Star,
  Unlock,
  User,
  X
} from 'lucide-react';
import type { OmniboxSuggestion } from '@shared/types';
import { useLavrayStore } from '../store/useLavrayStore';
import { AdBlockerPopover } from './AdBlockerPopover';
import { ProfilePopover } from './ProfilePopover';
import { AskHayaLoopLabel, HayaMark, LavrayMark } from './BrandMarks';

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
    openLavraySearch,
    adBlockStats,
    adBlockPopoverOpen,
    setAdBlockPopoverOpen,
    profilePopoverOpen,
    setProfilePopoverOpen,
    pushToast
  } = useLavrayStore();

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const isNewTab = !activeTab?.url || activeTab.url === 'about:blank' || activeTab.url === 'lavray://newtab';
  const [inputValue, setInputValue] = useState(isNewTab ? '' : activeTab.url);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<OmniboxSuggestion[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const agentBusy = Boolean(
    activeRun && ['planning', 'executing', 'verifying', 'paused', 'awaiting_hitl'].includes(activeRun.status)
  );

  useEffect(() => {
    if (!focused && activeTab) {
      const blank = !activeTab.url || activeTab.url === 'about:blank' || activeTab.url === 'lavray://newtab';
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
      const sugg = await window.lavray.getSuggestions(val);
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
    await window.lavray.navigate(activeTab.id, target);
  };

  const handleBookmarkCurrent = async () => {
    if (!activeTab || isNewTab) return;
    await window.lavray.addBookmark(activeTab.url, activeTab.title || activeTab.url);
    pushToast('Bookmarked page', 'success');
  };

  const handleKillSwitch = async () => {
    await window.lavray.triggerKillSwitch();
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
      className={`relative flex h-11 items-center justify-between gap-2.5 border-b border-lavray-border bg-lavray-surface px-3 select-none ${
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
              ? 'bg-lavray-elevated text-lavray-text'
              : 'text-lavray-secondary hover:bg-lavray-elevated hover:text-lavray-text'
          }`}
        >
          <PanelLeft className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          disabled={!activeTab?.canGoBack}
          onClick={() => activeTab && window.lavray.goBack(activeTab.id)}
          title="Back"
          aria-label="Back"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-lavray-secondary hover:bg-lavray-elevated hover:text-lavray-text disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          disabled={!activeTab?.canGoForward}
          onClick={() => activeTab && window.lavray.goForward(activeTab.id)}
          title="Forward"
          aria-label="Forward"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-lavray-secondary hover:bg-lavray-elevated hover:text-lavray-text disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ArrowRight className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={() =>
            activeTab &&
            (activeTab.isLoading
              ? window.lavray.stopLoading(activeTab.id)
              : window.lavray.reload(activeTab.id))
          }
          title={activeTab?.isLoading ? 'Stop Loading' : 'Reload'}
          aria-label={activeTab?.isLoading ? 'Stop Loading' : 'Reload'}
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-lavray-secondary hover:bg-lavray-elevated hover:text-lavray-text transition-colors"
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
            if (activeTab) void window.lavray.goHome(activeTab.id);
          }}
          title="Home / Start Page"
          aria-label="Home"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-lavray-secondary hover:bg-lavray-elevated hover:text-lavray-text transition-colors"
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
          className={`relative flex items-center gap-2 rounded-[9px] border px-2.5 h-[30px] transition-colors duration-150 ease-lavray ${
            focused
              ? 'border-lavray-accent/80 bg-lavray-surface ring-2 ring-lavray-accent/15'
              : 'border-lavray-border bg-lavray-shell/70 hover:bg-lavray-shell hover:border-lavray-border-strong'
          }`}
        >
          {/* Connection Status */}
          <span
            title={
              isNewTab
                ? 'LAVRAY Start Page'
                : activeTab?.securityState === 'secure'
                ? 'Connection is secure (HTTPS)'
                : activeTab?.securityState === 'insecure'
                ? 'Not secure (HTTP)'
                : 'LAVRAY Internal'
            }
            className="flex items-center shrink-0"
          >
            {isNewTab ? (
              <LavrayMark className="h-3.5 w-3.5 text-lavray-accent" />
            ) : activeTab?.securityState === 'secure' ? (
              <Lock className="h-3.5 w-3.5 text-lavray-success" strokeWidth={1.75} aria-label="HTTPS Secure" />
            ) : activeTab?.securityState === 'insecure' ? (
              <Unlock className="h-3.5 w-3.5 text-lavray-warning" strokeWidth={1.75} aria-label="Not Secure" />
            ) : (
              <Shield className="h-3.5 w-3.5 text-lavray-muted" strokeWidth={1.75} />
            )}
          </span>

          <input
            ref={inputRef}
            value={inputValue}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 180)}
            onChange={(e) => void handleInputChange(e.target.value)}
            placeholder="Search or enter website URL..."
            className="flex-1 min-w-0 bg-transparent text-[13px] text-lavray-text placeholder:text-lavray-muted outline-none select-text"
          />

          {/* Compact Inline Page Controls */}
          <div className="flex items-center gap-0.5 shrink-0">
            <div className="relative">
              <button
                type="button"
                data-testid="adblock-shield-btn"
                onClick={() => setAdBlockPopoverOpen(!adBlockPopoverOpen)}
                title={`LAVRAY Shield: ${activeTab?.blockedCount ?? 0} blocked on this tab`}
                className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                  isAllowlisted || !adBlockStats?.globalEnabled
                    ? 'text-lavray-warning hover:bg-lavray-elevated'
                    : (activeTab?.blockedCount ?? 0) > 0
                    ? 'text-lavray-accent hover:bg-lavray-elevated'
                    : 'text-lavray-muted hover:text-lavray-text hover:bg-lavray-elevated'
                }`}
              >
                {isAllowlisted ? (
                  <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <Shield className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                {(activeTab?.blockedCount ?? 0) > 0 && <span>{activeTab?.blockedCount}</span>}
              </button>
              {adBlockPopoverOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setAdBlockPopoverOpen(false)}
                  />
                  <AdBlockerPopover
                    activeTab={activeTab}
                    currentDomain={currentDomain}
                    onClose={() => setAdBlockPopoverOpen(false)}
                  />
                </>
              )}
            </div>

            {!isNewTab && (
              <>
                <button
                  type="button"
                  onClick={() => void handleBookmarkCurrent()}
                  title="Bookmark this page"
                  aria-label="Bookmark this page"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-lavray-muted hover:text-lavray-warning hover:bg-lavray-elevated transition-colors"
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
                      ? 'bg-lavray-accent/12 text-lavray-accent'
                      : 'text-lavray-muted hover:text-lavray-text hover:bg-lavray-elevated'
                  }`}
                >
                  <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </>
            )}
          </div>

          {/* Hairline Page Loading Indicator */}
          {activeTab?.isLoading && (
            <div className="pointer-events-none absolute bottom-0 left-2 right-2 h-[1.5px] overflow-hidden rounded-full bg-lavray-accent/15">
              <div className="lavray-loading-bar h-full w-1/3 rounded-full bg-lavray-accent" />
            </div>
          )}
        </form>

        {/* Liquid Glass Omnibox Suggestions */}
        {focused && suggestions.length > 0 && (
          <div className="lavray-glass absolute left-0 right-0 top-9 z-40 rounded-xl border border-lavray-border p-1.5 shadow-lavray-float">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                void navigateTo(`lavray://search?q=${encodeURIComponent(inputValue.trim())}`);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg bg-lavray-accent/10 px-3 py-2 text-left text-xs text-lavray-accent hover:bg-lavray-accent/15 transition-colors"
            >
              <span className="flex items-center gap-2 truncate font-medium">
                <Search className="h-3.5 w-3.5 shrink-0" />
                Search LAVRAY for &ldquo;{inputValue}&rdquo;
              </span>
              <span className="shrink-0 text-[10.5px] font-medium opacity-80">LAVRAY Search</span>
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
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-xs hover:bg-lavray-elevated/80 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-lavray-text">{s.title}</div>
                    <div className="truncate text-[11px] text-lavray-muted">{s.url}</div>
                  </div>
                  <span className="shrink-0 text-[10.5px] text-lavray-muted">{s.subtitle || s.type}</span>
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
            title="Emergency Stop HAYA (Cmd/Ctrl+Shift+Esc)"
            className="flex h-7 items-center gap-1.5 rounded-[7px] border border-lavray-danger/35 bg-lavray-danger/10 px-2.5 text-[11.5px] font-medium text-lavray-danger hover:bg-lavray-danger/15 transition-colors"
          >
            <OctagonAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Stop</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => (activeOverlayView === 'search' ? setOverlayView(null) : openLavraySearch(''))}
          title="LAVRAY Intelligent Search"
          aria-label="LAVRAY Intelligent Search"
          className={`flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] font-medium transition-colors ${
            activeOverlayView === 'search'
              ? 'bg-lavray-accent/12 text-lavray-accent'
              : 'text-lavray-secondary hover:bg-lavray-elevated hover:text-lavray-text'
          }`}
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="hidden xl:inline">Search</span>
        </button>

        <button
          type="button"
          onClick={() => setAgentPanelOpen(!agentPanelOpen)}
          title="Toggle HAYA (HAYAGRIVA) AI Panel"
          aria-label="Toggle HAYA (HAYAGRIVA) AI Panel"
          className={`flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 text-[12px] font-medium transition-colors ${
            agentPanelOpen
              ? 'border-lavray-accent/35 bg-lavray-accent/10 text-lavray-accent'
              : 'border-lavray-border bg-lavray-surface text-lavray-secondary hover:bg-lavray-elevated hover:text-lavray-text'
          }`}
        >
          <HayaMark className="h-3.5 w-3.5" />
          <AskHayaLoopLabel />
        </button>

        {/* Profile Icon & Dropdown between Ask HAYA and Hamburger Menu */}
        <div className="relative">
          <button
            type="button"
            data-testid="profile-menu-btn"
            onClick={() => {
              setMenuOpen(false);
              setProfilePopoverOpen(!profilePopoverOpen);
            }}
            title="LAVRAY Profile & Account"
            aria-label="LAVRAY Profile & Account"
            className={`flex h-7 w-7 items-center justify-center rounded-full p-[1.5px] transition-all ${
              profilePopoverOpen
                ? 'bg-gradient-to-tr from-blue-500 via-indigo-500 to-purple-500 ring-2 ring-lavray-accent/25'
                : 'bg-gradient-to-tr from-blue-500/75 via-indigo-500/75 to-purple-500/75 hover:from-blue-500 hover:to-purple-500'
            }`}
          >
            <span className="flex h-full w-full items-center justify-center rounded-full bg-lavray-surface text-[11px] font-semibold text-lavray-text">
              <User className="h-3.5 w-3.5" strokeWidth={1.85} />
            </span>
          </button>

          {profilePopoverOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setProfilePopoverOpen(false)}
              />
              <ProfilePopover onClose={() => setProfilePopoverOpen(false)} />
            </>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setProfilePopoverOpen(false);
              setMenuOpen((o) => !o);
            }}
            title="Browser & Workspace Menu"
            aria-label="Browser Menu"
            className={`flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors ${
              menuOpen
                ? 'bg-lavray-elevated text-lavray-text'
                : 'text-lavray-secondary hover:bg-lavray-elevated hover:text-lavray-text'
            }`}
          >
            {menuOpen ? <X className="h-4 w-4" strokeWidth={1.75} /> : <Menu className="h-4 w-4" strokeWidth={1.75} />}
          </button>

          {menuOpen && (
            <div
              onMouseLeave={() => setMenuOpen(false)}
              className="lavray-glass absolute right-0 top-9 z-50 w-60 rounded-xl border border-lavray-border p-1.5 shadow-lavray-float text-xs"
            >
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-lavray-muted">
                Library
              </div>
              <MenuBtn icon={<History className="h-3.5 w-3.5" />} label="History" onClick={() => { setOverlayView('history'); setMenuOpen(false); }} />
              <MenuBtn icon={<Bookmark className="h-3.5 w-3.5" />} label="Bookmarks" onClick={() => { setOverlayView('bookmarks'); setMenuOpen(false); }} />
              <MenuBtn icon={<Download className="h-3.5 w-3.5" />} label="Downloads" onClick={() => { setOverlayView('downloads'); setMenuOpen(false); }} />

              <div className="my-1 border-t border-lavray-border" />
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-lavray-muted">
                Research & Automation
              </div>
              <MenuBtn icon={<Search className="h-3.5 w-3.5" />} label="LAVRAY Intelligent Search" onClick={() => { openLavraySearch(''); setMenuOpen(false); }} />
              <MenuBtn icon={<Sparkles className="h-3.5 w-3.5" />} label="Research Workspace" onClick={() => { setOverlayView('intelligence'); setMenuOpen(false); }} />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Structured Extraction" onClick={() => { setOverlayView('extract'); setMenuOpen(false); }} />
              <MenuBtn icon={<Bot className="h-3.5 w-3.5" />} label="Skills Library" onClick={() => { setOverlayView('skills'); setMenuOpen(false); }} />
              <MenuBtn icon={<BookOpen className="h-3.5 w-3.5" />} label="Local Memory" onClick={() => { setOverlayView('memory'); setMenuOpen(false); }} />
              <MenuBtn icon={<RotateCw className="h-3.5 w-3.5" />} label="Run History & Replay" onClick={() => { setOverlayView('runs'); setMenuOpen(false); }} />
              <MenuBtn icon={<Shield className="h-3.5 w-3.5" />} label="Scheduled Tasks" onClick={() => { setOverlayView('scheduler'); setMenuOpen(false); }} />

              <div className="my-1 border-t border-lavray-border" />
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-lavray-muted">
                Privacy & System
              </div>
              <MenuBtn icon={<Lock className="h-3.5 w-3.5" />} label="New Private Window" onClick={() => { void window.lavray.newPrivateWindow(); setMenuOpen(false); }} />
              <MenuBtn icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Privacy, Rules & Audit" onClick={() => { setOverlayView('audit'); setMenuOpen(false); }} />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Observability & Costs" onClick={() => { setOverlayView('dashboard'); setMenuOpen(false); }} />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Local MCP Server" onClick={() => { setOverlayView('mcp'); setMenuOpen(false); }} />
              <MenuBtn icon={<OctagonAlert className="h-3.5 w-3.5" />} label="Emergency Stop HAYA" danger onClick={() => { void handleKillSwitch(); setMenuOpen(false); }} />
              <div className="my-1 border-t border-lavray-border" />
              <MenuBtn icon={<Code2 className="h-3.5 w-3.5" />} label="Developer Tools" onClick={() => { if (activeTab && !isNewTab) void window.lavray.openDevTools(activeTab.id); setMenuOpen(false); }} />
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
      danger ? 'text-lavray-danger hover:bg-lavray-danger/10' : 'text-lavray-text hover:bg-lavray-elevated/80'
    }`}
  >
    <span className={danger ? 'text-lavray-danger' : 'text-lavray-muted'}>{icon}</span>
    <span>{label}</span>
  </button>
);

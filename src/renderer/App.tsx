import React, { useEffect } from 'react';
import { useLavrayStore } from './store/useLavrayStore';
import { TabBar } from './components/TabBar';
import { AddressBar } from './components/AddressBar';
import { SidebarRail } from './components/SidebarRail';
import { AgentPanel } from './components/AgentPanel';
import { NewTabView } from './components/NewTabView';
import { HitlBanner } from './components/HitlBanner';
import { FindBar } from './components/FindBar';
import { TabSearchModal } from './components/TabSearchModal';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { SelectionOverlay } from './components/SelectionOverlay';
import { ReaderView } from './components/ReaderView';
import { SettingsView } from './components/views/SettingsView';
import { BookmarksView, DownloadsView, HistoryView } from './components/views/BrowserDataViews';
import { ExtractionView, MemoryView, SkillsView } from './components/views/SkillsAndMemoryViews';
import { AuditAndRulesView, DashboardView, McpServerView, RunsAndReplayView, SchedulerView } from './components/views/OperationsViews';
import { IntelligenceView } from './components/views/IntelligenceView';
import { SearchView } from './components/views/SearchView';

export const App: React.FC = () => {
  const {
    tabs,
    activeTabId,
    verticalTabs,
    sidebarOpen,
    setSidebarOpen,
    agentPanelOpen,
    agentPanelWidth,
    activeOverlayView,
    setOverlayView,
    hitlPause,
    settings,
    toasts,
    dismissToast,
    setTabsState,
    setConversations,
    setActiveConversationId,
    setMessages,
    setActiveRun,
    appendStreamDelta,
    clearStreamBuffer,
    upsertSubAgent,
    pushConfirmation,
    setHitlPause,
    setSelectionOverlay,
    upsertDownload,
    setAdBlockStats,
    setSettings,
    setProviderStatus,
    setSkillSuggestion,
    setProactiveSuggestions,
    setFindBarOpen,
    setTabSearchOpen,
    setAgentPanelOpen,
    pushToast
  } = useLavrayStore();

  // Bootstrap initial state and IPC event listeners
  useEffect(() => {
    void (async () => {
      const [tabData, convs, appSettings, adStats, dls, provStatus] = await Promise.all([
        window.lavray.listTabs(),
        window.lavray.listConversations(),
        window.lavray.getSettings(),
        window.lavray.getAdBlockStats(),
        window.lavray.listDownloads(),
        window.lavray.getProviderStatus()
      ]);

      setTabsState(tabData);
      setSettings(appSettings);
      setProviderStatus(provStatus);
      setAdBlockStats(adStats);
      useLavrayStore.getState().setDownloads(dls);
      if (appSettings.proactiveAssistanceEnabled && tabData.activeTabId) {
        void window.lavray.checkProactiveSuggestions(tabData.activeTabId).then(setProactiveSuggestions);
      }

      setConversations(convs);
      if (convs[0]) {
        setActiveConversationId(convs[0].id);
        const msgs = await window.lavray.getMessages(convs[0].id);
        setMessages(msgs);
      }
    })();

    const unsubTabs = window.lavray.onTabsChanged((data) => {
      setTabsState(data);
    });

    const unsubDownloads = window.lavray.onDownloadUpdated((item) => {
      upsertDownload(item);
    });

    const unsubConfirm = window.lavray.onConfirmationRequest((req) => {
      pushConfirmation(req);
    });

    const unsubHitl = window.lavray.onHitlPause((pause) => {
      setHitlPause(pause);
    });

    const unsubSelection = window.lavray.onContentSelection((data) => {
      setSelectionOverlay(data.text ? data : null);
    });

    const unsubContextAction = window.lavray.onContentContextAction(async (data) => {
      const state = useLavrayStore.getState();
      if (!state.activeConversationId) return;
      setAgentPanelOpen(true);
      const goalMap: Record<string, string> = {
        ask_page: 'Analyze the current page and explain its key purpose and details.',
        summarize_page: '/summarize',
        explain_selection: `Explain this selected text in detail:\n\n"${data.selectedText || ''}"`,
        translate_selection: `Translate this selected text clearly:\n\n"${data.selectedText || ''}"`,
        extract_info: '/extract'
      };
      await window.lavray.startAgentRun({
        conversationId: state.activeConversationId,
        tabId: data.tabId,
        goal: goalMap[data.action] || 'Analyze this page.',
        mode: 'ask',
        selectedText: data.selectedText
      });
    });

    const unsubAgent = window.lavray.onAgentEvent((ev) => {
      if (ev.type === 'run_updated') {
        setActiveRun(ev.run);
        if (['completed', 'failed', 'cancelled', 'budget_exceeded'].includes(ev.run.status)) {
          clearStreamBuffer();
          const cid = useLavrayStore.getState().activeConversationId;
          if (cid) {
            void window.lavray.getMessages(cid).then(setMessages);
          }
        }
      } else if (ev.type === 'step_added') {
        const cur = useLavrayStore.getState().activeRun;
        if (cur && cur.id === ev.runId) {
          const exists = cur.steps.some((s) => s.id === ev.step.id);
          if (!exists) {
            setActiveRun({ ...cur, steps: [...cur.steps, ev.step] });
          }
        }
      } else if (ev.type === 'stream_delta') {
        appendStreamDelta(ev.delta);
      } else if (ev.type === 'subagent_updated') {
        upsertSubAgent(ev.progress);
      } else if (ev.type === 'hitl_resumed') {
        setHitlPause(null);
      } else if (ev.type === 'budget_warning') {
        pushToast(ev.message, 'warning');
      } else if (ev.type === 'skill_suggestion') {
        setSkillSuggestion(ev.suggestion);
      }
    });

    return () => {
      unsubTabs();
      unsubDownloads();
      unsubConfirm();
      unsubHitl();
      unsubSelection();
      unsubContextAction();
      unsubAgent();
    };
  }, []);

  // Theme application (light default)
  useEffect(() => {
    const theme = settings?.theme ?? 'light';
    const root = document.documentElement;
    const apply = (dark: boolean) => {
      root.classList.toggle('dark', dark);
    };
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    apply(theme === 'dark');
    return undefined;
  }, [settings?.theme]);

  // Keep provider status fresh whenever self-hosted model settings change
  useEffect(() => {
    void window.lavray.getProviderStatus().then(setProviderStatus);
  }, [settings?.selfHostedModel, settings?.selfHostedEndpointUrl, settings?.defaultModel]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const isNewTab = Boolean(
    activeTab && (activeTab.url === 'lavray://newtab' || activeTab.url === 'about:blank')
  );

  // Sync Electron WebContentsView insets whenever UI panels change
  useEffect(() => {
    const topInset = (verticalTabs ? 44 : 82) + (hitlPause ? 40 : 0);
    const leftInset = (sidebarOpen ? 44 : 0) + (verticalTabs ? 224 : 0);
    const rightInset = agentPanelOpen ? agentPanelWidth : 0;
    void window.lavray.setLayout({
      topInset,
      leftInset,
      rightInset,
      hideBrowserView: Boolean(activeOverlayView) || isNewTab
    });
  }, [verticalTabs, sidebarOpen, agentPanelOpen, agentPanelWidth, activeOverlayView, isNewTab, hitlPause]);

  // Global browser keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'b') {
        e.preventDefault();
        setSidebarOpen(!useLavrayStore.getState().sidebarOpen);
      } else if (mod && key === 't' && !e.shiftKey) {
        e.preventDefault();
        void window.lavray.createTab({ url: 'lavray://newtab', activate: true });
      } else if (mod && e.shiftKey && key === 't') {
        e.preventDefault();
        void window.lavray.restoreClosedTab();
      } else if (mod && key === 'w') {
        e.preventDefault();
        const tid = useLavrayStore.getState().activeTabId;
        if (tid) void window.lavray.closeTab(tid);
      } else if (mod && key === 'r') {
        e.preventDefault();
        const tid = useLavrayStore.getState().activeTabId;
        if (tid) void window.lavray.reload(tid);
      } else if (mod && key === 'f') {
        e.preventDefault();
        setFindBarOpen(true);
      } else if (mod && e.shiftKey && key === 'a') {
        e.preventDefault();
        setTabSearchOpen(true);
      } else if (mod && e.shiftKey && key === 'n') {
        e.preventDefault();
        void window.lavray.newPrivateWindow();
      } else if (e.key === 'Escape') {
        setFindBarOpen(false);
        setTabSearchOpen(false);
        setOverlayView(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const renderOverlay = () => {
    switch (activeOverlayView) {
      case 'reader':
        return <ReaderView />;
      case 'settings':
        return <SettingsView />;
      case 'history':
        return <HistoryView />;
      case 'bookmarks':
        return <BookmarksView />;
      case 'downloads':
        return <DownloadsView />;
      case 'skills':
        return <SkillsView />;
      case 'runs':
        return <RunsAndReplayView />;
      case 'memory':
        return <MemoryView />;
      case 'dashboard':
        return <DashboardView />;
      case 'extract':
        return <ExtractionView />;
      case 'scheduler':
        return <SchedulerView />;
      case 'mcp':
        return <McpServerView />;
      case 'audit':
        return <AuditAndRulesView />;
      case 'intelligence':
        return <IntelligenceView />;
      case 'search':
        return <SearchView />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-lavray-bg text-lavray-text overflow-hidden">
      {!verticalTabs && <TabBar vertical={false} />}
      <AddressBar />
      <HitlBanner />

      <div className="relative flex flex-1 min-h-0">
        <SidebarRail />
        {verticalTabs && <TabBar vertical={true} />}

        <main className="relative flex-1 min-w-0 bg-lavray-bg">
          {activeOverlayView ? (
            <div className="absolute inset-0 z-20">{renderOverlay()}</div>
          ) : isNewTab ? (
            <NewTabView />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-lavray-muted">
              Loading page...
            </div>
          )}
        </main>

        <AgentPanel />
      </div>

      <FindBar />
      <TabSearchModal />
      <ConfirmationDialog />
      <SelectionOverlay />

      {/* Toast Stack */}
      {toasts.length > 0 && (
        <div className={`fixed bottom-4 z-50 space-y-1.5 ${sidebarOpen ? 'left-14' : 'left-4'}`}>
          {toasts.map((t) => (
            <div
              key={t.id}
              onClick={() => dismissToast(t.id)}
              className={`lavray-glass cursor-pointer rounded-xl border px-3.5 py-2 text-xs font-medium shadow-lavray-float transition-opacity ${
                t.tone === 'danger'
                  ? 'border-lavray-danger/40 text-lavray-danger'
                  : t.tone === 'warning'
                  ? 'border-lavray-warning/40 text-lavray-warning'
                  : t.tone === 'success'
                  ? 'border-lavray-success/40 text-lavray-success'
                  : 'border-lavray-border text-lavray-text'
              }`}
            >
              {t.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

import React, { useEffect } from 'react';
import { useAtlasStore } from './store/useAtlasStore';
import { TabBar } from './components/TabBar';
import { AddressBar } from './components/AddressBar';
import { AgentPanel } from './components/AgentPanel';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { HitlBanner } from './components/HitlBanner';
import { FindBar } from './components/FindBar';
import { TabSearchModal } from './components/TabSearchModal';
import { SelectionOverlay } from './components/SelectionOverlay';
import { ReaderView } from './components/ReaderView';
import { BookmarksView, DownloadsView, HistoryView } from './components/views/BrowserDataViews';
import { ExtractionView, MemoryView, SkillsView } from './components/views/SkillsAndMemoryViews';
import {
  AuditAndRulesView,
  DashboardView,
  McpServerView,
  RunsAndReplayView,
  SchedulerView
} from './components/views/OperationsViews';
import { SettingsView } from './components/views/SettingsView';
import { IntelligenceView } from './components/views/IntelligenceView';

export const App: React.FC = () => {
  const {
    verticalTabs,
    agentPanelOpen,
    agentPanelWidth,
    activeOverlayView,
    confirmationQueue,
    tabSearchOpen,
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
  } = useAtlasStore();

  // Bootstrap initial state and IPC event listeners
  useEffect(() => {
    void (async () => {
      const [tabData, convs, appSettings, adStats, dls, provStatus] = await Promise.all([
        window.atlas.listTabs(),
        window.atlas.listConversations(),
        window.atlas.getSettings(),
        window.atlas.getAdBlockStats(),
        window.atlas.listDownloads(),
        window.atlas.getProviderStatus()
      ]);

      setTabsState(tabData);
      setSettings(appSettings);
      setProviderStatus(provStatus);
      setAdBlockStats(adStats);
      useAtlasStore.getState().setDownloads(dls);
      if (appSettings.proactiveAssistanceEnabled && tabData.activeTabId) {
        void window.atlas.checkProactiveSuggestions(tabData.activeTabId).then(setProactiveSuggestions);
      }

      setConversations(convs);
      if (convs[0]) {
        setActiveConversationId(convs[0].id);
        const msgs = await window.atlas.getMessages(convs[0].id);
        setMessages(msgs);
      }
    })();

    const unsubTabs = window.atlas.onTabsChanged((data) => {
      setTabsState(data);
    });

    const unsubDownloads = window.atlas.onDownloadUpdated((item) => {
      upsertDownload(item);
    });

    const unsubConfirm = window.atlas.onConfirmationRequest((req) => {
      pushConfirmation(req);
    });

    const unsubHitl = window.atlas.onHitlPause((pause) => {
      setHitlPause(pause);
    });

    const unsubSelection = window.atlas.onContentSelection((data) => {
      setSelectionOverlay(data.text ? data : null);
    });

    const unsubContextAction = window.atlas.onContentContextAction(async (data) => {
      const state = useAtlasStore.getState();
      if (!state.activeConversationId) return;
      setAgentPanelOpen(true);
      const goalMap: Record<string, string> = {
        ask_page: 'Analyze the current page and explain its key purpose and details.',
        summarize_page: '/summarize',
        explain_selection: `Explain this selected text in detail:\n\n"${data.selectedText || ''}"`,
        translate_selection: `Translate this selected text clearly:\n\n"${data.selectedText || ''}"`,
        extract_info: '/extract'
      };
      await window.atlas.startAgentRun({
        conversationId: state.activeConversationId,
        tabId: data.tabId,
        goal: goalMap[data.action] || 'Analyze this page.',
        mode: 'ask',
        selectedText: data.selectedText
      });
    });

    const unsubAgent = window.atlas.onAgentEvent((ev) => {
      if (ev.type === 'run_updated') {
        setActiveRun(ev.run);
        if (['completed', 'failed', 'cancelled', 'budget_exceeded'].includes(ev.run.status)) {
          clearStreamBuffer();
          const cid = useAtlasStore.getState().activeConversationId;
          if (cid) {
            void window.atlas.getMessages(cid).then(setMessages);
          }
        }
      } else if (ev.type === 'step_added') {
        const cur = useAtlasStore.getState().activeRun;
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

  // Theme application
  useEffect(() => {
    const theme = settings?.theme ?? 'dark';
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

  // Synchronize WebContentsView layout bounds with React shell geometry
  useEffect(() => {
    const topInset = (verticalTabs ? 48 : 88) + (hitlPause ? 40 : 0);
    const leftInset = verticalTabs ? 224 : 0;
    const rightInset = agentPanelOpen ? agentPanelWidth : 0;
    const hideBrowserView = Boolean(
      activeOverlayView !== null || confirmationQueue.length > 0 || tabSearchOpen
    );
    void window.atlas.setLayout({ topInset, leftInset, rightInset, hideBrowserView });
  }, [
    verticalTabs,
    agentPanelOpen,
    agentPanelWidth,
    activeOverlayView,
    confirmationQueue.length,
    tabSearchOpen,
    hitlPause
  ]);

  // Browser keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const state = useAtlasStore.getState();

      if (key === 't' && !e.shiftKey) {
        e.preventDefault();
        void window.atlas.createTab({ activate: true });
      } else if (key === 't' && e.shiftKey) {
        e.preventDefault();
        void window.atlas.restoreClosedTab();
      } else if (key === 'w') {
        e.preventDefault();
        if (state.activeTabId) void window.atlas.closeTab(state.activeTabId);
      } else if (key === 'r') {
        e.preventDefault();
        if (state.activeTabId) void window.atlas.reload(state.activeTabId);
      } else if (key === 'f') {
        e.preventDefault();
        setFindBarOpen(true);
      } else if (key === 'a' && e.shiftKey) {
        e.preventDefault();
        setTabSearchOpen(true);
      } else if (key === 'n' && e.shiftKey) {
        e.preventDefault();
        void window.atlas.newPrivateWindow();
      } else if (key === '=' || key === '+') {
        e.preventDefault();
        if (state.activeTabId) void window.atlas.setZoom(state.activeTabId, 'in');
      } else if (key === '-') {
        e.preventDefault();
        if (state.activeTabId) void window.atlas.setZoom(state.activeTabId, 'out');
      } else if (key === '0') {
        e.preventDefault();
        if (state.activeTabId) void window.atlas.setZoom(state.activeTabId, 'reset');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const renderOverlay = () => {
    switch (activeOverlayView) {
      case 'history':
        return <HistoryView />;
      case 'bookmarks':
        return <BookmarksView />;
      case 'downloads':
        return <DownloadsView />;
      case 'skills':
        return <SkillsView />;
      case 'memory':
        return <MemoryView />;
      case 'runs':
        return <RunsAndReplayView />;
      case 'dashboard':
        return <DashboardView />;
      case 'settings':
        return <SettingsView />;
      case 'reader':
        return <ReaderView />;
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
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-atlas-bg text-atlas-text overflow-hidden">
      {!verticalTabs && <TabBar vertical={false} />}
      <AddressBar />
      <HitlBanner />

      <div className="relative flex flex-1 min-h-0">
        {verticalTabs && <TabBar vertical={true} />}

        <main className="relative flex-1 min-w-0 bg-atlas-bg">
          {activeOverlayView ? (
            <div className="absolute inset-0 z-20">{renderOverlay()}</div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-atlas-muted">
              Loading web viewport...
            </div>
          )}
        </main>

        <AgentPanel />
      </div>

      <FindBar />
      <TabSearchModal />
      <ConfirmationDialog />
      <SelectionOverlay />

      {/* Toast stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 left-4 z-50 space-y-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              onClick={() => dismissToast(t.id)}
              className={`cursor-pointer rounded-xl border px-3.5 py-2 text-xs font-medium shadow-xl ${
                t.tone === 'danger'
                  ? 'border-atlas-danger/50 bg-atlas-danger text-white'
                  : t.tone === 'warning'
                  ? 'border-atlas-warning/50 bg-atlas-surface text-atlas-warning'
                  : t.tone === 'success'
                  ? 'border-atlas-success/50 bg-atlas-surface text-atlas-success'
                  : 'border-atlas-border bg-atlas-surface text-atlas-text'
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

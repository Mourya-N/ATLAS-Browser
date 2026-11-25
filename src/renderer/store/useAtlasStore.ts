import { create } from 'zustand';
import type {
  AdBlockStats,
  AgentConversation,
  AgentMessage,
  AgentMode,
  AgentRun,
  AppSettings,
  ConfirmationRequest,
  DownloadItem,
  HitlPauseState,
  ProactiveSuggestion,
  ProviderStatusInfo,
  SkillSuggestion,
  SubAgentProgress,
  TabGroup,
  TabInfo
} from '@shared/types';

export type OverlayView =
  | null
  | 'history'
  | 'bookmarks'
  | 'downloads'
  | 'skills'
  | 'memory'
  | 'runs'
  | 'dashboard'
  | 'settings'
  | 'reader'
  | 'extract'
  | 'scheduler'
  | 'mcp'
  | 'audit'
  | 'intelligence'
  | 'search';

export interface ToastItem {
  id: string;
  title: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
}

interface AtlasState {
  tabs: TabInfo[];
  activeTabId: string | null;
  groups: TabGroup[];
  isPrivateWindow: boolean;
  verticalTabs: boolean;
  agentPanelOpen: boolean;
  agentPanelWidth: number;
  activeOverlayView: OverlayView;
  replayRunId: string | null;
  searchInitialQuery: string;
  findBarOpen: boolean;
  tabSearchOpen: boolean;

  conversations: AgentConversation[];
  activeConversationId: string | null;
  messages: AgentMessage[];
  activeRun: AgentRun | null;
  agentMode: AgentMode;
  streamBuffer: string;
  subAgents: Record<string, SubAgentProgress>;
  confirmationQueue: ConfirmationRequest[];
  hitlPause: HitlPauseState | null;
  selectionOverlay: { tabId: string; text: string; x: number; y: number } | null;
  selectedContextTabIds: string[];
  skillSuggestion: SkillSuggestion | null;
  proactiveSuggestions: ProactiveSuggestion[];
  providerStatus: ProviderStatusInfo | null;

  downloads: DownloadItem[];
  adBlockStats: AdBlockStats | null;
  settings: AppSettings | null;
  toasts: ToastItem[];

  setTabsState: (payload: { tabs: TabInfo[]; activeTabId: string | null; groups: TabGroup[]; isPrivate?: boolean }) => void;
  setVerticalTabs: (v: boolean) => void;
  setAgentPanelOpen: (open: boolean) => void;
  setOverlayView: (view: OverlayView, replayRunId?: string | null) => void;
  openAtlasSearch: (initialQuery?: string) => void;
  setFindBarOpen: (open: boolean) => void;
  setTabSearchOpen: (open: boolean) => void;
  setConversations: (c: AgentConversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  setMessages: (m: AgentMessage[]) => void;
  setActiveRun: (r: AgentRun | null) => void;
  setAgentMode: (m: AgentMode) => void;
  appendStreamDelta: (delta: string) => void;
  clearStreamBuffer: () => void;
  upsertSubAgent: (p: SubAgentProgress) => void;
  pushConfirmation: (req: ConfirmationRequest) => void;
  shiftConfirmation: () => void;
  setHitlPause: (p: HitlPauseState | null) => void;
  setSelectionOverlay: (s: { tabId: string; text: string; x: number; y: number } | null) => void;
  setSelectedContextTabIds: (ids: string[]) => void;
  setSkillSuggestion: (s: SkillSuggestion | null) => void;
  setProactiveSuggestions: (p: ProactiveSuggestion[]) => void;
  setProviderStatus: (s: ProviderStatusInfo | null) => void;
  upsertDownload: (d: DownloadItem) => void;
  setDownloads: (d: DownloadItem[]) => void;
  setAdBlockStats: (s: AdBlockStats) => void;
  setSettings: (s: AppSettings) => void;
  pushToast: (title: string, tone?: ToastItem['tone']) => void;
  dismissToast: (id: string) => void;
}

export const useAtlasStore = create<AtlasState>((set) => ({
  tabs: [],
  activeTabId: null,
  groups: [],
  isPrivateWindow: false,
  verticalTabs: false,
  agentPanelOpen: true,
  agentPanelWidth: 380,
  activeOverlayView: null,
  replayRunId: null,
  searchInitialQuery: '',
  findBarOpen: false,
  tabSearchOpen: false,

  conversations: [],
  activeConversationId: null,
  messages: [],
  activeRun: null,
  agentMode: 'agent',
  streamBuffer: '',
  subAgents: {},
  confirmationQueue: [],
  hitlPause: null,
  selectionOverlay: null,
  selectedContextTabIds: [],
  skillSuggestion: null,
  proactiveSuggestions: [],
  providerStatus: null,

  downloads: [],
  adBlockStats: null,
  settings: null,
  toasts: [],

  setTabsState: (payload) =>
    set((s) => ({
      tabs: payload.tabs,
      activeTabId: payload.activeTabId,
      groups: payload.groups,
      isPrivateWindow: payload.isPrivate ?? s.isPrivateWindow
    })),
  setVerticalTabs: (verticalTabs) => set({ verticalTabs }),
  setAgentPanelOpen: (agentPanelOpen) => set({ agentPanelOpen }),
  setOverlayView: (activeOverlayView, replayRunId = null) =>
    set({ activeOverlayView, replayRunId }),
  openAtlasSearch: (initialQuery = '') =>
    set({ activeOverlayView: 'search', searchInitialQuery: initialQuery }),
  setFindBarOpen: (findBarOpen) => set({ findBarOpen }),
  setTabSearchOpen: (tabSearchOpen) => set({ tabSearchOpen }),
  setConversations: (conversations) => set({ conversations }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  setMessages: (messages) => set({ messages }),
  setActiveRun: (activeRun) => set({ activeRun }),
  setAgentMode: (agentMode) => set({ agentMode }),
  appendStreamDelta: (delta) => set((s) => ({ streamBuffer: s.streamBuffer + delta })),
  clearStreamBuffer: () => set({ streamBuffer: '' }),
  upsertSubAgent: (p) =>
    set((s) => ({ subAgents: { ...s.subAgents, [p.subAgentId]: p } })),
  pushConfirmation: (req) =>
    set((s) => ({ confirmationQueue: [...s.confirmationQueue, req] })),
  shiftConfirmation: () =>
    set((s) => ({ confirmationQueue: s.confirmationQueue.slice(1) })),
  setHitlPause: (hitlPause) => set({ hitlPause }),
  setSelectionOverlay: (selectionOverlay) => set({ selectionOverlay }),
  setSelectedContextTabIds: (selectedContextTabIds) => set({ selectedContextTabIds }),
  setSkillSuggestion: (skillSuggestion) => set({ skillSuggestion }),
  setProactiveSuggestions: (proactiveSuggestions) => set({ proactiveSuggestions }),
  setProviderStatus: (providerStatus) => set({ providerStatus }),
  upsertDownload: (d) =>
    set((s) => {
      const idx = s.downloads.findIndex((x) => x.id === d.id);
      if (idx === -1) return { downloads: [d, ...s.downloads] };
      const next = [...s.downloads];
      next[idx] = d;
      return { downloads: next };
    }),
  setDownloads: (downloads) => set({ downloads }),
  setAdBlockStats: (adBlockStats) => set({ adBlockStats }),
  setSettings: (settings) => set({ settings, verticalTabs: settings.verticalTabs }),
  pushToast: (title, tone = 'info') =>
    set((s) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setTimeout(() => {
        useAtlasStore.getState().dismissToast(id);
      }, 4500);
      return { toasts: [...s.toasts.slice(-4), { id, title, tone }] };
    }),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}));

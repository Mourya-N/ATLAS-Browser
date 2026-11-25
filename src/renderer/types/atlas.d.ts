import type {
  AdBlockStats,
  AgentConversation,
  AgentMessage,
  AgentMode,
  AgentRun,
  AppSettings,
  AuditEvent,
  BookmarkEntry,
  BookmarkFolder,
  ConfirmationRequest,
  ConfirmationResponse,
  CostSummary,
  DomainPermissionMode,
  DomainRule,
  DownloadItem,
  ExtractionResult,
  HistoryEntry,
  HitlPauseState,
  McpConfig,
  McpServerStatus,
  MemoryCategory,
  MemoryItem,
  OmniboxSuggestion,
  ReaderArticle,
  ScheduledJob,
  ScheduleTriggerType,
  Skill,
  SkillExecution,
  TabGroup,
  TabInfo
} from '@shared/types';

export interface AtlasBridge {
  listTabs: () => Promise<{ tabs: TabInfo[]; activeTabId: string | null; groups: TabGroup[]; isPrivate: boolean }>;
  createTab: (opts?: { url?: string; activate?: boolean; groupId?: string | null }) => Promise<TabInfo>;
  closeTab: (tabId: string) => Promise<boolean>;
  activateTab: (tabId: string) => Promise<boolean>;
  reorderTab: (tabId: string, newIndex: number) => Promise<boolean>;
  duplicateTab: (tabId: string) => Promise<TabInfo | null>;
  pinTab: (tabId: string) => Promise<TabInfo | null>;
  muteTab: (tabId: string) => Promise<TabInfo | null>;
  renameTab: (tabId: string, customTitle: string | null) => Promise<TabInfo | null>;
  restoreClosedTab: () => Promise<TabInfo | null>;
  listTabGroups: () => Promise<TabGroup[]>;
  createTabGroup: (title: string, color?: string) => Promise<TabGroup>;
  updateTabGroup: (groupId: string, patch: { title?: string; color?: string; collapsed?: boolean }) => Promise<TabGroup | null>;
  assignTabGroup: (tabId: string, groupId: string | null) => Promise<boolean>;
  newPrivateWindow: () => Promise<{ windowId: number }>;
  setLayout: (layout: { topInset: number; leftInset: number; rightInset: number; hideBrowserView: boolean }) => Promise<boolean>;
  onTabsChanged: (cb: (data: { tabs: TabInfo[]; activeTabId: string | null; groups: TabGroup[] }) => void) => () => void;

  navigate: (tabId: string, input: string) => Promise<string>;
  goBack: (tabId: string) => Promise<boolean>;
  goForward: (tabId: string) => Promise<boolean>;
  reload: (tabId: string) => Promise<void>;
  stopLoading: (tabId: string) => Promise<void>;
  goHome: (tabId: string) => Promise<string>;
  getSuggestions: (query: string) => Promise<OmniboxSuggestion[]>;
  setZoom: (tabId: string, mode: 'in' | 'out' | 'reset') => Promise<number>;
  findInPage: (tabId: string, text: string, forward?: boolean, findNext?: boolean) => Promise<void>;
  stopFindInPage: (tabId: string) => Promise<void>;
  openDevTools: (tabId: string) => Promise<void>;
  printPage: (tabId: string) => Promise<void>;
  viewPageSource: (tabId: string) => Promise<TabInfo | null>;
  toggleFullscreen: () => Promise<boolean>;
  extractReaderArticle: (tabId: string) => Promise<ReaderArticle | null>;

  listHistory: (query?: string) => Promise<HistoryEntry[]>;
  deleteHistory: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  getTopSites: () => Promise<HistoryEntry[]>;
  listBookmarks: (query?: string) => Promise<{ bookmarks: BookmarkEntry[]; folders: BookmarkFolder[] }>;
  addBookmark: (url: string, title: string, folderId?: string | null) => Promise<BookmarkEntry>;
  updateBookmark: (id: string, patch: { title?: string; url?: string; folderId?: string | null }) => Promise<void>;
  deleteBookmark: (id: string) => Promise<void>;
  createBookmarkFolder: (name: string) => Promise<BookmarkFolder>;

  listDownloads: () => Promise<DownloadItem[]>;
  downloadAction: (id: string, action: 'pause' | 'resume' | 'cancel' | 'open' | 'reveal') => Promise<boolean>;
  onDownloadUpdated: (cb: (item: DownloadItem) => void) => () => void;
  getAdBlockStats: () => Promise<AdBlockStats>;
  toggleAdBlockGlobal: (enabled: boolean) => Promise<AdBlockStats>;
  toggleAdBlockDomain: (domain: string, allow: boolean) => Promise<AdBlockStats>;

  listConversations: () => Promise<AgentConversation[]>;
  createConversation: (title?: string) => Promise<AgentConversation>;
  getMessages: (conversationId: string) => Promise<AgentMessage[]>;
  clearConversation: (conversationId: string) => Promise<void>;
  startAgentRun: (payload: {
    conversationId: string;
    tabId?: string | null;
    goal: string;
    mode: AgentMode;
    selectedText?: string;
  }) => Promise<AgentRun>;
  pauseAgentRun: (runId: string) => Promise<boolean>;
  resumeAgentRun: (runId: string) => Promise<boolean>;
  stopAgentRun: (runId: string) => Promise<boolean>;
  takeoverAgentRun: (runId: string) => Promise<boolean>;
  setAgentMode: (runId: string, mode: AgentMode) => Promise<boolean>;
  listRuns: () => Promise<AgentRun[]>;
  getRun: (runId: string) => Promise<AgentRun | null>;
  readScreenshotDataUrl: (filePath: string) => Promise<string | null>;
  respondConfirmation: (response: ConfirmationResponse) => Promise<boolean>;
  resumeHitl: (runId: string) => Promise<boolean>;
  onAgentEvent: (cb: (event: any) => void) => () => void;
  onConfirmationRequest: (cb: (req: ConfirmationRequest) => void) => () => void;
  onHitlPause: (cb: (pause: HitlPauseState) => void) => () => void;

  triggerKillSwitch: () => Promise<boolean>;
  listDomainRules: () => Promise<DomainRule[]>;
  setDomainRule: (domain: string, mode: DomainPermissionMode, expiresAt?: number | null) => Promise<DomainRule>;
  deleteDomainRule: (id: string) => Promise<void>;
  listAuditEvents: (query?: string, category?: string) => Promise<AuditEvent[]>;
  deleteAuditEvents: (id?: string) => Promise<void>;
  exportAuditEvents: () => Promise<string>;

  listSkills: () => Promise<Skill[]>;
  recordSkillFromRun: (runId: string, name?: string, description?: string) => Promise<Skill>;
  saveSkill: (skill: Skill) => Promise<Skill>;
  deleteSkill: (id: string) => Promise<void>;
  duplicateSkill: (id: string) => Promise<Skill>;
  runSkill: (skillId: string, params: Record<string, unknown>, tabId?: string | null) => Promise<SkillExecution>;
  importSkill: (json: string) => Promise<Skill>;
  exportSkill: (skillId: string) => Promise<string>;
  listSkillExecutions: (skillId: string) => Promise<SkillExecution[]>;

  listMemory: (category?: MemoryCategory) => Promise<MemoryItem[]>;
  searchMemory: (query: string) => Promise<MemoryItem[]>;
  saveMemory: (item: {
    id?: string;
    category: MemoryCategory;
    domain?: string | null;
    title: string;
    content: string;
    confidence?: number;
  }) => Promise<MemoryItem>;
  deleteMemory: (id: string) => Promise<void>;
  clearMemory: () => Promise<void>;
  exportMemory: () => Promise<string>;

  extractStructured: (tabId: string, schemaJson: string, instructions: string) => Promise<ExtractionResult>;
  exportCsv: (records: Array<Record<string, unknown>>) => Promise<string>;

  listScheduledJobs: () => Promise<ScheduledJob[]>;
  saveScheduledJob: (job: {
    id?: string;
    name: string;
    skillId: string;
    triggerType: ScheduleTriggerType;
    cronExpression?: string | null;
    runAt?: number | null;
    timezone?: string;
    maxBudgetUsd?: number;
    allowedDomains?: string[];
  }) => Promise<ScheduledJob>;
  deleteScheduledJob: (id: string) => Promise<void>;
  toggleScheduledJob: (id: string, patch: { enabled?: boolean; paused?: boolean }) => Promise<ScheduledJob | null>;
  runScheduledJobNow: (id: string) => Promise<ScheduledJob>;

  getStatsSummary: () => Promise<CostSummary>;
  getMcpStatus: () => Promise<McpServerStatus>;
  configureMcp: (patch: Partial<McpConfig>) => Promise<McpServerStatus>;
  rotateMcpToken: () => Promise<McpServerStatus>;
  getMcpToken: () => Promise<string>;

  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  setApiKey: (provider: 'gemini' | 'custom_openai_compatible', apiKey: string) => Promise<AppSettings>;
  clearApiKey: () => Promise<AppSettings>;

  onContentSelection: (cb: (data: { tabId: string; text: string; x: number; y: number }) => void) => () => void;
  onContentContextAction: (
    cb: (data: { action: string; tabId: string; url: string; selectedText?: string }) => void
  ) => () => void;
}

declare global {
  interface Window {
    atlas: AtlasBridge;
  }
}

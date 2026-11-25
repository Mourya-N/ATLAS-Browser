import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import type {
  AgentMode,
  AppSettings,
  ConfirmationResponse,
  DomainPermissionMode,
  McpConfig,
  MemoryCategory,
  ScheduleTriggerType,
  Skill
} from '@shared/types';

function invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

function subscribe<T = unknown>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, data: T) => handler(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const atlasApi = {
  // Tabs & Window
  listTabs: () => invoke(IPC_CHANNELS.TAB_LIST),
  createTab: (opts: { url?: string; activate?: boolean; groupId?: string | null } = {}) =>
    invoke(IPC_CHANNELS.TAB_CREATE, opts),
  closeTab: (tabId: string) => invoke(IPC_CHANNELS.TAB_CLOSE, { tabId }),
  activateTab: (tabId: string) => invoke(IPC_CHANNELS.TAB_ACTIVATE, { tabId }),
  reorderTab: (tabId: string, newIndex: number) => invoke(IPC_CHANNELS.TAB_REORDER, { tabId, newIndex }),
  duplicateTab: (tabId: string) => invoke(IPC_CHANNELS.TAB_DUPLICATE, { tabId }),
  pinTab: (tabId: string) => invoke(IPC_CHANNELS.TAB_PIN, { tabId }),
  muteTab: (tabId: string) => invoke(IPC_CHANNELS.TAB_MUTE, { tabId }),
  renameTab: (tabId: string, customTitle: string | null) =>
    invoke(IPC_CHANNELS.TAB_RENAME, { tabId, customTitle }),
  restoreClosedTab: () => invoke(IPC_CHANNELS.TAB_RESTORE_CLOSED),
  listTabGroups: () => invoke(IPC_CHANNELS.TAB_GROUPS_LIST),
  createTabGroup: (title: string, color?: string) => invoke(IPC_CHANNELS.TAB_GROUP_CREATE, { title, color }),
  updateTabGroup: (groupId: string, patch: { title?: string; color?: string; collapsed?: boolean }) =>
    invoke(IPC_CHANNELS.TAB_GROUP_UPDATE, { groupId, ...patch }),
  assignTabGroup: (tabId: string, groupId: string | null) =>
    invoke(IPC_CHANNELS.TAB_GROUP_ASSIGN, { tabId, groupId }),
  newPrivateWindow: () => invoke(IPC_CHANNELS.WINDOW_NEW_PRIVATE),
  setLayout: (layout: { topInset: number; leftInset: number; rightInset: number; hideBrowserView: boolean }) =>
    invoke(IPC_CHANNELS.WINDOW_SET_LAYOUT, layout),
  onTabsChanged: (cb: (data: unknown) => void) => subscribe(IPC_CHANNELS.TAB_STATE_CHANGED, cb),

  // Navigation & Browser Controls
  navigate: (tabId: string, input: string) => invoke(IPC_CHANNELS.NAV_GO, { tabId, input }),
  goBack: (tabId: string) => invoke(IPC_CHANNELS.NAV_BACK, { tabId }),
  goForward: (tabId: string) => invoke(IPC_CHANNELS.NAV_FORWARD, { tabId }),
  reload: (tabId: string) => invoke(IPC_CHANNELS.NAV_RELOAD, { tabId }),
  stopLoading: (tabId: string) => invoke(IPC_CHANNELS.NAV_STOP, { tabId }),
  goHome: (tabId: string) => invoke(IPC_CHANNELS.NAV_HOME, { tabId }),
  getSuggestions: (query: string) => invoke(IPC_CHANNELS.NAV_SUGGESTIONS, { query }),
  setZoom: (tabId: string, mode: 'in' | 'out' | 'reset') => invoke(IPC_CHANNELS.BROWSER_ZOOM, { tabId, mode }),
  findInPage: (tabId: string, text: string, forward = true, findNext = false) =>
    invoke(IPC_CHANNELS.BROWSER_FIND, { tabId, text, forward, findNext }),
  stopFindInPage: (tabId: string) => invoke(IPC_CHANNELS.BROWSER_FIND_STOP, { tabId }),
  openDevTools: (tabId: string) => invoke(IPC_CHANNELS.BROWSER_DEVTOOLS, { tabId }),
  printPage: (tabId: string) => invoke(IPC_CHANNELS.BROWSER_PRINT, { tabId }),
  viewPageSource: (tabId: string) => invoke(IPC_CHANNELS.BROWSER_VIEW_SOURCE, { tabId }),
  toggleFullscreen: () => invoke(IPC_CHANNELS.BROWSER_FULLSCREEN),
  extractReaderArticle: (tabId: string) => invoke(IPC_CHANNELS.BROWSER_READER_EXTRACT, { tabId }),

  // History & Bookmarks
  listHistory: (query = '') => invoke(IPC_CHANNELS.HISTORY_LIST, { query }),
  deleteHistory: (id: string) => invoke(IPC_CHANNELS.HISTORY_DELETE, { id }),
  clearHistory: () => invoke(IPC_CHANNELS.HISTORY_CLEAR),
  getTopSites: () => invoke(IPC_CHANNELS.HISTORY_TOP_SITES),
  listBookmarks: (query = '') => invoke(IPC_CHANNELS.BOOKMARK_LIST, { query }),
  addBookmark: (url: string, title: string, folderId?: string | null) =>
    invoke(IPC_CHANNELS.BOOKMARK_ADD, { url, title, folderId }),
  updateBookmark: (id: string, patch: { title?: string; url?: string; folderId?: string | null }) =>
    invoke(IPC_CHANNELS.BOOKMARK_UPDATE, { id, ...patch }),
  deleteBookmark: (id: string) => invoke(IPC_CHANNELS.BOOKMARK_DELETE, { id }),
  createBookmarkFolder: (name: string) => invoke(IPC_CHANNELS.BOOKMARK_FOLDER_CREATE, { name }),

  // Downloads & AdBlocker
  listDownloads: () => invoke(IPC_CHANNELS.DOWNLOAD_LIST),
  downloadAction: (id: string, action: 'pause' | 'resume' | 'cancel' | 'open' | 'reveal') =>
    invoke(IPC_CHANNELS.DOWNLOAD_ACTION, { id, action }),
  onDownloadUpdated: (cb: (item: unknown) => void) => subscribe(IPC_CHANNELS.DOWNLOAD_UPDATED, cb),
  getAdBlockStats: () => invoke(IPC_CHANNELS.ADBLOCK_STATS),
  toggleAdBlockGlobal: (enabled: boolean) => invoke(IPC_CHANNELS.ADBLOCK_TOGGLE_GLOBAL, { enabled }),
  toggleAdBlockDomain: (domain: string, allow: boolean) =>
    invoke(IPC_CHANNELS.ADBLOCK_TOGGLE_DOMAIN, { domain, allow }),

  // Agent
  listConversations: () => invoke(IPC_CHANNELS.AGENT_LIST_CONVERSATIONS),
  createConversation: (title?: string) => invoke(IPC_CHANNELS.AGENT_CREATE_CONVERSATION, { title }),
  getMessages: (conversationId: string) => invoke(IPC_CHANNELS.AGENT_GET_MESSAGES, { conversationId }),
  clearConversation: (conversationId: string) =>
    invoke(IPC_CHANNELS.AGENT_CLEAR_CONVERSATION, { conversationId }),
  startAgentRun: (payload: {
    conversationId: string;
    tabId?: string | null;
    goal: string;
    mode: AgentMode;
    selectedText?: string;
    selectedTabIds?: string[];
  }) => invoke(IPC_CHANNELS.AGENT_START_RUN, payload),
  pauseAgentRun: (runId: string) => invoke(IPC_CHANNELS.AGENT_PAUSE_RUN, { runId }),
  resumeAgentRun: (runId: string) => invoke(IPC_CHANNELS.AGENT_RESUME_RUN, { runId }),
  stopAgentRun: (runId: string) => invoke(IPC_CHANNELS.AGENT_STOP_RUN, { runId }),
  takeoverAgentRun: (runId: string) => invoke(IPC_CHANNELS.AGENT_TAKEOVER, { runId }),
  setAgentMode: (runId: string, mode: AgentMode) => invoke(IPC_CHANNELS.AGENT_SET_MODE, { runId, mode }),
  listRuns: () => invoke(IPC_CHANNELS.AGENT_LIST_RUNS),
  getRun: (runId: string) => invoke(IPC_CHANNELS.AGENT_GET_RUN, { runId }),
  readScreenshotDataUrl: (filePath: string) => invoke(IPC_CHANNELS.AGENT_READ_SCREENSHOT, { filePath }),
  respondConfirmation: (response: ConfirmationResponse) =>
    invoke(IPC_CHANNELS.AGENT_CONFIRMATION_RESPOND, response),
  resumeHitl: (runId: string) => invoke(IPC_CHANNELS.AGENT_HITL_RESUME, { runId }),
  onAgentEvent: (cb: (event: unknown) => void) => subscribe(IPC_CHANNELS.AGENT_RUN_EVENT, cb),
  onConfirmationRequest: (cb: (req: unknown) => void) =>
    subscribe(IPC_CHANNELS.AGENT_CONFIRMATION_REQUEST, cb),
  onHitlPause: (cb: (pause: unknown) => void) => subscribe(IPC_CHANNELS.AGENT_HITL_PAUSE, cb),

  // Safety & Audit
  triggerKillSwitch: () => invoke(IPC_CHANNELS.KILL_SWITCH_TRIGGER),
  listDomainRules: () => invoke(IPC_CHANNELS.DOMAIN_RULES_LIST),
  setDomainRule: (domain: string, mode: DomainPermissionMode, expiresAt?: number | null) =>
    invoke(IPC_CHANNELS.DOMAIN_RULES_SET, { domain, mode, expiresAt }),
  deleteDomainRule: (id: string) => invoke(IPC_CHANNELS.DOMAIN_RULES_DELETE, { id }),
  listAuditEvents: (query = '', category?: string) => invoke(IPC_CHANNELS.AUDIT_LIST, { query, category }),
  deleteAuditEvents: (id?: string) => invoke(IPC_CHANNELS.AUDIT_DELETE, { id }),
  exportAuditEvents: () => invoke(IPC_CHANNELS.AUDIT_EXPORT),

  // Skills, Memory, Extraction, Scheduler
  listSkills: () => invoke(IPC_CHANNELS.SKILL_LIST),
  recordSkillFromRun: (runId: string, name?: string, description?: string) =>
    invoke(IPC_CHANNELS.SKILL_RECORD_FROM_RUN, { runId, name, description }),
  saveSkill: (skill: Skill) => invoke(IPC_CHANNELS.SKILL_SAVE, { skill }),
  deleteSkill: (id: string) => invoke(IPC_CHANNELS.SKILL_DELETE, { id }),
  duplicateSkill: (id: string) => invoke(IPC_CHANNELS.SKILL_DUPLICATE, { id }),
  runSkill: (skillId: string, params: Record<string, unknown>, tabId?: string | null) =>
    invoke(IPC_CHANNELS.SKILL_RUN, { skillId, params, tabId }),
  importSkill: (json: string) => invoke(IPC_CHANNELS.SKILL_IMPORT, { json }),
  exportSkill: (skillId: string) => invoke(IPC_CHANNELS.SKILL_EXPORT, { skillId }),
  listSkillExecutions: (skillId: string) => invoke(IPC_CHANNELS.SKILL_EXECUTIONS, { skillId }),

  listMemory: (category?: MemoryCategory) => invoke(IPC_CHANNELS.MEMORY_LIST, { category }),
  searchMemory: (query: string) => invoke(IPC_CHANNELS.MEMORY_SEARCH, { query }),
  saveMemory: (item: {
    id?: string;
    category: MemoryCategory;
    domain?: string | null;
    title: string;
    content: string;
    confidence?: number;
  }) => invoke(IPC_CHANNELS.MEMORY_SAVE, item),
  deleteMemory: (id: string) => invoke(IPC_CHANNELS.MEMORY_DELETE, { id }),
  clearMemory: () => invoke(IPC_CHANNELS.MEMORY_CLEAR),
  exportMemory: () => invoke(IPC_CHANNELS.MEMORY_EXPORT),

  extractStructured: (tabId: string, schemaJson: string, instructions: string) =>
    invoke(IPC_CHANNELS.EXTRACT_STRUCTURED, { tabId, schemaJson, instructions }),
  exportCsv: (records: Array<Record<string, unknown>>) =>
    invoke(IPC_CHANNELS.EXTRACT_EXPORT_CSV, { records }),

  listScheduledJobs: () => invoke(IPC_CHANNELS.SCHEDULER_LIST),
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
  }) => invoke(IPC_CHANNELS.SCHEDULER_SAVE, job),
  deleteScheduledJob: (id: string) => invoke(IPC_CHANNELS.SCHEDULER_DELETE, { id }),
  toggleScheduledJob: (id: string, patch: { enabled?: boolean; paused?: boolean }) =>
    invoke(IPC_CHANNELS.SCHEDULER_TOGGLE, { id, ...patch }),
  runScheduledJobNow: (id: string) => invoke(IPC_CHANNELS.SCHEDULER_RUN_NOW, { id }),

  // Stats, MCP, Settings
  getStatsSummary: () => invoke(IPC_CHANNELS.STATS_SUMMARY),
  getMcpStatus: () => invoke(IPC_CHANNELS.MCP_STATUS),
  configureMcp: (patch: Partial<McpConfig>) => invoke(IPC_CHANNELS.MCP_CONFIGURE, patch),
  rotateMcpToken: () => invoke(IPC_CHANNELS.MCP_ROTATE_TOKEN),
  getMcpToken: () => invoke(IPC_CHANNELS.MCP_GET_TOKEN),

  getSettings: () => invoke<AppSettings>(IPC_CHANNELS.SETTINGS_GET),
  updateSettings: (patch: Partial<AppSettings>) => invoke<AppSettings>(IPC_CHANNELS.SETTINGS_UPDATE, patch),
  setApiKey: (provider: 'gemini' | 'self_hosted' | 'custom_openai_compatible', apiKey: string) =>
    invoke(IPC_CHANNELS.SETTINGS_SET_API_KEY, { provider, apiKey }),
  clearApiKey: () => invoke(IPC_CHANNELS.SETTINGS_CLEAR_API_KEY),
  getProviderStatus: () => invoke(IPC_CHANNELS.SETTINGS_PROVIDER_STATUS),
  testProvider: (model?: string) => invoke(IPC_CHANNELS.SETTINGS_TEST_PROVIDER, { model }),
  discoverSelfHostedModels: () => invoke(IPC_CHANNELS.SETTINGS_DISCOVER_MODELS),

  // Advanced Intelligence
  listInterruptedRuns: () => invoke(IPC_CHANNELS.AGENT_LIST_INTERRUPTED),
  resumeCheckpoint: (runId: string) => invoke(IPC_CHANNELS.AGENT_RESUME_CHECKPOINT, { runId }),
  runResearch: (query: string, tabIds?: string[]) => invoke(IPC_CHANNELS.RESEARCH_RUN, { query, tabIds }),
  listResearchReports: () => invoke(IPC_CHANNELS.RESEARCH_LIST),
  exportResearchMarkdown: (reportId: string) => invoke(IPC_CHANNELS.RESEARCH_EXPORT_MD, { reportId }),
  understandPage: (tabId: string, question: string) => invoke(IPC_CHANNELS.PAGE_UNDERSTAND, { tabId, question }),
  semanticSearchPage: (tabId: string, query: string) =>
    invoke(IPC_CHANNELS.PAGE_SEMANTIC_SEARCH, { tabId, query }),
  checkPageChanges: (tabId: string) => invoke(IPC_CHANNELS.PAGE_CHECK_CHANGES, { tabId }),
  analyzeCrossTabs: (tabIds?: string[]) => invoke(IPC_CHANNELS.CROSSTAB_ANALYZE, { tabIds }),
  compareCrossTabs: (criteria: string, tabIds?: string[]) =>
    invoke(IPC_CHANNELS.CROSSTAB_COMPARE, { criteria, tabIds }),
  testSkill: (skillId: string, params: Record<string, unknown>, tabId?: string | null) =>
    invoke(IPC_CHANNELS.SKILL_TEST, { skillId, params, tabId }),
  checkProactiveSuggestions: (tabId?: string | null) => invoke(IPC_CHANNELS.PROACTIVE_CHECK, { tabId }),

  // Atlas Search & Cloud
  executeSearch: (payload: {
    query: string;
    mode?: string;
    filters?: Record<string, unknown>;
    selectedTabIds?: string[];
  }) => invoke(IPC_CHANNELS.SEARCH_EXECUTE, payload),
  openSearchGroup: (title: string, urls: string[]) =>
    invoke(IPC_CHANNELS.SEARCH_OPEN_GROUP, { title, urls }),
  saveSearchToResearch: (
    query: string,
    sources: Array<{ url: string; title: string; snippet?: string }>
  ) => invoke(IPC_CHANNELS.SEARCH_SAVE_TO_RESEARCH, { query, sources }),
  listSearchHistory: () => invoke(IPC_CHANNELS.SEARCH_HISTORY_LIST),
  clearSearchHistory: () => invoke(IPC_CHANNELS.SEARCH_HISTORY_CLEAR),
  getIndexStats: () => invoke(IPC_CHANNELS.INDEX_STATS),
  crawlIndexSeeds: (config: {
    seedUrls: string[];
    allowedDomains: string[];
    maxDepth?: number;
    maxPages?: number;
  }) => invoke(IPC_CHANNELS.INDEX_CRAWL, config),
  getCloudStatus: () => invoke(IPC_CHANNELS.CLOUD_STATUS),
  cloudRegister: (payload: { email: string; password: string; displayName?: string }) =>
    invoke(IPC_CHANNELS.CLOUD_REGISTER, payload),
  cloudLogin: (payload: { email: string; password: string }) =>
    invoke(IPC_CHANNELS.CLOUD_LOGIN, payload),
  cloudLogout: () => invoke(IPC_CHANNELS.CLOUD_LOGOUT),
  updateCloudConsent: (patch: Record<string, boolean>) =>
    invoke(IPC_CHANNELS.CLOUD_UPDATE_CONSENT, patch),
  syncCloudNow: () => invoke(IPC_CHANNELS.CLOUD_SYNC_NOW),
  exportCloudData: () => invoke(IPC_CHANNELS.CLOUD_EXPORT_DATA),
  deleteCloudAccount: () => invoke(IPC_CHANNELS.CLOUD_DELETE_ACCOUNT_DATA),
  listCloudNotes: () => invoke(IPC_CHANNELS.CLOUD_NOTES_LIST),
  saveCloudNote: (note: { title: string; content: string; sourceUrl?: string | null; tags?: string[] }) =>
    invoke(IPC_CHANNELS.CLOUD_NOTES_SAVE, note),

  // Page selection / context menu actions
  onContentSelection: (cb: (data: { tabId: string; text: string; x: number; y: number }) => void) =>
    subscribe(IPC_CHANNELS.CONTENT_SELECTION, cb),
  onContentContextAction: (
    cb: (data: { action: string; tabId: string; url: string; selectedText?: string }) => void
  ) => subscribe(IPC_CHANNELS.CONTENT_CONTEXT_ACTION, cb)
};

contextBridge.exposeInMainWorld('atlas', atlasApi);

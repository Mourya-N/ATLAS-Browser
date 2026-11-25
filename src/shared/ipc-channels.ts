import { z } from 'zod';

export const IPC_CHANNELS = {
  // Tabs & Window
  TAB_LIST: 'atlas:tab:list',
  TAB_CREATE: 'atlas:tab:create',
  TAB_CLOSE: 'atlas:tab:close',
  TAB_ACTIVATE: 'atlas:tab:activate',
  TAB_REORDER: 'atlas:tab:reorder',
  TAB_DUPLICATE: 'atlas:tab:duplicate',
  TAB_PIN: 'atlas:tab:pin',
  TAB_MUTE: 'atlas:tab:mute',
  TAB_RENAME: 'atlas:tab:rename',
  TAB_RESTORE_CLOSED: 'atlas:tab:restore-closed',
  TAB_GROUP_CREATE: 'atlas:tab-group:create',
  TAB_GROUP_UPDATE: 'atlas:tab-group:update',
  TAB_GROUP_ASSIGN: 'atlas:tab-group:assign',
  TAB_GROUPS_LIST: 'atlas:tab-group:list',
  TAB_STATE_CHANGED: 'atlas:tab:state-changed',
  WINDOW_NEW_PRIVATE: 'atlas:window:new-private',
  WINDOW_SET_LAYOUT: 'atlas:window:set-layout',

  // Navigation & Browser Controls
  NAV_GO: 'atlas:nav:go',
  NAV_BACK: 'atlas:nav:back',
  NAV_FORWARD: 'atlas:nav:forward',
  NAV_RELOAD: 'atlas:nav:reload',
  NAV_STOP: 'atlas:nav:stop',
  NAV_HOME: 'atlas:nav:home',
  NAV_SUGGESTIONS: 'atlas:nav:suggestions',
  BROWSER_ZOOM: 'atlas:browser:zoom',
  BROWSER_FIND: 'atlas:browser:find',
  BROWSER_FIND_STOP: 'atlas:browser:find-stop',
  BROWSER_DEVTOOLS: 'atlas:browser:devtools',
  BROWSER_PRINT: 'atlas:browser:print',
  BROWSER_VIEW_SOURCE: 'atlas:browser:view-source',
  BROWSER_FULLSCREEN: 'atlas:browser:fullscreen',
  BROWSER_READER_EXTRACT: 'atlas:browser:reader-extract',

  // History & Bookmarks
  HISTORY_LIST: 'atlas:history:list',
  HISTORY_DELETE: 'atlas:history:delete',
  HISTORY_CLEAR: 'atlas:history:clear',
  HISTORY_TOP_SITES: 'atlas:history:top-sites',
  BOOKMARK_LIST: 'atlas:bookmark:list',
  BOOKMARK_ADD: 'atlas:bookmark:add',
  BOOKMARK_UPDATE: 'atlas:bookmark:update',
  BOOKMARK_DELETE: 'atlas:bookmark:delete',
  BOOKMARK_FOLDER_CREATE: 'atlas:bookmark-folder:create',

  // Downloads
  DOWNLOAD_LIST: 'atlas:download:list',
  DOWNLOAD_ACTION: 'atlas:download:action',
  DOWNLOAD_UPDATED: 'atlas:download:updated',

  // AdBlocker
  ADBLOCK_STATS: 'atlas:adblock:stats',
  ADBLOCK_TOGGLE_GLOBAL: 'atlas:adblock:toggle-global',
  ADBLOCK_TOGGLE_DOMAIN: 'atlas:adblock:toggle-domain',

  // Agent
  AGENT_LIST_CONVERSATIONS: 'atlas:agent:list-conversations',
  AGENT_CREATE_CONVERSATION: 'atlas:agent:create-conversation',
  AGENT_GET_MESSAGES: 'atlas:agent:get-messages',
  AGENT_START_RUN: 'atlas:agent:start-run',
  AGENT_PAUSE_RUN: 'atlas:agent:pause-run',
  AGENT_RESUME_RUN: 'atlas:agent:resume-run',
  AGENT_STOP_RUN: 'atlas:agent:stop-run',
  AGENT_TAKEOVER: 'atlas:agent:takeover',
  AGENT_SET_MODE: 'atlas:agent:set-mode',
  AGENT_RUN_EVENT: 'atlas:agent:run-event',
  AGENT_LIST_RUNS: 'atlas:agent:list-runs',
  AGENT_GET_RUN: 'atlas:agent:get-run',
  AGENT_READ_SCREENSHOT: 'atlas:agent:read-screenshot',
  AGENT_CLEAR_CONVERSATION: 'atlas:agent:clear-conversation',
  AGENT_CONFIRMATION_REQUEST: 'atlas:agent:confirmation-request',
  AGENT_CONFIRMATION_RESPOND: 'atlas:agent:confirmation-respond',
  AGENT_HITL_PAUSE: 'atlas:agent:hitl-pause',
  AGENT_HITL_RESUME: 'atlas:agent:hitl-resume',

  // Safety & Audit
  KILL_SWITCH_TRIGGER: 'atlas:safety:kill-switch',
  DOMAIN_RULES_LIST: 'atlas:safety:domain-rules-list',
  DOMAIN_RULES_SET: 'atlas:safety:domain-rules-set',
  DOMAIN_RULES_DELETE: 'atlas:safety:domain-rules-delete',
  AUDIT_LIST: 'atlas:audit:list',
  AUDIT_DELETE: 'atlas:audit:delete',
  AUDIT_EXPORT: 'atlas:audit:export',

  // Skills, Memory, Extraction, Scheduler
  SKILL_LIST: 'atlas:skill:list',
  SKILL_RECORD_FROM_RUN: 'atlas:skill:record-from-run',
  SKILL_SAVE: 'atlas:skill:save',
  SKILL_DELETE: 'atlas:skill:delete',
  SKILL_DUPLICATE: 'atlas:skill:duplicate',
  SKILL_RUN: 'atlas:skill:run',
  SKILL_IMPORT: 'atlas:skill:import',
  SKILL_EXPORT: 'atlas:skill:export',
  SKILL_EXECUTIONS: 'atlas:skill:executions',

  MEMORY_LIST: 'atlas:memory:list',
  MEMORY_SEARCH: 'atlas:memory:search',
  MEMORY_SAVE: 'atlas:memory:save',
  MEMORY_DELETE: 'atlas:memory:delete',
  MEMORY_CLEAR: 'atlas:memory:clear',
  MEMORY_EXPORT: 'atlas:memory:export',

  EXTRACT_STRUCTURED: 'atlas:extract:structured',
  EXTRACT_EXPORT_CSV: 'atlas:extract:export-csv',

  SCHEDULER_LIST: 'atlas:scheduler:list',
  SCHEDULER_SAVE: 'atlas:scheduler:save',
  SCHEDULER_DELETE: 'atlas:scheduler:delete',
  SCHEDULER_TOGGLE: 'atlas:scheduler:toggle',
  SCHEDULER_RUN_NOW: 'atlas:scheduler:run-now',

  // Cost & Observability
  STATS_SUMMARY: 'atlas:stats:summary',

  // MCP
  MCP_STATUS: 'atlas:mcp:status',
  MCP_CONFIGURE: 'atlas:mcp:configure',
  MCP_ROTATE_TOKEN: 'atlas:mcp:rotate-token',
  MCP_GET_TOKEN: 'atlas:mcp:get-token',

  // Settings & Secrets
  SETTINGS_GET: 'atlas:settings:get',
  SETTINGS_UPDATE: 'atlas:settings:update',
  SETTINGS_SET_API_KEY: 'atlas:settings:set-api-key',
  SETTINGS_CLEAR_API_KEY: 'atlas:settings:clear-api-key',
  SETTINGS_PROVIDER_STATUS: 'atlas:settings:provider-status',
  SETTINGS_TEST_PROVIDER: 'atlas:settings:test-provider',

  // Advanced Intelligence: Checkpoints, Research, Page Understanding, Cross-Tab, Proactive, Skills
  AGENT_LIST_INTERRUPTED: 'atlas:agent:list-interrupted',
  AGENT_RESUME_CHECKPOINT: 'atlas:agent:resume-checkpoint',
  AGENT_SKILL_SUGGESTION: 'atlas:agent:skill-suggestion',
  RESEARCH_RUN: 'atlas:research:run',
  RESEARCH_LIST: 'atlas:research:list',
  RESEARCH_EXPORT_MD: 'atlas:research:export-md',
  PAGE_UNDERSTAND: 'atlas:page:understand',
  PAGE_SEMANTIC_SEARCH: 'atlas:page:semantic-search',
  PAGE_CHECK_CHANGES: 'atlas:page:check-changes',
  CROSSTAB_ANALYZE: 'atlas:crosstab:analyze',
  CROSSTAB_COMPARE: 'atlas:crosstab:compare',
  SKILL_TEST: 'atlas:skill:test',
  PROACTIVE_CHECK: 'atlas:proactive:check',

  // Atlas Cloud & Intelligent Search Engine
  SEARCH_EXECUTE: 'atlas:search:execute',
  SEARCH_SUGGEST: 'atlas:search:suggest',
  SEARCH_OPEN_GROUP: 'atlas:search:open-group',
  SEARCH_SAVE_TO_RESEARCH: 'atlas:search:save-to-research',
  CLOUD_STATUS: 'atlas:cloud:status',
  CLOUD_REGISTER: 'atlas:cloud:register',
  CLOUD_LOGIN: 'atlas:cloud:login',
  CLOUD_LOGOUT: 'atlas:cloud:logout',
  CLOUD_UPDATE_CONSENT: 'atlas:cloud:update-consent',
  CLOUD_SYNC_NOW: 'atlas:cloud:sync-now',
  CLOUD_EXPORT_DATA: 'atlas:cloud:export-data',
  CLOUD_DELETE_ACCOUNT_DATA: 'atlas:cloud:delete-account-data',
  CLOUD_NOTES_LIST: 'atlas:cloud:notes-list',
  CLOUD_NOTES_SAVE: 'atlas:cloud:notes-save',

  // Content events (page -> main -> UI)
  CONTENT_SELECTION: 'atlas:content:selection',
  CONTENT_CONTEXT_ACTION: 'atlas:content:context-action'
} as const;

export const TabCreateSchema = z.object({
  url: z.string().max(4096).optional(),
  activate: z.boolean().optional(),
  groupId: z.string().max(128).nullable().optional()
});

export const TabIdSchema = z.object({
  tabId: z.string().min(1).max(128)
});

export const TabReorderSchema = z.object({
  tabId: z.string().min(1).max(128),
  newIndex: z.number().int().min(0).max(500)
});

export const TabRenameSchema = z.object({
  tabId: z.string().min(1).max(128),
  customTitle: z.string().max(200).nullable()
});

export const NavGoSchema = z.object({
  tabId: z.string().min(1).max(128),
  input: z.string().min(1).max(4096)
});

export const LayoutSchema = z.object({
  topInset: z.number().min(0).max(400),
  leftInset: z.number().min(0).max(500),
  rightInset: z.number().min(0).max(900),
  hideBrowserView: z.boolean()
});

export const AgentStartRunSchema = z.object({
  conversationId: z.string().min(1).max(128),
  tabId: z.string().max(128).nullable().optional(),
  goal: z.string().min(1).max(16000),
  mode: z.enum(['ask', 'assist', 'agent', 'takeover']),
  selectedText: z.string().max(20000).optional(),
  selectedTabIds: z.array(z.string().min(1).max(128)).max(20).optional()
});

export const ConfirmationRespondSchema = z.object({
  requestId: z.string().min(1).max(128),
  approved: z.boolean(),
  rememberForDomain: z.boolean().optional(),
  domainRuleMode: z.enum(['allow', 'deny', 'read_only', 'interact']).optional()
});

export const DomainRuleSetSchema = z.object({
  domain: z.string().min(1).max(255),
  mode: z.enum(['allow', 'deny', 'read_only', 'interact']),
  expiresAt: z.number().int().nullable().optional()
});

export const SettingsSetApiKeySchema = z.object({
  provider: z.enum(['gemini', 'custom_openai_compatible']),
  apiKey: z.string().min(4).max(512)
});

export const ContentSelectionSchema = z.object({
  text: z.string().max(10000),
  x: z.number().min(0).max(10000),
  y: z.number().min(0).max(10000)
});

export const SearchExecuteSchema = z.object({
  query: z.string().min(1).max(2000),
  mode: z
    .enum(['web', 'news', 'docs', 'research', 'current_page', 'cross_tab', 'personal_knowledge'])
    .optional(),
  filters: z
    .object({
      domains: z.array(z.string().max(255)).max(20).optional(),
      excludeDomains: z.array(z.string().max(255)).max(20).optional(),
      timeRange: z.enum(['any', 'day', 'week', 'month', 'year']).optional(),
      language: z.string().max(16).optional(),
      includeOpenTabs: z.boolean().optional(),
      includePersonalKnowledge: z.boolean().optional(),
      includeAiAnswer: z.boolean().optional(),
      limit: z.number().int().min(1).max(50).optional()
    })
    .optional(),
  selectedTabIds: z.array(z.string().min(1).max(128)).max(20).optional()
});

export const CloudAuthSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
  displayName: z.string().min(1).max(120).optional()
});

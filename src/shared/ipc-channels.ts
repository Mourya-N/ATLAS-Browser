import { z } from 'zod';

export const IPC_CHANNELS = {
  // Tabs & Window
  TAB_LIST: 'lavray:tab:list',
  TAB_CREATE: 'lavray:tab:create',
  TAB_CLOSE: 'lavray:tab:close',
  TAB_ACTIVATE: 'lavray:tab:activate',
  TAB_REORDER: 'lavray:tab:reorder',
  TAB_DUPLICATE: 'lavray:tab:duplicate',
  TAB_PIN: 'lavray:tab:pin',
  TAB_MUTE: 'lavray:tab:mute',
  TAB_RENAME: 'lavray:tab:rename',
  TAB_RESTORE_CLOSED: 'lavray:tab:restore-closed',
  TAB_GROUP_CREATE: 'lavray:tab-group:create',
  TAB_GROUP_UPDATE: 'lavray:tab-group:update',
  TAB_GROUP_ASSIGN: 'lavray:tab-group:assign',
  TAB_GROUPS_LIST: 'lavray:tab-group:list',
  TAB_STATE_CHANGED: 'lavray:tab:state-changed',
  WINDOW_NEW_PRIVATE: 'lavray:window:new-private',
  WINDOW_SET_LAYOUT: 'lavray:window:set-layout',

  // Navigation & Browser Controls
  NAV_GO: 'lavray:nav:go',
  NAV_BACK: 'lavray:nav:back',
  NAV_FORWARD: 'lavray:nav:forward',
  NAV_RELOAD: 'lavray:nav:reload',
  NAV_STOP: 'lavray:nav:stop',
  NAV_HOME: 'lavray:nav:home',
  NAV_SUGGESTIONS: 'lavray:nav:suggestions',
  BROWSER_ZOOM: 'lavray:browser:zoom',
  BROWSER_FIND: 'lavray:browser:find',
  BROWSER_FIND_STOP: 'lavray:browser:find-stop',
  BROWSER_DEVTOOLS: 'lavray:browser:devtools',
  BROWSER_PRINT: 'lavray:browser:print',
  BROWSER_VIEW_SOURCE: 'lavray:browser:view-source',
  BROWSER_FULLSCREEN: 'lavray:browser:fullscreen',
  BROWSER_READER_EXTRACT: 'lavray:browser:reader-extract',

  // History & Bookmarks
  HISTORY_LIST: 'lavray:history:list',
  HISTORY_DELETE: 'lavray:history:delete',
  HISTORY_CLEAR: 'lavray:history:clear',
  HISTORY_TOP_SITES: 'lavray:history:top-sites',
  BOOKMARK_LIST: 'lavray:bookmark:list',
  BOOKMARK_ADD: 'lavray:bookmark:add',
  BOOKMARK_UPDATE: 'lavray:bookmark:update',
  BOOKMARK_DELETE: 'lavray:bookmark:delete',
  BOOKMARK_FOLDER_CREATE: 'lavray:bookmark-folder:create',
  READING_LIST_LIST: 'lavray:reading-list:list',
  READING_LIST_SAVE: 'lavray:reading-list:save',
  READING_LIST_UPDATE: 'lavray:reading-list:update',
  READING_LIST_DELETE: 'lavray:reading-list:delete',

  // Downloads
  DOWNLOAD_LIST: 'lavray:download:list',
  DOWNLOAD_ACTION: 'lavray:download:action',
  DOWNLOAD_UPDATED: 'lavray:download:updated',

  // AdBlocker
  ADBLOCK_STATS: 'lavray:adblock:stats',
  ADBLOCK_TOGGLE_GLOBAL: 'lavray:adblock:toggle-global',
  ADBLOCK_TOGGLE_DOMAIN: 'lavray:adblock:toggle-domain',
  ADBLOCK_TOGGLE_TEMP_DOMAIN: 'lavray:adblock:toggle-temp-domain',
  ADBLOCK_TOGGLE_COSMETIC: 'lavray:adblock:toggle-cosmetic',
  ADBLOCK_TOGGLE_COSMETIC_DOMAIN: 'lavray:adblock:toggle-cosmetic-domain',
  ADBLOCK_ADD_RULE: 'lavray:adblock:add-rule',
  ADBLOCK_REMOVE_RULE: 'lavray:adblock:remove-rule',
  ADBLOCK_UPDATE_LISTS: 'lavray:adblock:update-lists',
  ADBLOCK_TOGGLE_LIST: 'lavray:adblock:toggle-list',
  ADBLOCK_REPORT_BROKEN: 'lavray:adblock:report-broken',

  // Agent
  AGENT_LIST_CONVERSATIONS: 'lavray:agent:list-conversations',
  AGENT_CREATE_CONVERSATION: 'lavray:agent:create-conversation',
  AGENT_GET_MESSAGES: 'lavray:agent:get-messages',
  AGENT_START_RUN: 'lavray:agent:start-run',
  AGENT_PAUSE_RUN: 'lavray:agent:pause-run',
  AGENT_RESUME_RUN: 'lavray:agent:resume-run',
  AGENT_STOP_RUN: 'lavray:agent:stop-run',
  AGENT_TAKEOVER: 'lavray:agent:takeover',
  AGENT_SET_MODE: 'lavray:agent:set-mode',
  AGENT_RUN_EVENT: 'lavray:agent:run-event',
  AGENT_LIST_RUNS: 'lavray:agent:list-runs',
  AGENT_GET_RUN: 'lavray:agent:get-run',
  AGENT_READ_SCREENSHOT: 'lavray:agent:read-screenshot',
  AGENT_CLEAR_CONVERSATION: 'lavray:agent:clear-conversation',
  AGENT_CONFIRMATION_REQUEST: 'lavray:agent:confirmation-request',
  AGENT_CONFIRMATION_RESPOND: 'lavray:agent:confirmation-respond',
  AGENT_HITL_PAUSE: 'lavray:agent:hitl-pause',
  AGENT_HITL_RESUME: 'lavray:agent:hitl-resume',

  // Safety & Audit
  KILL_SWITCH_TRIGGER: 'lavray:safety:kill-switch',
  DOMAIN_RULES_LIST: 'lavray:safety:domain-rules-list',
  DOMAIN_RULES_SET: 'lavray:safety:domain-rules-set',
  DOMAIN_RULES_DELETE: 'lavray:safety:domain-rules-delete',
  AUDIT_LIST: 'lavray:audit:list',
  AUDIT_DELETE: 'lavray:audit:delete',
  AUDIT_EXPORT: 'lavray:audit:export',
  SECURITY_ANALYZE_TRUST: 'lavray:security:analyze-trust',

  // Skills, Memory, Extraction, Scheduler
  SKILL_LIST: 'lavray:skill:list',
  SKILL_RECORD_FROM_RUN: 'lavray:skill:record-from-run',
  SKILL_SAVE: 'lavray:skill:save',
  SKILL_DELETE: 'lavray:skill:delete',
  SKILL_DUPLICATE: 'lavray:skill:duplicate',
  SKILL_RUN: 'lavray:skill:run',
  SKILL_IMPORT: 'lavray:skill:import',
  SKILL_EXPORT: 'lavray:skill:export',
  SKILL_EXECUTIONS: 'lavray:skill:executions',

  MEMORY_LIST: 'lavray:memory:list',
  MEMORY_SEARCH: 'lavray:memory:search',
  MEMORY_SAVE: 'lavray:memory:save',
  MEMORY_DELETE: 'lavray:memory:delete',
  MEMORY_CLEAR: 'lavray:memory:clear',
  MEMORY_EXPORT: 'lavray:memory:export',

  EXTRACT_STRUCTURED: 'lavray:extract:structured',
  EXTRACT_EXPORT_CSV: 'lavray:extract:export-csv',

  SCHEDULER_LIST: 'lavray:scheduler:list',
  SCHEDULER_SAVE: 'lavray:scheduler:save',
  SCHEDULER_DELETE: 'lavray:scheduler:delete',
  SCHEDULER_TOGGLE: 'lavray:scheduler:toggle',
  SCHEDULER_RUN_NOW: 'lavray:scheduler:run-now',

  // Cost & Observability
  STATS_SUMMARY: 'lavray:stats:summary',

  // MCP
  MCP_STATUS: 'lavray:mcp:status',
  MCP_CONFIGURE: 'lavray:mcp:configure',
  MCP_ROTATE_TOKEN: 'lavray:mcp:rotate-token',
  MCP_GET_TOKEN: 'lavray:mcp:get-token',

  // Settings & Secrets
  SETTINGS_GET: 'lavray:settings:get',
  SETTINGS_UPDATE: 'lavray:settings:update',
  SETTINGS_SET_API_KEY: 'lavray:settings:set-api-key',
  SETTINGS_CLEAR_API_KEY: 'lavray:settings:clear-api-key',
  SETTINGS_PROVIDER_STATUS: 'lavray:settings:provider-status',
  SETTINGS_TEST_PROVIDER: 'lavray:settings:test-provider',

  // Advanced Intelligence: Checkpoints, Research, Page Understanding, Cross-Tab, Proactive, Skills
  AGENT_LIST_INTERRUPTED: 'lavray:agent:list-interrupted',
  AGENT_RESUME_CHECKPOINT: 'lavray:agent:resume-checkpoint',
  AGENT_SKILL_SUGGESTION: 'lavray:agent:skill-suggestion',
  RESEARCH_RUN: 'lavray:research:run',
  RESEARCH_LIST: 'lavray:research:list',
  RESEARCH_EXPORT_MD: 'lavray:research:export-md',
  PAGE_UNDERSTAND: 'lavray:page:understand',
  PAGE_SEMANTIC_SEARCH: 'lavray:page:semantic-search',
  PAGE_CHECK_CHANGES: 'lavray:page:check-changes',
  CROSSTAB_ANALYZE: 'lavray:crosstab:analyze',
  CROSSTAB_COMPARE: 'lavray:crosstab:compare',
  SKILL_TEST: 'lavray:skill:test',
  PROACTIVE_CHECK: 'lavray:proactive:check',

  // LAVRAY Cloud & Intelligent Search Engine
  SEARCH_EXECUTE: 'lavray:search:execute',
  SEARCH_SUGGEST: 'lavray:search:suggest',
  SEARCH_OPEN_GROUP: 'lavray:search:open-group',
  SEARCH_SAVE_TO_RESEARCH: 'lavray:search:save-to-research',
  SEARCH_HISTORY_LIST: 'lavray:search:history-list',
  SEARCH_HISTORY_CLEAR: 'lavray:search:history-clear',
  INDEX_CRAWL: 'lavray:index:crawl',
  INDEX_STATS: 'lavray:index:stats',
  SETTINGS_DISCOVER_MODELS: 'lavray:settings:discover-models',
  CLOUD_STATUS: 'lavray:cloud:status',
  CLOUD_REGISTER: 'lavray:cloud:register',
  CLOUD_LOGIN: 'lavray:cloud:login',
  CLOUD_LOGOUT: 'lavray:cloud:logout',
  CLOUD_UPDATE_CONSENT: 'lavray:cloud:update-consent',
  CLOUD_SYNC_NOW: 'lavray:cloud:sync-now',
  CLOUD_EXPORT_DATA: 'lavray:cloud:export-data',
  CLOUD_DELETE_ACCOUNT_DATA: 'lavray:cloud:delete-account-data',
  CLOUD_NOTES_LIST: 'lavray:cloud:notes-list',
  CLOUD_NOTES_SAVE: 'lavray:cloud:notes-save',

  // Content events (page -> main -> UI)
  CONTENT_SELECTION: 'lavray:content:selection',
  CONTENT_CONTEXT_ACTION: 'lavray:content:context-action'
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
  provider: z.enum(['gemini', 'self_hosted', 'custom_openai_compatible']),
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
      safeSearch: z.enum(['off', 'moderate', 'strict']).optional(),
      language: z.string().max(16).optional(),
      region: z.string().max(16).optional(),
      page: z.number().int().min(1).max(20).optional(),
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

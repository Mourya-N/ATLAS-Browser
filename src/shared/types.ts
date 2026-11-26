export * from './cloud-types';
import type { CloudConsentSettings } from './cloud-types';

export type ThemeMode = 'light' | 'dark' | 'system';

export type AgentMode = 'ask' | 'assist' | 'agent' | 'takeover';

export type PermissionTier = 'read_only' | 'interact' | 'sensitive';

export type DomainPermissionMode = 'allow' | 'deny' | 'read_only' | 'interact';

export type SearchEngineId = 'google' | 'duckduckgo' | 'bing' | 'brave' | 'startpage';

export interface TabGroup {
  id: string;
  title: string;
  color: string;
  collapsed: boolean;
  createdAt: number;
}

export interface TabInfo {
  id: string;
  windowId: number;
  url: string;
  title: string;
  customTitle?: string | null;
  favicon?: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  isMuted: boolean;
  isPrivate: boolean;
  groupId?: string | null;
  orderIndex: number;
  zoomFactor: number;
  crashed: boolean;
  securityState: 'secure' | 'insecure' | 'internal' | 'unknown';
  blockedCount: number;
  agentActive: boolean;
  lastActiveAt: number;
}

export interface ClosedTabRecord {
  id: string;
  url: string;
  title: string;
  favicon?: string | null;
  isPinned: boolean;
  groupId?: string | null;
  closedAt: number;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  favicon?: string | null;
  visitCount: number;
  lastVisitedAt: number;
  firstVisitedAt: number;
}

export interface BookmarkFolder {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt: number;
}

export interface BookmarkEntry {
  id: string;
  url: string;
  title: string;
  folderId?: string | null;
  favicon?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  mimeType: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted' | 'pending_approval';
  isDangerous: boolean;
  startedAt: number;
  completedAt?: number | null;
  error?: string | null;
}

export interface ReaderArticle {
  url: string;
  title: string;
  byline: string | null;
  publishedTime: string | null;
  siteName: string | null;
  excerpt: string | null;
  contentHtml: string;
  textContent: string;
  length: number;
}

export interface ReadingListItem {
  id: string;
  url: string;
  title: string;
  siteName: string | null;
  excerpt: string | null;
  status: 'unread' | 'reading' | 'read';
  progress: number;
  savedAt: number;
  updatedAt: number;
}

export interface AdBlockSiteSetting {
  domain: string;
  enabled: boolean;
  blockedCount: number;
}

export interface FilterListStatus {
  id: string;
  name: string;
  category: 'advertising' | 'privacy' | 'malware';
  url: string;
  license: string;
  attribution: string;
  enabled: boolean;
  ruleCount: number;
  skippedCount?: number;
  skippedByReason?: {
    regex: number;
    extendedCosmetic: number;
    unsupportedModifier: number;
    invalidCss: number;
    tooLong: number;
    other: number;
  };
  lastUpdatedAt: number | null;
  lastError: string | null;
}

export interface AdBlockStats {
  globalEnabled: boolean;
  totalBlocked: number;
  adsBlocked?: number;
  trackersBlocked?: number;
  ruleCount: number;
  allowlistedDomains: string[];
  temporaryDisabledDomains?: string[];
  cosmeticEnabled?: boolean;
  cosmeticRuleCount?: number;
  cosmeticDisabledDomains?: string[];
  customRules?: string[];
  filterLists?: FilterListStatus[];
  brokenSiteReportsCount?: number;
}

export type AgentRunStatus =
  | 'planning'
  | 'running'
  | 'paused'
  | 'awaiting_confirmation'
  | 'awaiting_hitl'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exceeded';

export interface Subgoal {
  id: string;
  index: number;
  description: string;
  expectedEvidence: string;
  dependsOn?: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  attempts: number;
}

export interface PageDiff {
  urlChanged: boolean;
  previousUrl: string;
  currentUrl: string;
  titleChanged: boolean;
  previousTitle: string;
  currentTitle: string;
  addedElementsCount: number;
  removedElementsCount: number;
  textDeltaSummary: string;
  scrollChanged: boolean;
}

export interface ToolExecutionRecord {
  id: string;
  runId: string;
  stepId: string;
  toolName: string;
  permissionTier: PermissionTier;
  args: Record<string, unknown>;
  validated: boolean;
  permissionDecision: 'allowed' | 'denied' | 'confirmed' | 'rejected';
  success: boolean;
  result?: unknown;
  error?: string | null;
  durationMs: number;
  pageDiff?: PageDiff | null;
  createdAt: number;
}

export interface AgentStep {
  id: string;
  runId: string;
  stepIndex: number;
  subgoalId?: string | null;
  phase: 'observe' | 'plan' | 'perceive' | 'execute' | 'verify' | 'recover' | 'hitl' | 'complete';
  summary: string;
  decisionExplanation: string;
  evidence?: string | null;
  verificationOutcome?: 'passed' | 'retry' | 'replan' | 'failed' | null;
  toolExecution?: ToolExecutionRecord | null;
  screenshotId?: string | null;
  screenshotPath?: string | null;
  injectionWarnings: InjectionWarning[];
  createdAt: number;
}

export interface AgentRun {
  id: string;
  conversationId: string;
  parentRunId?: string | null;
  tabId?: string | null;
  goal: string;
  mode: AgentMode;
  status: AgentRunStatus;
  planSummary?: string | null;
  subgoals: Subgoal[];
  steps: AgentStep[];
  finalAnswer?: string | null;
  failureReason?: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  isCostEstimated: boolean;
  model: string;
  provider: string;
  isPrivate: boolean;
  startedAt: number;
  endedAt?: number | null;
}

export interface AgentMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  runId?: string | null;
  createdAt: number;
}

export interface AgentConversation {
  id: string;
  title: string;
  isPrivate: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ConfirmationRequest {
  id: string;
  runId: string;
  toolName: string;
  domain: string;
  currentUrl: string;
  actionSummary: string;
  targetDescription: string;
  submittedDataSummary: string;
  expectedConsequence: string;
  reversible: boolean;
  tier: PermissionTier;
  createdAt: number;
}

export interface ConfirmationResponse {
  requestId: string;
  approved: boolean;
  rememberForDomain?: boolean;
  domainRuleMode?: DomainPermissionMode;
}

export type HitlPauseReason =
  | 'captcha'
  | 'login_required'
  | 'payment_page'
  | 'unexpected_auth'
  | 'sensitive_action'
  | 'uncertain_high_impact'
  | 'user_takeover';

export interface HitlPauseState {
  runId: string;
  tabId: string;
  reason: HitlPauseReason;
  explanation: string;
  requestedAction: string;
  pausedAt: number;
}

export interface InjectionWarning {
  source: string;
  pattern: string;
  snippet: string;
  severity: 'low' | 'medium' | 'high';
}

export interface DomainRule {
  id: string;
  domain: string;
  mode: DomainPermissionMode;
  expiresAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEvent {
  id: string;
  runId?: string | null;
  category:
    | 'agent_lifecycle'
    | 'tool_call'
    | 'permission'
    | 'confirmation'
    | 'injection_warning'
    | 'security'
    | 'kill_switch'
    | 'mcp'
    | 'skill'
    | 'scheduler'
    | 'scripting';
  action: string;
  actor: string;
  domain?: string | null;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface AXNode {
  nodeId: string;
  role: string;
  name: string;
  value?: string;
  description?: string;
  focused?: boolean;
  disabled?: boolean;
  checked?: boolean | 'mixed';
  boundingBox?: { x: number; y: number; width: number; height: number };
  children?: AXNode[];
}

export interface DOMElementInfo {
  atlasId: string;
  tag: string;
  role: string;
  type?: string;
  name: string;
  text: string;
  placeholder?: string;
  href?: string;
  value?: string;
  selector: string;
  xpath: string;
  frameId?: string;
  inShadowDom: boolean;
  visible: boolean;
  interactable: boolean;
  confidence?: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
}

export interface PagePerception {
  tabId: string;
  url: string;
  title: string;
  capturedAt: number;
  viewport: { width: number; height: number; scrollX: number; scrollY: number; scrollHeight: number };
  axSummary: string;
  interactiveElements: DOMElementInfo[];
  mainText: string;
  selectedText: string;
  headings: string[];
  tablesSummary: string[];
  screenshotBase64?: string;
  screenshotPath?: string;
  somTargets?: Array<{ atlasId: string; label: number; box: { x: number; y: number; width: number; height: number } }>;
  injectionWarnings: InjectionWarning[];
  hitlSignals: HitlPauseReason[];
}

export interface SkillStep {
  index: number;
  description: string;
  toolName: string;
  argsTemplate: Record<string, unknown>;
  targetHints?: {
    role?: string;
    name?: string;
    selector?: string;
    text?: string;
  };
  expectedOutcome: string;
  verificationRule: {
    type: 'url_contains' | 'text_contains' | 'element_exists' | 'custom';
    value: string;
  };
  recoveryStrategy: 'retry' | 'ax_fallback' | 'llm_fallback' | 'abort';
  permissionTier: PermissionTier;
}

export interface SkillParameter {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  defaultValue?: string | number | boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: number;
  parameters: SkillParameter[];
  preconditions: string[];
  triggerConditions?: string[];
  expectedOutput?: string;
  failureBehavior?: 'retry' | 'ax_fallback' | 'llm_fallback' | 'abort';
  requiredPermissions: PermissionTier[];
  allowedDomains: string[];
  steps: SkillStep[];
  createdAt: number;
  updatedAt: number;
  lastExecutedAt?: number | null;
  executionCount: number;
  successCount: number;
}

export interface SkillExecution {
  id: string;
  skillId: string;
  skillVersion: number;
  runId?: string | null;
  params: Record<string, unknown>;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  usedLlmFallback: boolean;
  error?: string | null;
  startedAt: number;
  endedAt?: number | null;
}

export type MemoryCategory =
  | 'user_preference'
  | 'site_preference'
  | 'workflow_preference'
  | 'task_knowledge'
  | 'task_summary'
  | 'note'
  | 'approved_fact'
  | 'bookmark_summary'
  | 'research_collection'
  | 'conversation_summary';

export interface MemoryItem {
  id: string;
  profileId?: string;
  category: MemoryCategory;
  domain?: string | null;
  sourceUrl?: string | null;
  title: string;
  content: string;
  confidence: number;
  source: string;
  userApproved: boolean;
  useCount: number;
  expiresAt?: number | null;
  embedding?: number[];
  createdAt: number;
  lastUsedAt: number;
}

export interface ExtractionResult {
  id: string;
  url: string;
  schema: Record<string, unknown>;
  records: Array<Record<string, unknown>>;
  evidence: Array<{ field: string; sourceUrl: string; snippet: string }>;
  valid: boolean;
  validationErrors: string[];
  attempts: number;
  createdAt: number;
}

export type ScheduleTriggerType = 'once' | 'daily' | 'weekly' | 'cron' | 'event';

export interface ScheduledJob {
  id: string;
  name: string;
  skillId: string;
  params: Record<string, unknown>;
  triggerType: ScheduleTriggerType;
  cronExpression?: string | null;
  runAt?: number | null;
  timezone: string;
  enabled: boolean;
  paused: boolean;
  maxBudgetUsd: number;
  allowedDomains: string[];
  lastRunAt?: number | null;
  nextRunAt?: number | null;
  lastStatus?: 'completed' | 'failed' | 'paused_permission' | null;
  lastError?: string | null;
  createdAt: number;
}

export interface CostSummary {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  avgSteps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  todayCostUsd: number;
  byModel: Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number }>;
  bySkill: Array<{ skillId: string; skillName: string; runs: number; costUsd: number }>;
}

export interface BudgetConfig {
  maxStepsPerRun: number;
  maxWallTimeMs: number;
  maxTokensPerRun: number;
  maxModelCallsPerRun: number;
  maxVisionCallsPerRun: number;
  maxRetriesPerStep: number;
  maxConsecutiveFailures: number;
  maxParallelAgents: number;
  maxCostPerRunUsd: number;
  dailyCostBudgetUsd: number;
  warningRatio: number;
}

export interface McpConfig {
  enabled: boolean;
  port: number;
  allowedTools: string[];
  rateLimitPerMinute: number;
}

export interface McpServerStatus {
  running: boolean;
  port: number;
  boundHost: string;
  hasToken: boolean;
  maskedToken: string;
  requestCount: number;
  lastRequestAt?: number | null;
  allowedTools: string[];
}

export interface AppSettings {
  theme: ThemeMode;
  searchEngine: SearchEngineId;
  homeUrl: string;
  downloadDir: string;
  verticalTabs: boolean;
  adBlockEnabled: boolean;
  restoreSessionOnStart: boolean;
  retainScreenshots: boolean;
  screenshotRetentionDays: number;
  experimentalScriptingEnabled: boolean;
  proactiveAssistanceEnabled: boolean;
  voiceSpokenResponsesEnabled: boolean;
  telemetryEnabled: boolean;
  activeProfileId: string;
  defaultProvider: 'gemini' | 'self_hosted' | 'custom_openai_compatible' | 'mock';
  defaultModel: string;
  customEndpointUrl: string;
  selfHostedEndpointUrl?: string;
  selfHostedModel?: string;
  hasGeminiApiKey: boolean;
  hasSelfHostedApiKey?: boolean;
  cloudModeEnabled?: boolean;
  cloudEndpointUrl?: string;
  cloudConsent?: CloudConsentSettings;
  budgets: BudgetConfig;
  mcp: McpConfig;
}

export interface ProviderStatusInfo {
  activeProvider: 'gemini' | 'self_hosted' | 'custom_openai_compatible' | 'mock';
  model: string;
  endpointUrl?: string;
  isLive: boolean;
  hasGeminiKey: boolean;
  hasSelfHostedKey?: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  warning?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  capabilities: {
    tools: boolean;
    structuredOutput: boolean;
    vision: boolean;
  };
  error?: string;
}

export interface TaskCheckpoint {
  runId: string;
  conversationId: string;
  goal: string;
  mode: AgentMode;
  subgoals: Subgoal[];
  currentSubgoalIdx: number;
  activeTabId: string | null;
  activeUrl: string | null;
  evidenceCollected: string[];
  stepCount: number;
  updatedAt: number;
}

export interface ResearchClaim {
  id: string;
  claim: string;
  kind: 'fact' | 'analysis';
  supportingQuote: string;
  sourceUrl: string;
  sourceTitle: string;
  confidence: number;
}

export interface ResearchConflict {
  topic: string;
  statementA: string;
  sourceA: string;
  statementB: string;
  sourceB: string;
}

export interface ResearchReport {
  id: string;
  query: string;
  summary: string;
  claims: ResearchClaim[];
  conflicts: ResearchConflict[];
  comparisonTable: { columns: string[]; rows: string[][] } | null;
  notes: string;
  sources: Array<{ url: string; title: string }>;
  createdAt: number;
}

export interface PageChangeResult {
  url: string;
  hasPrevious: boolean;
  previousVisitedAt?: number;
  summary: string;
  addedHeadings: string[];
  removedHeadings: string[];
  textLengthDelta: number;
}

export interface CrossTabAnalysis {
  tabs: Array<{ tabId: string; url: string; title: string; groupId?: string | null }>;
  duplicateGroups: Array<{ url: string; tabIds: string[] }>;
  relatedPairs: Array<{ tabA: string; tabB: string; overlapScore: number; sharedTopics: string[] }>;
  summary: string;
}

export interface SkillSuggestion {
  runId: string;
  suggestedName: string;
  description: string;
  stepsCount: number;
  domains: string[];
  requiredPermissions: PermissionTier[];
}

export interface ProactiveSuggestion {
  id: string;
  kind: 'long_article' | 'duplicate_tabs' | 'related_tabs' | 'interrupted_task' | 'save_research';
  title: string;
  description: string;
  actionLabel: string;
  payload: Record<string, unknown>;
}

export interface SubAgentProgress {
  subAgentId: string;
  parentRunId: string;
  tabId?: string | null;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  stepsTaken: number;
  resultSummary?: string;
  sources: string[];
  error?: string;
}

export interface OmniboxSuggestion {
  type: 'url' | 'history' | 'bookmark' | 'search';
  title: string;
  url: string;
  subtitle?: string;
}

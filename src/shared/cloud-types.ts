export type SearchMode =
  | 'web'
  | 'images'
  | 'videos'
  | 'maps'
  | 'shopping'
  | 'news'
  | 'docs'
  | 'research'
  | 'current_page'
  | 'cross_tab'
  | 'personal_knowledge';

export type SearchIntent =
  | 'informational'
  | 'navigational'
  | 'comparative'
  | 'temporal_news'
  | 'technical_docs'
  | 'personal_knowledge';

export type SafeSearchLevel = 'off' | 'moderate' | 'strict';

export interface SearchFilterOptions {
  domains?: string[];
  excludeDomains?: string[];
  timeRange?: 'any' | 'day' | 'week' | 'month' | 'year';
  safeSearch?: SafeSearchLevel;
  language?: string;
  region?: string;
  page?: number;
  contentTypes?: Array<'web' | 'news' | 'docs' | 'knowledge' | 'tab' | 'bookmark' | 'research'>;
  includeOpenTabs?: boolean;
  includePersonalKnowledge?: boolean;
  includeAiAnswer?: boolean;
  disableTypoCorrection?: boolean;
  limit?: number;
}

export interface SearchQueryUnderstanding {
  originalQuery: string;
  normalizedQuery: string;
  correctedQuery?: string | null;
  coreTokens?: string[];
  exactPhrases?: string[];
  siteFilters?: string[];
  excludeDomains?: string[];
  excludedTerms?: string[];
  technicalTokens?: string[];
  isExactMatchQuery?: boolean;
  rewrittenQueries: string[];
  expandedTerms: string[];
  intent: SearchIntent;
  recommendedMode: SearchMode;
  entities: string[];
  temporalIntent: {
    hasTemporalConstraint: boolean;
    timeHint?: 'recent' | 'today' | 'week' | 'month' | 'year';
    yearMentions: string[];
  };
  language: string;
  usedLlm: boolean;
}

export type SearchResultOrigin =
  | 'lavray_index'
  | 'external_provider'
  | 'open_tab'
  | 'personal_knowledge';

export interface NormalizedSearchResult {
  id: string;
  title: string;
  url: string;
  canonicalUrl: string;
  displayUrl: string;
  domain: string;
  snippet: string;
  sourceProvider: string;
  sourceOrigin: SearchResultOrigin;
  publishedAt?: string | null;
  crawledAt?: number | null;
  retrievedAt: number;
  contentType: 'web' | 'news' | 'docs' | 'knowledge' | 'tab' | 'bookmark' | 'research';
  language: string;
  favicon?: string | null;
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
  durationSeconds?: number | null;
  videoPlatform?: 'youtube' | 'instagram' | 'facebook' | 'dailymotion' | 'archive' | 'web' | null;
  priceText?: string | null;
  coordinates?: {
    lat: number;
    lon: number;
    displayName?: string;
    category?: string;
  } | null;
  relevanceScore: number;
  scoreBreakdown?: {
    lexical: number;
    semantic: number;
    intent: number;
    authority: number;
    freshness: number;
    rerank?: number;
  };
  clusterCount?: number;
}

export interface SearchSuggestion {
  text: string;
  kind: 'completion' | 'related' | 'refinement' | 'knowledge';
}

export interface SearchEvidencePassage {
  documentId?: string;
  sourceUrl: string;
  sourceTitle: string;
  domain: string;
  passageIndex: number;
  excerpt: string;
  relevance: number;
}

export interface SearchCitationClaim {
  id: string;
  statement: string;
  kind: 'fact' | 'interpretation';
  documentId?: string;
  passageIndex?: number;
  sourceUrl: string;
  sourceTitle: string;
  supportingQuote: string;
  verifiedAgainstSource: boolean;
}

export interface SearchContradiction {
  topic: string;
  claimA: string;
  sourceUrlA: string;
  claimB: string;
  sourceUrlB: string;
}

export interface AiCitedAnswer {
  status: 'ok' | 'insufficient_evidence' | 'unavailable' | 'failed';
  summary: string;
  claims: SearchCitationClaim[];
  unsupportedClaimsCount?: number;
  contradictions: SearchContradiction[];
  passages: SearchEvidencePassage[];
  citations: Array<{ index: number; documentId?: string; url: string; title: string; domain: string }>;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  warning?: string;
}

export interface SearchProviderHealth {
  providerId: string;
  name: string;
  configured: boolean;
  healthy: boolean;
  isMock: boolean;
  lastError?: string | null;
  avgLatencyMs: number;
  rateLimitRemaining?: number | null;
}

export interface SelfHostedRuntimeStatus {
  backendKind: 'gemini' | 'self_hosted' | 'custom_openai_compatible' | 'mock' | 'unconfigured';
  endpointUrl: string;
  configuredModel: string;
  reachable: boolean;
  modelAvailable: boolean;
  availableModels: string[];
  latencyMs: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  statusMessage: string;
}

export interface SearchPaginationInfo {
  page: number;
  limit: number;
  totalResults: number;
  totalPages: number;
  hasMore: boolean;
}

export interface SearchResponse {
  requestId: string;
  query: string;
  mode: SearchMode;
  understanding: SearchQueryUnderstanding;
  results: NormalizedSearchResult[];
  pagination: SearchPaginationInfo;
  totalBeforeDedup: number;
  duplicatesRemoved: number;
  suggestions: SearchSuggestion[];
  relatedQueries: string[];
  aiAnswer: AiCitedAnswer | null;
  instantAnswer?: {
    kind?: 'entity' | 'calculator' | 'conversion' | 'definition' | 'color';
    title: string;
    subtitle?: string;
    summary: string;
    url: string;
    source: string;
    thumbnailUrl?: string;
    facts?: Array<{ label: string; value: string }>;
  } | null;
  providersQueried: string[];
  providerErrors: Array<{ providerId: string; error: string }>;
  indexStatus: {
    indexedDocuments: number;
    limitedCoverage: boolean;
    notice: string;
  };
  aiRuntimeStatus?: SelfHostedRuntimeStatus;
  cacheHit: boolean;
  reranked: boolean;
  latencyMs: number;
  sourceMode: 'cloud' | 'local_fallback' | 'hybrid';
}

export interface LavrayIndexDocument {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string;
  mainContent: string;
  snippet: string;
  headings: string[];
  language: string;
  sourceDomain: string;
  contentType: 'web' | 'news' | 'docs';
  contentHash: string;
  authorityScore: number;
  authorityMethod: string;
  publishedAt?: string | null;
  crawledAt: number;
  indexVersion: string;
  embedding: number[];
}

export interface CrawlSeedConfig {
  seedUrls: string[];
  allowedDomains: string[];
  maxDepth?: number;
  maxPages?: number;
  perDomainDelayMs?: number;
  respectRobotsTxt?: boolean;
  allowLocalhostForTest?: boolean;
}

export interface CrawlQueueEntry {
  url: string;
  depth: number;
}

export interface CrawlCheckpoint {
  id: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  seedUrls: string[];
  allowedDomains: string[];
  maxDepth: number;
  maxPages: number;
  perDomainDelayMs: number;
  visitedUrls: string[];
  queue: CrawlQueueEntry[];
  discoveredCount: number;
  indexedCount: number;
  updatedCount: number;
  skippedCount: number;
  duplicateCount: number;
  failedCount: number;
  errorSamples: Array<{ url: string; error: string }>;
  startedAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface LavrayIndexStats {
  totalDocuments: number;
  uniqueDomains: number;
  latestCrawlAt: number | null;
  indexVersion: string;
  limitedCoverage: boolean;
  notice: string;
}

export interface HybridIndexDocument {
  id: string;
  userId: string;
  profileId: string;
  sourceType: 'bookmark' | 'note' | 'research' | 'memory' | 'tab_snapshot' | 'web_page';
  sourceId: string;
  url?: string | null;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  embeddingVersion: string;
  embedding: number[];
  expiresAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface HybridSearchHit {
  document: HybridIndexDocument;
  keywordScore: number;
  semanticScore: number;
  recencyScore: number;
  combinedScore: number;
}

export type CloudSyncCategory =
  | 'profile'
  | 'bookmarks'
  | 'notes'
  | 'search_history'
  | 'research'
  | 'memory'
  | 'skills';

export interface CloudConsentSettings {
  syncProfile: boolean;
  syncBookmarks: boolean;
  syncNotes: boolean;
  syncSearchHistory: boolean;
  syncResearch: boolean;
  syncMemory: boolean;
  syncSkills: boolean;
  syncPreferences: boolean;
  syncReadingList: boolean;
  syncHistory: boolean;
  syncTabs: boolean;
  syncHayaConversations: boolean;
  syncHayaPreferences: boolean;
  e2eeEnabled: boolean;
  allowCloudSearch: boolean;
  allowCloudAi: boolean;
}

export const DEFAULT_CLOUD_CONSENT: CloudConsentSettings = {
  syncProfile: false,
  syncBookmarks: false,
  syncNotes: false,
  syncSearchHistory: false,
  syncResearch: false,
  syncMemory: false,
  syncSkills: false,
  syncPreferences: false,
  syncReadingList: false,
  syncHistory: false,
  syncTabs: false,
  syncHayaConversations: false,
  syncHayaPreferences: false,
  e2eeEnabled: false,
  allowCloudSearch: false,
  allowCloudAi: false
};

export interface CloudUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  emailVerifiedAt?: number | null;
  e2eeEnabled?: boolean;
  e2eeKeyVersion?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CloudProfile {
  id: string;
  userId: string;
  name: string;
  settings: Record<string, unknown>;
  consent: CloudConsentSettings;
  createdAt: number;
  updatedAt: number;
}

export interface CloudDevice {
  id: string;
  userId: string;
  profileId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  lastSeenAt: number;
  revokedAt?: number | null;
  isCurrent?: boolean;
  createdAt: number;
}

export interface CloudAuthSession {
  user: CloudUser;
  profile: CloudProfile;
  deviceId?: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  verificationRequired?: boolean;
  devVerificationToken?: string | null;
}

export type CloudSyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'expired';

export interface CloudConnectionStatus {
  cloudEnabled: boolean;
  cloudEndpointUrl: string;
  reachable: boolean;
  authenticated: boolean;
  operatingMode: 'local_only' | 'cloud_connected' | 'cloud_degraded';
  userId?: string | null;
  userEmail?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  profileId?: string | null;
  deviceId?: string | null;
  e2eeEnabled?: boolean;
  e2eeUnlocked?: boolean;
  syncState?: CloudSyncState;
  pendingSyncCount?: number;
  lastSyncedAt?: number | null;
  lastError?: string | null;
  consent: CloudConsentSettings;
}

export interface E2eeKeyEnvelope {
  keyVersion: number;
  saltB64: string;
  ivB64: string;
  tagB64: string;
  ciphertextB64: string;
  iterations: number;
  updatedAt: number;
}

export interface EncryptedPayloadEnvelope {
  v: 1;
  alg: 'aes-256-gcm';
  keyVersion: number;
  iv: string;
  tag: string;
  ciphertext: string;
}

export type SyncEntityType =
  | 'bookmark'
  | 'bookmark_folder'
  | 'preference'
  | 'reading_list'
  | 'history'
  | 'open_tab'
  | 'note'
  | 'haya_conversation'
  | 'haya_preference'
  | 'haya_memory';

export interface SyncRecordEnvelope {
  id: string;
  entityType: SyncEntityType;
  version: number;
  updatedAt: number;
  deletedAt?: number | null;
  clientChangeId?: string | null;
  encrypted: boolean;
  payload: Record<string, unknown> | EncryptedPayloadEnvelope;
}

export interface SyncPushItem {
  id: string;
  entityType: SyncEntityType;
  baseVersion: number;
  updatedAt: number;
  deletedAt?: number | null;
  clientChangeId: string;
  encrypted: boolean;
  payload: Record<string, unknown> | EncryptedPayloadEnvelope;
}

export interface SyncPushResponse {
  applied: SyncRecordEnvelope[];
  conflicts: Array<{
    clientItem: SyncPushItem;
    serverItem: SyncRecordEnvelope;
  }>;
  serverVersion: number;
}

export interface SyncPullResponse {
  items: SyncRecordEnvelope[];
  serverVersion: number;
  hasMore: boolean;
  nextCursor: number;
}

export interface CloudBookmarkRecord {
  id: string;
  userId: string;
  profileId: string;
  url: string;
  title: string;
  folderName?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CloudNoteRecord {
  id: string;
  userId: string;
  profileId: string;
  title: string;
  content: string;
  sourceUrl?: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CloudSearchHistoryRecord {
  id: string;
  userId: string;
  profileId: string;
  query: string;
  mode: SearchMode;
  resultCount: number;
  createdAt: number;
}

export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'dead_letter';

export interface CloudBackgroundJob {
  id: string;
  userId: string;
  profileId: string;
  type: 'research_job' | 'page_extract' | 'reindex_knowledge' | 'embedding_backfill';
  payload: Record<string, unknown>;
  status: BackgroundJobStatus;
  attempts: number;
  maxAttempts: number;
  result?: Record<string, unknown> | null;
  error?: string | null;
  runAfter: number;
  createdAt: number;
  updatedAt: number;
}

export interface ObservabilitySnapshot {
  service: string;
  uptimeMs: number;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  search: {
    totalSearches: number;
    cacheHits: number;
    cacheHitRate: number;
    avgLatencyMs: number;
    providerErrors: Record<string, number>;
    providers: SearchProviderHealth[];
  };
  ai: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalEstimatedCostUsd: number;
    failedCalls: number;
  };
  worker: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    deadLetter: number;
  };
  storage: {
    postgresConnected: boolean;
    redisConnected: boolean;
    mode: 'postgres' | 'in_memory';
  };
  crawler?: {
    indexedDocuments: number;
    crawlErrors: number;
    duplicateRate: number;
    crawlThroughputPerMin: number;
  };
}

export interface SearchEvalCaseResult {
  queryId: string;
  query: string;
  mode: SearchMode;
  precisionAt5: number;
  recallAt5: number;
  ndcgAt5: number;
  duplicateRate: number;
  citationAccuracy: number;
  groundedness: number;
  latencyMs: number;
  estimatedCostUsd: number;
  passed: boolean;
}

export interface SearchEvalMetrics {
  datasetSize: number;
  avgPrecisionAt5: number;
  avgRecallAt5: number;
  avgNdcgAt5: number;
  avgDuplicateRate: number;
  avgCitationAccuracy: number;
  avgGroundedness: number;
  providerFailureResilienceRate: number;
  avgLatencyMs: number;
  avgCostPerSearchUsd: number;
  passRate: number;
  cases: SearchEvalCaseResult[];
}

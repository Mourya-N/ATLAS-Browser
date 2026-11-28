import type {
  LavrayIndexDocument,
  LavrayIndexStats,
  CloudBackgroundJob,
  CloudBookmarkRecord,
  CloudConsentSettings,
  CloudDevice,
  CloudNoteRecord,
  CloudProfile,
  CloudSearchHistoryRecord,
  CloudUser,
  CrawlCheckpoint,
  E2eeKeyEnvelope,
  HybridIndexDocument,
  HybridSearchHit,
  MemoryItem,
  ResearchReport,
  SyncEntityType,
  SyncPushItem,
  SyncPushResponse,
  SyncPullResponse
} from '@shared/types';

export interface StoredUserRecord extends CloudUser {
  passwordHash: string;
  e2eeKeyEnvelope?: E2eeKeyEnvelope | null;
  tokenEpoch?: number;
}

export interface StoredRefreshToken {
  id: string;
  userId: string;
  profileId: string;
  deviceId?: string | null;
  tokenHash: string;
  expiresAt: number;
  revokedAt?: number | null;
  createdAt: number;
}

export interface StoredAccountToken {
  id: string;
  userId: string;
  purpose: 'email_verify' | 'password_reset';
  tokenHash: string;
  expiresAt: number;
  usedAt?: number | null;
  createdAt: number;
}

export interface CloudAuditEventRecord {
  id: string;
  userId?: string | null;
  profileId?: string | null;
  category: string;
  action: string;
  requestId?: string | null;
  details: Record<string, unknown>;
  createdAt: number;
}

export interface SavedSourceRecord {
  id: string;
  userId: string;
  profileId: string;
  reportId?: string | null;
  url: string;
  title: string;
  excerpt: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface CloudRepository {
  readonly mode: 'postgres' | 'in_memory';
  ping(): Promise<boolean>;
  close(): Promise<void>;

  // Identity & Profiles
  createUserWithProfile(params: {
    user: StoredUserRecord;
    profile: CloudProfile;
  }): Promise<void>;
  findUserByEmail(email: string): Promise<StoredUserRecord | null>;
  findUserById(userId: string): Promise<StoredUserRecord | null>;
  getAuthSessionState(
    userId: string,
    deviceId?: string | null
  ): Promise<{ exists: boolean; tokenEpoch: number; deviceRevoked: boolean }>;
  updateUserProfile(
    userId: string,
    patch: { displayName?: string; avatarUrl?: string | null }
  ): Promise<StoredUserRecord | null>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  markEmailVerified(userId: string, verifiedAt: number): Promise<StoredUserRecord | null>;
  setUserE2eeEnvelope(
    userId: string,
    params: { e2eeEnabled: boolean; e2eeKeyVersion: number; envelope: E2eeKeyEnvelope | null }
  ): Promise<StoredUserRecord | null>;
  listProfiles(userId: string): Promise<CloudProfile[]>;
  getProfile(userId: string, profileId: string): Promise<CloudProfile | null>;
  createProfile(profile: CloudProfile): Promise<CloudProfile>;
  updateProfileConsent(
    userId: string,
    profileId: string,
    consent: CloudConsentSettings
  ): Promise<CloudProfile | null>;
  registerDevice(device: CloudDevice): Promise<CloudDevice>;
  getDevice(userId: string, deviceId: string): Promise<CloudDevice | null>;
  listDevices(userId: string): Promise<CloudDevice[]>;
  revokeDevice(userId: string, deviceId: string, revokedAt: number): Promise<CloudDevice | null>;

  // Auth & Account tokens
  saveRefreshToken(rec: StoredRefreshToken): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null>;
  revokeRefreshToken(tokenHash: string): Promise<void>;
  revokeAllRefreshTokensForUser(userId: string, exceptDeviceId?: string): Promise<void>;
  incrementTokenEpoch(userId: string): Promise<number>;
  saveAccountToken(rec: StoredAccountToken): Promise<void>;
  consumeAccountToken(
    tokenHash: string,
    purpose: 'email_verify' | 'password_reset',
    usedAt: number
  ): Promise<StoredAccountToken | null>;

  // Versioned Sync (with tombstones & idempotency)
  pushSyncRecords(params: {
    userId: string;
    profileId: string;
    items: SyncPushItem[];
  }): Promise<SyncPushResponse>;
  pullSyncRecords(params: {
    userId: string;
    profileId: string;
    sinceVersion: number;
    limit: number;
    entityTypes?: SyncEntityType[];
  }): Promise<SyncPullResponse>;

  // Bookmarks, Notes, Search History, Research, Memory
  upsertBookmark(bm: CloudBookmarkRecord): Promise<CloudBookmarkRecord>;
  listBookmarks(userId: string, profileId: string, limit?: number): Promise<CloudBookmarkRecord[]>;
  deleteBookmark(userId: string, profileId: string, id: string): Promise<void>;

  upsertNote(note: CloudNoteRecord): Promise<CloudNoteRecord>;
  listNotes(userId: string, profileId: string, limit?: number): Promise<CloudNoteRecord[]>;
  deleteNote(userId: string, profileId: string, id: string): Promise<void>;

  recordSearchHistory(entry: CloudSearchHistoryRecord): Promise<void>;
  listSearchHistory(
    userId: string,
    profileId: string,
    limit?: number
  ): Promise<CloudSearchHistoryRecord[]>;
  clearSearchHistory(userId: string, profileId: string): Promise<void>;

  saveResearchReport(userId: string, profileId: string, report: ResearchReport): Promise<void>;
  listResearchReports(userId: string, profileId: string, limit?: number): Promise<ResearchReport[]>;
  saveSource(source: SavedSourceRecord): Promise<SavedSourceRecord>;

  upsertMemoryItem(userId: string, profileId: string, item: MemoryItem): Promise<void>;
  listMemoryItems(userId: string, profileId: string): Promise<MemoryItem[]>;

  // Hybrid Knowledge Index
  upsertHybridDocument(doc: HybridIndexDocument): Promise<HybridIndexDocument>;
  deleteHybridDocument(
    userId: string,
    profileId: string,
    sourceType: string,
    sourceId: string
  ): Promise<void>;
  pruneExpiredHybridDocuments(nowMs?: number): Promise<number>;
  searchHybridDocuments(params: {
    userId: string;
    profileId: string;
    query: string;
    queryEmbedding: number[];
    sourceTypes?: HybridIndexDocument['sourceType'][];
    limit?: number;
  }): Promise<HybridSearchHit[]>;
  listHybridDocuments(userId: string, profileId: string, limit?: number): Promise<HybridIndexDocument[]>;

  // Background Jobs
  enqueueJob(job: CloudBackgroundJob): Promise<CloudBackgroundJob>;
  claimNextDueJob(nowMs?: number): Promise<CloudBackgroundJob | null>;
  updateJob(job: CloudBackgroundJob): Promise<void>;
  getJobStats(): Promise<{
    queued: number;
    running: number;
    completed: number;
    failed: number;
    deadLetter: number;
  }>;

  // First-Party LAVRAY Web Index & Incremental Crawler
  upsertLavrayIndexDocument(doc: LavrayIndexDocument): Promise<{ inserted: boolean; updated: boolean }>;
  removeLavrayIndexDocument(canonicalUrl: string): Promise<boolean>;
  getLavrayIndexDocument(canonicalUrl: string): Promise<LavrayIndexDocument | null>;
  findLavrayDocumentByContentHash(contentHash: string): Promise<LavrayIndexDocument | null>;
  searchLavrayIndex(params: {
    query: string;
    queryEmbedding: number[];
    domains?: string[];
    limit?: number;
  }): Promise<Array<{ document: LavrayIndexDocument; lexicalScore: number; semanticScore: number }>>;
  getLavrayIndexStats(): Promise<LavrayIndexStats>;
  saveCrawlCheckpoint(cp: CrawlCheckpoint): Promise<void>;
  getCrawlCheckpoint(id: string): Promise<CrawlCheckpoint | null>;
  listCrawlCheckpoints(limit?: number): Promise<CrawlCheckpoint[]>;

  // Audit & Full GDPR Export/Delete
  logAudit(event: CloudAuditEventRecord): Promise<void>;
  exportAllUserData(userId: string): Promise<Record<string, unknown>>;
  deleteUserAccount(userId: string): Promise<void>;
}

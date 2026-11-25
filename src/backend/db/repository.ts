import type {
  CloudBackgroundJob,
  CloudBookmarkRecord,
  CloudConsentSettings,
  CloudDevice,
  CloudNoteRecord,
  CloudProfile,
  CloudSearchHistoryRecord,
  CloudUser,
  HybridIndexDocument,
  HybridSearchHit,
  MemoryItem,
  ResearchReport
} from '@shared/types';

export interface StoredUserRecord extends CloudUser {
  passwordHash: string;
}

export interface StoredRefreshToken {
  id: string;
  userId: string;
  profileId: string;
  tokenHash: string;
  expiresAt: number;
  revokedAt?: number | null;
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
  listProfiles(userId: string): Promise<CloudProfile[]>;
  getProfile(userId: string, profileId: string): Promise<CloudProfile | null>;
  createProfile(profile: CloudProfile): Promise<CloudProfile>;
  updateProfileConsent(
    userId: string,
    profileId: string,
    consent: CloudConsentSettings
  ): Promise<CloudProfile | null>;
  registerDevice(device: CloudDevice): Promise<CloudDevice>;
  listDevices(userId: string): Promise<CloudDevice[]>;

  // Auth tokens
  saveRefreshToken(rec: StoredRefreshToken): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null>;
  revokeRefreshToken(tokenHash: string): Promise<void>;

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

  // Audit & Full GDPR Export/Delete
  logAudit(event: CloudAuditEventRecord): Promise<void>;
  exportAllUserData(userId: string): Promise<Record<string, unknown>>;
  deleteUserAccount(userId: string): Promise<void>;
}

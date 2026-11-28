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
  CrawlCheckpoint,
  E2eeKeyEnvelope,
  HybridIndexDocument,
  HybridSearchHit,
  MemoryItem,
  ResearchReport,
  SyncEntityType,
  SyncPushItem,
  SyncPushResponse,
  SyncPullResponse,
  SyncRecordEnvelope
} from '@shared/types';
import { cosineSimilarity } from '@shared/text-utils';
import type {
  CloudAuditEventRecord,
  CloudRepository,
  SavedSourceRecord,
  StoredAccountToken,
  StoredRefreshToken,
  StoredUserRecord
} from './repository';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

export class InMemoryCloudRepository implements CloudRepository {
  public readonly mode = 'in_memory' as const;

  private readonly users = new Map<string, StoredUserRecord>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly profiles = new Map<string, CloudProfile>();
  private readonly devices = new Map<string, CloudDevice>();
  private readonly refreshTokens = new Map<string, StoredRefreshToken>();
  private readonly accountTokens = new Map<string, StoredAccountToken>();
  private readonly syncRecords = new Map<string, SyncRecordEnvelope & { userId: string; profileId: string }>();
  private readonly syncClientChangeMap = new Map<string, SyncRecordEnvelope>();
  private readonly syncVersionCounters = new Map<string, number>();
  private readonly bookmarks = new Map<string, CloudBookmarkRecord>();
  private readonly notes = new Map<string, CloudNoteRecord>();
  private readonly searchHistory: CloudSearchHistoryRecord[] = [];
  private readonly researchReports = new Map<string, { userId: string; profileId: string; report: ResearchReport }>();
  private readonly savedSources: SavedSourceRecord[] = [];
  private readonly memoryItems = new Map<string, { userId: string; profileId: string; item: MemoryItem }>();
  private readonly hybridDocs = new Map<string, HybridIndexDocument>();
  private readonly lavrayIndexDocs = new Map<string, LavrayIndexDocument>();
  private readonly crawlCheckpoints = new Map<string, CrawlCheckpoint>();
  private readonly jobs = new Map<string, CloudBackgroundJob>();
  private readonly audits: CloudAuditEventRecord[] = [];

  public async ping(): Promise<boolean> {
    return true;
  }

  public async close(): Promise<void> {
    // No external handles to close
  }

  public async createUserWithProfile(params: {
    user: StoredUserRecord;
    profile: CloudProfile;
  }): Promise<void> {
    const emailKey = params.user.email.toLowerCase();
    if (this.usersByEmail.has(emailKey)) {
      throw new Error('User with this email already exists');
    }
    this.users.set(params.user.id, { ...params.user, email: emailKey });
    this.usersByEmail.set(emailKey, params.user.id);
    this.profiles.set(params.profile.id, params.profile);
  }

  public async findUserByEmail(email: string): Promise<StoredUserRecord | null> {
    const uid = this.usersByEmail.get(email.toLowerCase());
    return uid ? this.users.get(uid) ?? null : null;
  }

  public async findUserById(userId: string): Promise<StoredUserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  public async getAuthSessionState(
    userId: string,
    deviceId?: string | null
  ): Promise<{ exists: boolean; tokenEpoch: number; deviceRevoked: boolean }> {
    const u = this.users.get(userId);
    if (!u) return { exists: false, tokenEpoch: 0, deviceRevoked: false };
    let deviceRevoked = false;
    if (deviceId) {
      const d = this.devices.get(deviceId);
      if (d && d.userId === userId && d.revokedAt) {
        deviceRevoked = true;
      }
    }
    return {
      exists: true,
      tokenEpoch: u.tokenEpoch ?? 1,
      deviceRevoked
    };
  }

  public async updateUserProfile(
    userId: string,
    patch: { displayName?: string; avatarUrl?: string | null }
  ): Promise<StoredUserRecord | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    const updated: StoredUserRecord = {
      ...u,
      displayName: patch.displayName !== undefined ? patch.displayName : u.displayName,
      avatarUrl: patch.avatarUrl !== undefined ? patch.avatarUrl : u.avatarUrl,
      updatedAt: Date.now()
    };
    this.users.set(userId, updated);
    return updated;
  }

  public async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    const u = this.users.get(userId);
    if (!u) return;
    this.users.set(userId, { ...u, passwordHash, updatedAt: Date.now() });
  }

  public async markEmailVerified(userId: string, verifiedAt: number): Promise<StoredUserRecord | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    const updated: StoredUserRecord = {
      ...u,
      emailVerified: true,
      emailVerifiedAt: verifiedAt,
      updatedAt: verifiedAt
    };
    this.users.set(userId, updated);
    return updated;
  }

  public async setUserE2eeEnvelope(
    userId: string,
    params: { e2eeEnabled: boolean; e2eeKeyVersion: number; envelope: E2eeKeyEnvelope | null }
  ): Promise<StoredUserRecord | null> {
    const u = this.users.get(userId);
    if (!u) return null;
    const updated: StoredUserRecord = {
      ...u,
      e2eeEnabled: params.e2eeEnabled,
      e2eeKeyVersion: params.e2eeKeyVersion,
      e2eeKeyEnvelope: params.envelope,
      updatedAt: Date.now()
    };
    this.users.set(userId, updated);
    return updated;
  }

  public async listProfiles(userId: string): Promise<CloudProfile[]> {
    return Array.from(this.profiles.values()).filter((p) => p.userId === userId);
  }

  public async getProfile(userId: string, profileId: string): Promise<CloudProfile | null> {
    const p = this.profiles.get(profileId);
    return p && p.userId === userId ? p : null;
  }

  public async createProfile(profile: CloudProfile): Promise<CloudProfile> {
    this.profiles.set(profile.id, profile);
    return profile;
  }

  public async updateProfileConsent(
    userId: string,
    profileId: string,
    consent: CloudConsentSettings
  ): Promise<CloudProfile | null> {
    const p = await this.getProfile(userId, profileId);
    if (!p) return null;
    const updated: CloudProfile = { ...p, consent: { ...consent }, updatedAt: Date.now() };
    this.profiles.set(profileId, updated);
    return updated;
  }

  public async registerDevice(device: CloudDevice): Promise<CloudDevice> {
    const existing = this.devices.get(device.id);
    const merged: CloudDevice = existing && existing.userId === device.userId
      ? {
          ...existing,
          deviceName: device.deviceName,
          platform: device.platform,
          appVersion: device.appVersion,
          lastSeenAt: device.lastSeenAt,
          revokedAt: null
        }
      : { ...device, revokedAt: device.revokedAt ?? null };
    this.devices.set(merged.id, merged);
    return merged;
  }

  public async getDevice(userId: string, deviceId: string): Promise<CloudDevice | null> {
    const d = this.devices.get(deviceId);
    return d && d.userId === userId ? d : null;
  }

  public async listDevices(userId: string): Promise<CloudDevice[]> {
    return Array.from(this.devices.values())
      .filter((d) => d.userId === userId)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  public async revokeDevice(userId: string, deviceId: string, revokedAt: number): Promise<CloudDevice | null> {
    const d = this.devices.get(deviceId);
    if (!d || d.userId !== userId) return null;
    const updated: CloudDevice = { ...d, revokedAt };
    this.devices.set(deviceId, updated);
    for (const rt of this.refreshTokens.values()) {
      if (rt.userId === userId && rt.deviceId === deviceId && !rt.revokedAt) {
        rt.revokedAt = revokedAt;
      }
    }
    return updated;
  }

  public async saveRefreshToken(rec: StoredRefreshToken): Promise<void> {
    this.refreshTokens.set(rec.tokenHash, rec);
  }

  public async findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null> {
    return this.refreshTokens.get(tokenHash) ?? null;
  }

  public async revokeRefreshToken(tokenHash: string): Promise<void> {
    const rec = this.refreshTokens.get(tokenHash);
    if (rec) rec.revokedAt = Date.now();
  }

  public async revokeAllRefreshTokensForUser(userId: string, exceptDeviceId?: string): Promise<void> {
    const now = Date.now();
    for (const rt of this.refreshTokens.values()) {
      if (rt.userId === userId && !rt.revokedAt && (!exceptDeviceId || rt.deviceId !== exceptDeviceId)) {
        rt.revokedAt = now;
      }
    }
  }

  public async incrementTokenEpoch(userId: string): Promise<number> {
    const u = this.users.get(userId);
    if (!u) return 1;
    const nextEpoch = (u.tokenEpoch ?? 1) + 1;
    this.users.set(userId, { ...u, tokenEpoch: nextEpoch, updatedAt: Date.now() });
    return nextEpoch;
  }

  public async saveAccountToken(rec: StoredAccountToken): Promise<void> {
    this.accountTokens.set(rec.tokenHash, rec);
  }

  public async consumeAccountToken(
    tokenHash: string,
    purpose: 'email_verify' | 'password_reset',
    usedAt: number
  ): Promise<StoredAccountToken | null> {
    const rec = this.accountTokens.get(tokenHash);
    if (!rec || rec.purpose !== purpose || rec.usedAt || rec.expiresAt <= usedAt) {
      return null;
    }
    rec.usedAt = usedAt;
    return { ...rec };
  }

  public async pushSyncRecords(params: {
    userId: string;
    profileId: string;
    items: SyncPushItem[];
  }): Promise<SyncPushResponse> {
    const counterKey = `${params.userId}:${params.profileId}`;
    let currentVersion = this.syncVersionCounters.get(counterKey) ?? 0;
    const applied: SyncRecordEnvelope[] = [];
    const conflicts: SyncPushResponse['conflicts'] = [];

    for (const item of params.items) {
      const changeKey = `${counterKey}:${item.clientChangeId}`;
      const existingChange = this.syncClientChangeMap.get(changeKey);
      if (existingChange) {
        if (
          existingChange.id !== item.id ||
          existingChange.entityType !== item.entityType ||
          JSON.stringify(existingChange.payload) !== JSON.stringify(item.payload)
        ) {
          throw new Error(`Idempotency conflict: clientChangeId "${item.clientChangeId}" reused with different payload`);
        }
        applied.push(existingChange);
        continue;
      }

      const recordKey = `${counterKey}:${item.entityType}:${item.id}`;
      const existing = this.syncRecords.get(recordKey);
      if (existing && existing.version > item.baseVersion) {
        conflicts.push({
          clientItem: item,
          serverItem: {
            id: existing.id,
            entityType: existing.entityType,
            version: existing.version,
            updatedAt: existing.updatedAt,
            deletedAt: existing.deletedAt ?? null,
            clientChangeId: existing.clientChangeId ?? null,
            encrypted: existing.encrypted,
            payload: existing.payload
          }
        });
        continue;
      }

      currentVersion += 1;
      const stored: SyncRecordEnvelope & { userId: string; profileId: string } = {
        id: item.id,
        userId: params.userId,
        profileId: params.profileId,
        entityType: item.entityType,
        version: currentVersion,
        updatedAt: item.updatedAt,
        deletedAt: item.deletedAt ?? null,
        clientChangeId: item.clientChangeId,
        encrypted: item.encrypted,
        payload: item.payload
      };
      this.syncRecords.set(recordKey, stored);
      const envelope: SyncRecordEnvelope = {
        id: stored.id,
        entityType: stored.entityType,
        version: stored.version,
        updatedAt: stored.updatedAt,
        deletedAt: stored.deletedAt,
        clientChangeId: stored.clientChangeId,
        encrypted: stored.encrypted,
        payload: stored.payload
      };
      this.syncClientChangeMap.set(changeKey, envelope);
      applied.push(envelope);
    }

    this.syncVersionCounters.set(counterKey, currentVersion);
    return { applied, conflicts, serverVersion: currentVersion };
  }

  public async pullSyncRecords(params: {
    userId: string;
    profileId: string;
    sinceVersion: number;
    limit: number;
    entityTypes?: SyncEntityType[];
  }): Promise<SyncPullResponse> {
    const counterKey = `${params.userId}:${params.profileId}`;
    const serverVersion = this.syncVersionCounters.get(counterKey) ?? 0;
    const allowedTypes = params.entityTypes ? new Set(params.entityTypes) : null;

    const matching = Array.from(this.syncRecords.values())
      .filter(
        (r) =>
          r.userId === params.userId &&
          r.profileId === params.profileId &&
          r.version > params.sinceVersion &&
          (!allowedTypes || allowedTypes.has(r.entityType))
      )
      .sort((a, b) => a.version - b.version);

    const slice = matching.slice(0, params.limit);
    const hasMore = matching.length > params.limit;
    const nextCursor = slice.length > 0 ? slice[slice.length - 1].version : params.sinceVersion;

    return {
      items: slice.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        version: r.version,
        updatedAt: r.updatedAt,
        deletedAt: r.deletedAt ?? null,
        clientChangeId: r.clientChangeId ?? null,
        encrypted: r.encrypted,
        payload: r.payload
      })),
      serverVersion,
      hasMore,
      nextCursor
    };
  }

  public async upsertBookmark(bm: CloudBookmarkRecord): Promise<CloudBookmarkRecord> {
    this.bookmarks.set(bm.id, bm);
    return bm;
  }

  public async listBookmarks(userId: string, profileId: string, limit = 100): Promise<CloudBookmarkRecord[]> {
    return Array.from(this.bookmarks.values())
      .filter((b) => b.userId === userId && b.profileId === profileId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  public async deleteBookmark(userId: string, profileId: string, id: string): Promise<void> {
    const b = this.bookmarks.get(id);
    if (b && b.userId === userId && b.profileId === profileId) {
      this.bookmarks.delete(id);
    }
  }

  public async upsertNote(note: CloudNoteRecord): Promise<CloudNoteRecord> {
    this.notes.set(note.id, note);
    return note;
  }

  public async listNotes(userId: string, profileId: string, limit = 100): Promise<CloudNoteRecord[]> {
    return Array.from(this.notes.values())
      .filter((n) => n.userId === userId && n.profileId === profileId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  public async deleteNote(userId: string, profileId: string, id: string): Promise<void> {
    const n = this.notes.get(id);
    if (n && n.userId === userId && n.profileId === profileId) {
      this.notes.delete(id);
    }
  }

  public async recordSearchHistory(entry: CloudSearchHistoryRecord): Promise<void> {
    this.searchHistory.push(entry);
  }

  public async listSearchHistory(
    userId: string,
    profileId: string,
    limit = 50
  ): Promise<CloudSearchHistoryRecord[]> {
    return this.searchHistory
      .filter((h) => h.userId === userId && h.profileId === profileId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  public async clearSearchHistory(userId: string, profileId: string): Promise<void> {
    for (let i = this.searchHistory.length - 1; i >= 0; i--) {
      if (this.searchHistory[i].userId === userId && this.searchHistory[i].profileId === profileId) {
        this.searchHistory.splice(i, 1);
      }
    }
  }

  public async saveResearchReport(userId: string, profileId: string, report: ResearchReport): Promise<void> {
    this.researchReports.set(report.id, { userId, profileId, report });
  }

  public async listResearchReports(userId: string, profileId: string, limit = 50): Promise<ResearchReport[]> {
    return Array.from(this.researchReports.values())
      .filter((r) => r.userId === userId && r.profileId === profileId)
      .map((r) => r.report)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  public async saveSource(source: SavedSourceRecord): Promise<SavedSourceRecord> {
    this.savedSources.push(source);
    return source;
  }

  public async upsertMemoryItem(userId: string, profileId: string, item: MemoryItem): Promise<void> {
    this.memoryItems.set(item.id, { userId, profileId, item });
  }

  public async listMemoryItems(userId: string, profileId: string): Promise<MemoryItem[]> {
    return Array.from(this.memoryItems.values())
      .filter((m) => m.userId === userId && m.profileId === profileId)
      .map((m) => m.item);
  }

  private hybridKey(userId: string, profileId: string, sourceType: string, sourceId: string): string {
    return `${userId}:${profileId}:${sourceType}:${sourceId}`;
  }

  public async upsertHybridDocument(doc: HybridIndexDocument): Promise<HybridIndexDocument> {
    this.hybridDocs.set(this.hybridKey(doc.userId, doc.profileId, doc.sourceType, doc.sourceId), doc);
    return doc;
  }

  public async deleteHybridDocument(
    userId: string,
    profileId: string,
    sourceType: string,
    sourceId: string
  ): Promise<void> {
    this.hybridDocs.delete(this.hybridKey(userId, profileId, sourceType, sourceId));
  }

  public async pruneExpiredHybridDocuments(nowMs = Date.now()): Promise<number> {
    let removed = 0;
    for (const [k, doc] of this.hybridDocs.entries()) {
      if (doc.expiresAt && doc.expiresAt <= nowMs) {
        this.hybridDocs.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  public async searchHybridDocuments(params: {
    userId: string;
    profileId: string;
    query: string;
    queryEmbedding: number[];
    sourceTypes?: HybridIndexDocument['sourceType'][];
    limit?: number;
  }): Promise<HybridSearchHit[]> {
    const now = Date.now();
    const queryTokens = new Set(tokenize(params.query));
    const allowedTypes = params.sourceTypes && params.sourceTypes.length > 0 ? new Set(params.sourceTypes) : null;

    const hits: HybridSearchHit[] = [];
    for (const doc of this.hybridDocs.values()) {
      if (doc.userId !== params.userId || doc.profileId !== params.profileId) continue;
      if (doc.expiresAt && doc.expiresAt <= now) continue;
      if (allowedTypes && !allowedTypes.has(doc.sourceType)) continue;

      const words = tokenize(`${doc.title} ${doc.content}`);
      let titleBoost = 0;
      const titleLower = doc.title.toLowerCase();
      let overlap = 0;
      for (const qt of queryTokens) {
        if (titleLower.includes(qt)) titleBoost += 0.2;
        if (words.includes(qt)) overlap += 1;
      }
      const keywordScore =
        queryTokens.size > 0 ? Math.min(1, overlap / queryTokens.size + titleBoost * 0.5) : 0;
      const semanticScore = cosineSimilarity(params.queryEmbedding, doc.embedding);
      const ageDays = Math.max(0, (now - doc.updatedAt) / 86_400_000);
      const recencyScore = 1 / (1 + ageDays / 30);
      const combinedScore = Number((keywordScore * 0.45 + semanticScore * 0.45 + recencyScore * 0.1).toFixed(4));

      if (keywordScore > 0.05 || semanticScore > 0.25) {
        hits.push({ document: doc, keywordScore, semanticScore, recencyScore, combinedScore });
      }
    }

    return hits.sort((a, b) => b.combinedScore - a.combinedScore).slice(0, params.limit ?? 10);
  }

  public async listHybridDocuments(userId: string, profileId: string, limit = 100): Promise<HybridIndexDocument[]> {
    return Array.from(this.hybridDocs.values())
      .filter((d) => d.userId === userId && d.profileId === profileId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  public async enqueueJob(job: CloudBackgroundJob): Promise<CloudBackgroundJob> {
    this.jobs.set(job.id, job);
    return job;
  }

  public async claimNextDueJob(nowMs = Date.now()): Promise<CloudBackgroundJob | null> {
    const due = Array.from(this.jobs.values())
      .filter((j) => j.status === 'queued' && j.runAfter <= nowMs)
      .sort((a, b) => a.runAfter - b.runAfter)[0];
    if (!due) return null;
    const claimed: CloudBackgroundJob = {
      ...due,
      status: 'running',
      attempts: due.attempts + 1,
      updatedAt: nowMs
    };
    this.jobs.set(claimed.id, claimed);
    return claimed;
  }

  public async updateJob(job: CloudBackgroundJob): Promise<void> {
    this.jobs.set(job.id, job);
  }

  public async getJobStats(): Promise<{
    queued: number;
    running: number;
    completed: number;
    failed: number;
    deadLetter: number;
  }> {
    let queued = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    let deadLetter = 0;
    for (const j of this.jobs.values()) {
      if (j.status === 'queued') queued += 1;
      else if (j.status === 'running') running += 1;
      else if (j.status === 'completed') completed += 1;
      else if (j.status === 'failed') failed += 1;
      else if (j.status === 'dead_letter') deadLetter += 1;
    }
    return { queued, running, completed, failed, deadLetter };
  }

  public async logAudit(event: CloudAuditEventRecord): Promise<void> {
    this.audits.push(event);
  }

  public async upsertLavrayIndexDocument(
    doc: LavrayIndexDocument
  ): Promise<{ inserted: boolean; updated: boolean }> {
    const existing = this.lavrayIndexDocs.get(doc.canonicalUrl);
    if (!existing) {
      this.lavrayIndexDocs.set(doc.canonicalUrl, doc);
      return { inserted: true, updated: false };
    }
    const changed = existing.contentHash !== doc.contentHash || existing.title !== doc.title;
    this.lavrayIndexDocs.set(doc.canonicalUrl, doc);
    return { inserted: false, updated: changed };
  }

  public async removeLavrayIndexDocument(canonicalUrl: string): Promise<boolean> {
    return this.lavrayIndexDocs.delete(canonicalUrl);
  }

  public async getLavrayIndexDocument(canonicalUrl: string): Promise<LavrayIndexDocument | null> {
    return this.lavrayIndexDocs.get(canonicalUrl) ?? null;
  }

  public async findLavrayDocumentByContentHash(contentHash: string): Promise<LavrayIndexDocument | null> {
    for (const d of this.lavrayIndexDocs.values()) {
      if (d.contentHash === contentHash) return d;
    }
    return null;
  }

  public async searchLavrayIndex(params: {
    query: string;
    queryEmbedding: number[];
    domains?: string[];
    limit?: number;
  }): Promise<Array<{ document: LavrayIndexDocument; lexicalScore: number; semanticScore: number }>> {
    const queryTokens = Array.from(new Set(tokenize(params.query)));
    const queryLower = params.query.toLowerCase().trim();
    const domainFilters = params.domains?.map((d) => d.toLowerCase()) ?? [];

    const eligibleDocs: LavrayIndexDocument[] = [];
    for (const doc of this.lavrayIndexDocs.values()) {
      if (
        domainFilters.length > 0 &&
        !domainFilters.some((d) => doc.sourceDomain === d || doc.sourceDomain.endsWith(`.${d}`))
      ) {
        continue;
      }
      eligibleDocs.push(doc);
    }

    if (eligibleDocs.length === 0) return [];

    // Compute BM25 corpus statistics (document frequencies & average field-weighted length)
    const docTokensList = eligibleDocs.map((doc) => {
      const titleToks = tokenize(doc.title);
      const headingToks = tokenize(doc.headings.join(' '));
      const bodyToks = tokenize(doc.mainContent);
      // Weight title 3x and headings 2x in term-frequency map
      const tfMap = new Map<string, number>();
      const addWeighted = (toks: string[], weight: number) => {
        for (const t of toks) tfMap.set(t, (tfMap.get(t) ?? 0) + weight);
      };
      addWeighted(titleToks, 3);
      addWeighted(headingToks, 2);
      addWeighted(bodyToks, 1);
      const docLen = titleToks.length * 3 + headingToks.length * 2 + bodyToks.length;
      return { doc, tfMap, docLen, titleLower: doc.title.toLowerCase(), fullLower: `${doc.title} ${doc.mainContent}`.toLowerCase() };
    });

    const N = docTokensList.length;
    const avgDl = Math.max(1, docTokensList.reduce((acc, d) => acc + d.docLen, 0) / N);
    const dfMap = new Map<string, number>();
    for (const qt of queryTokens) {
      let df = 0;
      for (const entry of docTokensList) {
        if (entry.tfMap.has(qt)) df += 1;
      }
      dfMap.set(qt, df);
    }

    const k1 = 1.2;
    const b = 0.75;
    const maxTheoreticalIdf = queryTokens.reduce((acc, qt) => {
      const df = dfMap.get(qt) ?? 0;
      return acc + Math.log(1 + (N - df + 0.5) / (df + 0.5));
    }, 0);

    const results: Array<{ document: LavrayIndexDocument; lexicalScore: number; semanticScore: number }> = [];

    for (const entry of docTokensList) {
      let bm25Raw = 0;
      let matchedCount = 0;
      let titleMatches = 0;
      for (const qt of queryTokens) {
        const tf = entry.tfMap.get(qt) ?? 0;
        if (tf > 0) {
          matchedCount += 1;
          if (entry.titleLower.includes(qt)) titleMatches += 1;
          const df = dfMap.get(qt) ?? 0;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          const tfSat = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * entry.docLen) / avgDl));
          bm25Raw += idf * tfSat;
        }
      }

      const normBm25 = maxTheoreticalIdf > 0 ? Math.min(1, bm25Raw / (maxTheoreticalIdf * 1.45)) : 0;
      const coverage = queryTokens.length > 0 ? matchedCount / queryTokens.length : 0;
      const titleRatio = queryTokens.length > 0 ? titleMatches / queryTokens.length : 0;
      const phraseHit = queryLower.length >= 4 && entry.fullLower.includes(queryLower) ? 0.15 : 0;
      const lexicalScore = Math.min(1, normBm25 * 0.55 + coverage * 0.25 + titleRatio * 0.2 + phraseHit);
      const semanticScore = cosineSimilarity(params.queryEmbedding, entry.doc.embedding);

      if (lexicalScore > 0.08 || semanticScore > 0.45) {
        results.push({ document: entry.doc, lexicalScore, semanticScore });
      }
    }

    return results
      .sort(
        (a, b) =>
          b.lexicalScore * 0.7 + b.semanticScore * 0.3 - (a.lexicalScore * 0.7 + a.semanticScore * 0.3)
      )
      .slice(0, params.limit ?? 20);
  }

  public async getLavrayIndexStats(): Promise<LavrayIndexStats> {
    const docs = Array.from(this.lavrayIndexDocs.values());
    const domains = new Set(docs.map((d) => d.sourceDomain));
    const latestCrawlAt = docs.reduce<number | null>(
      (max, d) => (max === null || d.crawledAt > max ? d.crawledAt : max),
      null
    );
    const limitedCoverage = docs.length < 50;
    return {
      totalDocuments: docs.length,
      uniqueDomains: domains.size,
      latestCrawlAt,
      indexVersion: 'v1',
      limitedCoverage,
      notice: limitedCoverage
        ? `LAVRAY Index currently contains ${docs.length} crawled document(s) across ${domains.size} domain(s) (controlled seed scope). External providers remain helpful for broad web queries.`
        : `LAVRAY Index serving ${docs.length} documents across ${domains.size} domains.`
    };
  }

  public async saveCrawlCheckpoint(cp: CrawlCheckpoint): Promise<void> {
    this.crawlCheckpoints.set(cp.id, cp);
  }

  public async getCrawlCheckpoint(id: string): Promise<CrawlCheckpoint | null> {
    return this.crawlCheckpoints.get(id) ?? null;
  }

  public async listCrawlCheckpoints(limit = 20): Promise<CrawlCheckpoint[]> {
    return Array.from(this.crawlCheckpoints.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  public async exportAllUserData(userId: string): Promise<Record<string, unknown>> {
    const user = this.users.get(userId);
    const profiles = await this.listProfiles(userId);
    const devices = await this.listDevices(userId);
    const bookmarks = Array.from(this.bookmarks.values()).filter((b) => b.userId === userId);
    const notes = Array.from(this.notes.values()).filter((n) => n.userId === userId);
    const searchHistory = this.searchHistory.filter((s) => s.userId === userId);
    const researchReports = Array.from(this.researchReports.values())
      .filter((r) => r.userId === userId)
      .map((r) => r.report);
    const memoryItems = Array.from(this.memoryItems.values())
      .filter((m) => m.userId === userId)
      .map((m) => m.item);
    const syncRecords = Array.from(this.syncRecords.values()).filter((r) => r.userId === userId);

    return {
      exportedAt: new Date().toISOString(),
      user: user
        ? {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl ?? null,
            emailVerified: Boolean(user.emailVerified),
            e2eeEnabled: Boolean(user.e2eeEnabled),
            createdAt: user.createdAt
          }
        : null,
      profiles,
      devices,
      bookmarks,
      notes,
      searchHistory,
      researchReports,
      memoryItems,
      syncRecords
    };
  }

  public async deleteUserAccount(userId: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) this.usersByEmail.delete(u.email.toLowerCase());
    this.users.delete(userId);
    for (const [k, v] of this.profiles.entries()) if (v.userId === userId) this.profiles.delete(k);
    for (const [k, v] of this.devices.entries()) if (v.userId === userId) this.devices.delete(k);
    for (const [k, v] of this.refreshTokens.entries()) if (v.userId === userId) this.refreshTokens.delete(k);
    for (const [k, v] of this.accountTokens.entries()) if (v.userId === userId) this.accountTokens.delete(k);
    for (const [k, v] of this.syncRecords.entries()) if (v.userId === userId) this.syncRecords.delete(k);
    for (const [k] of this.syncClientChangeMap.entries()) {
      if (k.startsWith(`${userId}:`)) this.syncClientChangeMap.delete(k);
    }
    for (const [k] of this.syncVersionCounters.entries()) {
      if (k.startsWith(`${userId}:`)) this.syncVersionCounters.delete(k);
    }
    for (const [k, v] of this.bookmarks.entries()) if (v.userId === userId) this.bookmarks.delete(k);
    for (const [k, v] of this.notes.entries()) if (v.userId === userId) this.notes.delete(k);
    for (const [k, v] of this.researchReports.entries()) if (v.userId === userId) this.researchReports.delete(k);
    for (const [k, v] of this.memoryItems.entries()) if (v.userId === userId) this.memoryItems.delete(k);
    for (const [k, v] of this.hybridDocs.entries()) if (v.userId === userId) this.hybridDocs.delete(k);
    for (const [k, v] of this.jobs.entries()) if (v.userId === userId) this.jobs.delete(k);
    for (let i = this.searchHistory.length - 1; i >= 0; i--) {
      if (this.searchHistory[i].userId === userId) this.searchHistory.splice(i, 1);
    }
  }
}

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
  HybridIndexDocument,
  HybridSearchHit,
  MemoryItem,
  ResearchReport
} from '@shared/types';
import { cosineSimilarity } from '@shared/text-utils';
import type {
  CloudAuditEventRecord,
  CloudRepository,
  SavedSourceRecord,
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
    this.devices.set(device.id, device);
    return device;
  }

  public async listDevices(userId: string): Promise<CloudDevice[]> {
    return Array.from(this.devices.values()).filter((d) => d.userId === userId);
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
    const domainFilters = params.domains?.map((d) => d.toLowerCase()) ?? [];
    const results: Array<{ document: LavrayIndexDocument; lexicalScore: number; semanticScore: number }> = [];

    for (const doc of this.lavrayIndexDocs.values()) {
      if (
        domainFilters.length > 0 &&
        !domainFilters.some((d) => doc.sourceDomain === d || doc.sourceDomain.endsWith(`.${d}`))
      ) {
        continue;
      }

      const hayTokens = tokenize(`${doc.title} ${doc.headings.join(' ')} ${doc.mainContent}`);
      const titleLower = doc.title.toLowerCase();
      let matched = 0;
      let titleMatches = 0;
      for (const qt of queryTokens) {
        if (titleLower.includes(qt)) titleMatches += 1;
        if (hayTokens.includes(qt)) matched += 1;
      }
      // BM25-like saturation on matched terms vs query length
      const lexicalScore =
        queryTokens.length > 0
          ? Math.min(1, (matched / queryTokens.length) * 0.65 + (titleMatches / queryTokens.length) * 0.35)
          : 0;
      const semanticScore = cosineSimilarity(params.queryEmbedding, doc.embedding);

      if (lexicalScore > 0.05 || semanticScore > 0.45) {
        results.push({ document: doc, lexicalScore, semanticScore });
      }
    }

    return results
      .sort(
        (a, b) =>
          b.lexicalScore * 0.6 + b.semanticScore * 0.4 - (a.lexicalScore * 0.6 + a.semanticScore * 0.4)
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

    return {
      exportedAt: new Date().toISOString(),
      user: user
        ? { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt }
        : null,
      profiles,
      devices,
      bookmarks,
      notes,
      searchHistory,
      researchReports,
      memoryItems
    };
  }

  public async deleteUserAccount(userId: string): Promise<void> {
    const u = this.users.get(userId);
    if (u) this.usersByEmail.delete(u.email.toLowerCase());
    this.users.delete(userId);
    for (const [k, v] of this.profiles.entries()) if (v.userId === userId) this.profiles.delete(k);
    for (const [k, v] of this.devices.entries()) if (v.userId === userId) this.devices.delete(k);
    for (const [k, v] of this.refreshTokens.entries()) if (v.userId === userId) this.refreshTokens.delete(k);
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

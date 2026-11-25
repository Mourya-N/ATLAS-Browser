import { randomUUID } from 'node:crypto';
import type {
  CloudBookmarkRecord,
  CloudConsentSettings,
  CloudNoteRecord,
  CloudSearchHistoryRecord,
  MemoryItem,
  ResearchReport,
  SearchMode
} from '@shared/types';
import { computeLocalEmbedding, MemoryService } from '@main/memory/memory-service';
import type { CloudRepository } from '../../db/repository';
import type { HybridIndexService } from '../knowledge/hybrid-index-service';

export class ConsentRequiredError extends Error {
  constructor(
    public readonly category: keyof CloudConsentSettings,
    message: string
  ) {
    super(message);
    this.name = 'ConsentRequiredError';
  }
}

export class UserDataService {
  private readonly secretChecker = new MemoryService(null as never);

  constructor(
    private readonly repo: CloudRepository,
    private readonly hybridIndex: HybridIndexService
  ) {}

  private async requireConsent(
    userId: string,
    profileId: string,
    flag: keyof CloudConsentSettings
  ): Promise<void> {
    const profile = await this.repo.getProfile(userId, profileId);
    if (!profile) {
      throw new Error('Profile not found');
    }
    if (!profile.consent[flag]) {
      throw new ConsentRequiredError(
        flag,
        `Cloud synchronization consent (${flag}) is disabled for this profile.`
      );
    }
  }

  public async saveBookmark(params: {
    userId: string;
    profileId: string;
    id?: string;
    url: string;
    title: string;
    folderName?: string | null;
    isPrivate?: boolean;
  }): Promise<CloudBookmarkRecord> {
    if (params.isPrivate) {
      throw new Error('Private browsing items cannot be uploaded to Atlas Cloud');
    }
    await this.requireConsent(params.userId, params.profileId, 'syncBookmarks');
    const now = Date.now();
    const record: CloudBookmarkRecord = {
      id: params.id || randomUUID(),
      userId: params.userId,
      profileId: params.profileId,
      url: params.url,
      title: params.title,
      folderName: params.folderName ?? null,
      createdAt: now,
      updatedAt: now
    };
    const saved = await this.repo.upsertBookmark(record);
    await this.hybridIndex.upsertDocument({
      userId: params.userId,
      profileId: params.profileId,
      sourceType: 'bookmark',
      sourceId: saved.id,
      url: saved.url,
      title: saved.title,
      content: `${saved.title} ${saved.url} ${saved.folderName || ''}`,
      metadata: { folderName: saved.folderName }
    });
    return saved;
  }

  public async listBookmarks(userId: string, profileId: string): Promise<CloudBookmarkRecord[]> {
    return this.repo.listBookmarks(userId, profileId);
  }

  public async deleteBookmark(userId: string, profileId: string, id: string): Promise<void> {
    await this.repo.deleteBookmark(userId, profileId, id);
    await this.hybridIndex.deleteDocument(userId, profileId, 'bookmark', id);
  }

  public async saveNote(params: {
    userId: string;
    profileId: string;
    id?: string;
    title: string;
    content: string;
    sourceUrl?: string | null;
    tags?: string[];
    isPrivate?: boolean;
  }): Promise<CloudNoteRecord> {
    if (params.isPrivate) {
      throw new Error('Private browsing notes cannot be uploaded to Atlas Cloud');
    }
    await this.requireConsent(params.userId, params.profileId, 'syncNotes');
    if (this.secretChecker.containsSensitiveData(`${params.title}\n${params.content}`)) {
      throw new Error('Refusing to store sensitive credentials or secrets in cloud notes');
    }
    const now = Date.now();
    const note: CloudNoteRecord = {
      id: params.id || randomUUID(),
      userId: params.userId,
      profileId: params.profileId,
      title: params.title.trim(),
      content: params.content.trim(),
      sourceUrl: params.sourceUrl ?? null,
      tags: params.tags ?? [],
      createdAt: now,
      updatedAt: now
    };
    const saved = await this.repo.upsertNote(note);
    await this.hybridIndex.upsertDocument({
      userId: params.userId,
      profileId: params.profileId,
      sourceType: 'note',
      sourceId: saved.id,
      url: saved.sourceUrl,
      title: saved.title,
      content: `${saved.title}\n${saved.content}\nTags: ${saved.tags.join(', ')}`,
      metadata: { tags: saved.tags }
    });
    return saved;
  }

  public async listNotes(userId: string, profileId: string): Promise<CloudNoteRecord[]> {
    return this.repo.listNotes(userId, profileId);
  }

  public async deleteNote(userId: string, profileId: string, id: string): Promise<void> {
    await this.repo.deleteNote(userId, profileId, id);
    await this.hybridIndex.deleteDocument(userId, profileId, 'note', id);
  }

  public async maybeRecordSearchHistory(params: {
    userId: string;
    profileId: string;
    query: string;
    mode: SearchMode;
    resultCount: number;
    isPrivate?: boolean;
  }): Promise<boolean> {
    if (params.isPrivate) return false;
    const profile = await this.repo.getProfile(params.userId, params.profileId);
    if (!profile || !profile.consent.syncSearchHistory) return false;
    await this.repo.recordSearchHistory({
      id: randomUUID(),
      userId: params.userId,
      profileId: params.profileId,
      query: params.query.slice(0, 500),
      mode: params.mode,
      resultCount: params.resultCount,
      createdAt: Date.now()
    });
    return true;
  }

  public async listSearchHistory(userId: string, profileId: string): Promise<CloudSearchHistoryRecord[]> {
    return this.repo.listSearchHistory(userId, profileId);
  }

  public async clearSearchHistory(userId: string, profileId: string): Promise<void> {
    await this.repo.clearSearchHistory(userId, profileId);
  }

  public async saveResearchReport(params: {
    userId: string;
    profileId: string;
    report: ResearchReport;
    isPrivate?: boolean;
  }): Promise<ResearchReport> {
    if (params.isPrivate) {
      throw new Error('Private research cannot be persisted to Atlas Cloud');
    }
    await this.requireConsent(params.userId, params.profileId, 'syncResearch');
    await this.repo.saveResearchReport(params.userId, params.profileId, params.report);
    for (const s of params.report.sources) {
      await this.repo.saveSource({
        id: randomUUID(),
        userId: params.userId,
        profileId: params.profileId,
        reportId: params.report.id,
        url: s.url,
        title: s.title,
        excerpt: params.report.summary.slice(0, 400),
        metadata: { query: params.report.query },
        createdAt: Date.now()
      });
    }
    await this.hybridIndex.upsertDocument({
      userId: params.userId,
      profileId: params.profileId,
      sourceType: 'research',
      sourceId: params.report.id,
      url: params.report.sources[0]?.url ?? null,
      title: params.report.query,
      content: `${params.report.summary}\n${params.report.claims.map((c) => c.claim).join('\n')}`,
      metadata: { sourceCount: params.report.sources.length }
    });
    return params.report;
  }

  public async listResearchReports(userId: string, profileId: string): Promise<ResearchReport[]> {
    return this.repo.listResearchReports(userId, profileId);
  }

  public async syncMemoryItem(params: {
    userId: string;
    profileId: string;
    item: MemoryItem;
    isPrivate?: boolean;
  }): Promise<void> {
    if (params.isPrivate) {
      throw new Error('Private session memory cannot be synced to Atlas Cloud');
    }
    await this.requireConsent(params.userId, params.profileId, 'syncMemory');
    if (!params.item.userApproved) {
      throw new Error('Only user-approved memory items may sync to Atlas Cloud');
    }
    if (this.secretChecker.containsSensitiveData(`${params.item.title}\n${params.item.content}`)) {
      throw new Error('Refusing to upload sensitive secret data to cloud memory');
    }
    const enriched: MemoryItem = {
      ...params.item,
      embedding:
        params.item.embedding && params.item.embedding.length > 0
          ? params.item.embedding
          : computeLocalEmbedding(`${params.item.title} ${params.item.content}`)
    };
    await this.repo.upsertMemoryItem(params.userId, params.profileId, enriched);
    await this.hybridIndex.upsertDocument({
      userId: params.userId,
      profileId: params.profileId,
      sourceType: 'memory',
      sourceId: enriched.id,
      url: enriched.sourceUrl ?? null,
      title: enriched.title,
      content: enriched.content,
      metadata: { category: enriched.category, domain: enriched.domain },
      expiresAt: enriched.expiresAt ?? null
    });
  }

  public async listMemoryItems(userId: string, profileId: string): Promise<MemoryItem[]> {
    return this.repo.listMemoryItems(userId, profileId);
  }
}

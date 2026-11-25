import { randomUUID } from 'node:crypto';
import type { HybridIndexDocument, HybridSearchHit } from '@shared/types';
import { computeLocalEmbedding } from '@main/memory/memory-service';
import type { CloudRepository } from '../../db/repository';

export const CURRENT_EMBEDDING_VERSION = 'v1-hash64';

export class HybridIndexService {
  constructor(private readonly repo: CloudRepository) {}

  public async upsertDocument(input: {
    userId: string;
    profileId: string;
    sourceType: HybridIndexDocument['sourceType'];
    sourceId: string;
    url?: string | null;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
    expiresAt?: number | null;
  }): Promise<HybridIndexDocument> {
    const now = Date.now();
    const doc: HybridIndexDocument = {
      id: randomUUID(),
      userId: input.userId,
      profileId: input.profileId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      url: input.url ?? null,
      title: input.title.trim(),
      content: input.content.trim().slice(0, 20_000),
      metadata: input.metadata ?? {},
      embeddingVersion: CURRENT_EMBEDDING_VERSION,
      embedding: computeLocalEmbedding(`${input.title} ${input.content}`),
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now
    };
    return this.repo.upsertHybridDocument(doc);
  }

  public async deleteDocument(
    userId: string,
    profileId: string,
    sourceType: HybridIndexDocument['sourceType'],
    sourceId: string
  ): Promise<void> {
    await this.repo.deleteHybridDocument(userId, profileId, sourceType, sourceId);
  }

  public async pruneExpired(): Promise<number> {
    return this.repo.pruneExpiredHybridDocuments(Date.now());
  }

  public async reindexProfile(userId: string, profileId: string): Promise<{ reindexed: number }> {
    const docs = await this.repo.listHybridDocuments(userId, profileId, 1000);
    let count = 0;
    for (const d of docs) {
      await this.repo.upsertHybridDocument({
        ...d,
        embeddingVersion: CURRENT_EMBEDDING_VERSION,
        embedding: computeLocalEmbedding(`${d.title} ${d.content}`),
        updatedAt: Date.now()
      });
      count += 1;
    }
    return { reindexed: count };
  }

  public async search(params: {
    userId: string;
    profileId: string;
    query: string;
    sourceTypes?: HybridIndexDocument['sourceType'][];
    limit?: number;
  }): Promise<HybridSearchHit[]> {
    const queryEmbedding = computeLocalEmbedding(params.query);
    return this.repo.searchHybridDocuments({
      userId: params.userId,
      profileId: params.profileId,
      query: params.query,
      queryEmbedding,
      sourceTypes: params.sourceTypes,
      limit: params.limit ?? 10
    });
  }
}

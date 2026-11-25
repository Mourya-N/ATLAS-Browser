import { randomUUID } from 'node:crypto';
import type { MemoryCategory, MemoryItem } from '@shared/types';
import { containsSensitiveText } from '@shared/redaction';
import { computeLocalEmbedding, cosineSimilarity, tokenizeText as tokenize } from '@shared/text-utils';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';

export { computeLocalEmbedding, cosineSimilarity };

export class MemoryService {
  constructor(private readonly repo: PlatformRepository) {}

  public containsSensitiveData(text: string): boolean {
    return containsSensitiveText(text);
  }

  public list(category?: MemoryCategory, profileId = 'default'): MemoryItem[] {
    return this.repo.listMemory(category, profileId);
  }

  public save(input: {
    id?: string;
    profileId?: string;
    category: MemoryCategory;
    domain?: string | null;
    sourceUrl?: string | null;
    title: string;
    content: string;
    confidence?: number;
    source: string;
    userApproved?: boolean;
    expiresAt?: number | null;
    isPrivate?: boolean;
  }): MemoryItem {
    if (input.isPrivate) {
      throw new Error('Refusing to persist memory during private browsing');
    }

    const combined = `${input.title}\n${input.content}`;
    if (this.containsSensitiveData(combined)) {
      throw new Error(
        'Refusing to store sensitive credentials, payment details, private keys, or auth tokens in local memory'
      );
    }

    const profileId = input.profileId || 'default';
    const now = Date.now();
    const existing = input.id
      ? this.repo.listMemory(undefined, profileId).find((m) => m.id === input.id)
      : undefined;

    const embedding = computeLocalEmbedding(`${input.title} ${input.content} ${input.domain || ''}`);

    const item: MemoryItem = {
      id: input.id ?? randomUUID(),
      profileId,
      category: input.category,
      domain: input.domain?.toLowerCase().trim() || null,
      sourceUrl: input.sourceUrl ?? existing?.sourceUrl ?? null,
      title: input.title.trim(),
      content: input.content.trim(),
      confidence: Math.min(1, Math.max(0, input.confidence ?? existing?.confidence ?? 0.85)),
      source: input.source,
      userApproved: input.userApproved ?? true,
      useCount: existing?.useCount ?? 0,
      expiresAt: input.expiresAt === undefined ? existing?.expiresAt ?? null : input.expiresAt,
      embedding,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now
    };

    return this.repo.saveMemory(item);
  }

  public retrieveRelevant(
    query: string,
    domain?: string | null,
    limit = 5,
    profileId = 'default'
  ): MemoryItem[] {
    const all = this.repo.listMemory(undefined, profileId).filter((m) => m.userApproved);
    if (all.length === 0) return [];

    const queryTokens = new Set(tokenize(query));
    const queryVec = computeLocalEmbedding(query);
    const now = Date.now();
    const normalizedDomain = domain?.toLowerCase().trim() || '';

    const scored = all.map((item) => {
      const docText = `${item.title} ${item.content} ${item.domain || ''}`;
      const docTokens = tokenize(docText);
      let overlap = 0;
      for (const t of docTokens) {
        if (queryTokens.has(t)) overlap += 1;
      }
      const lexicalScore = queryTokens.size > 0 ? overlap / Math.sqrt(Math.max(1, docTokens.length)) : 0;
      const itemVec = item.embedding && item.embedding.length > 0 ? item.embedding : computeLocalEmbedding(docText);
      const vectorScore = cosineSimilarity(queryVec, itemVec);
      const domainBoost =
        normalizedDomain &&
        item.domain &&
        (normalizedDomain === item.domain || normalizedDomain.endsWith(`.${item.domain}`))
          ? 0.75
          : 0;
      const ageDays = Math.max(0, (now - item.lastUsedAt) / (1000 * 60 * 60 * 24));
      const recencyScore = 1 / (1 + ageDays / 14);
      const score =
        lexicalScore * 1.4 +
        vectorScore * 1.6 +
        domainBoost +
        item.confidence * 0.35 +
        recencyScore * 0.25;
      return { item, score };
    });

    const selected = scored
      .filter((s) => s.score > 0.35 || (normalizedDomain && s.item.domain === normalizedDomain))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.item);

    for (const item of selected) {
      this.repo.saveMemory({
        ...item,
        useCount: item.useCount + 1,
        lastUsedAt: now
      });
    }

    return selected;
  }

  public delete(id: string): void {
    this.repo.deleteMemory(id);
  }

  public clear(profileId?: string): void {
    this.repo.clearMemory(profileId);
  }

  public exportJson(profileId = 'default'): string {
    const items = this.repo.listMemory(undefined, profileId);
    return JSON.stringify({ exportedAt: new Date().toISOString(), profileId, items }, null, 2);
  }
}

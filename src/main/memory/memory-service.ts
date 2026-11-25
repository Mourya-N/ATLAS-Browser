import { randomUUID } from 'node:crypto';
import type { MemoryCategory, MemoryItem } from '@shared/types';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';

const SENSITIVE_MEMORY_PATTERNS: RegExp[] = [
  /password\s*[:=]\s*\S+/i,
  /cvv\s*[:=]\s*\d{3,4}/i,
  /\b(?:\d[ -]*?){13,16}\b/, // credit card numbers
  /-----BEGIN\s+(RSA|OPENSSH|EC|PGP)\s+PRIVATE\s+KEY-----/i,
  /AIza[0-9A-Za-z\-_]{20,}/,
  /sk-[0-9A-Za-z\-_]{20,}/,
  /bearer\s+(?=[0-9a-z\-._~+/]*[\d._\-+/])[0-9a-z\-._~+/]{12,}=*/i,
  /atlas_mcp_[0-9a-f]{16,}/i
];

const EMBEDDING_DIM = 64;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Deterministic local hashed n-gram + word embedding vector (normalized L2)
 * for offline semantic retrieval stored in SQLite without external API dependencies.
 */
export function computeLocalEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return vec;

  const words = tokenize(normalized);
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % EMBEDDING_DIM;
    const wSign = ((h >>> 16) & 1) === 0 ? 1 : -1;
    vec[idx] += wSign * 1.5;

    // Signed character trigrams capture morphological similarity while keeping unrelated vectors near zero
    for (let i = 0; i <= w.length - 3; i++) {
      const tri = w.slice(i, i + 3);
      let th = 2166136261;
      for (let j = 0; j < 3; j++) {
        th ^= tri.charCodeAt(j);
        th = Math.imul(th, 16777619);
      }
      const tSign = ((th >>> 16) & 1) === 0 ? 1 : -1;
      vec[Math.abs(th) % EMBEDDING_DIM] += tSign * 0.6;
    }
  }

  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] = Number((vec[i] / norm).toFixed(5));
    }
  }
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return Math.max(0, Math.min(1, dot));
}

export class MemoryService {
  constructor(private readonly repo: PlatformRepository) {}

  public containsSensitiveData(text: string): boolean {
    return SENSITIVE_MEMORY_PATTERNS.some((rx) => rx.test(text));
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

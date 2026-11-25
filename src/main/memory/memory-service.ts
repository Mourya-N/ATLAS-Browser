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
  /bearer\s+[0-9a-z\-._~+/]+=*/i
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

export class MemoryService {
  constructor(private readonly repo: PlatformRepository) {}

  public containsSensitiveData(text: string): boolean {
    return SENSITIVE_MEMORY_PATTERNS.some((rx) => rx.test(text));
  }

  public list(category?: MemoryCategory): MemoryItem[] {
    return this.repo.listMemory(category);
  }

  public save(input: {
    id?: string;
    category: MemoryCategory;
    domain?: string | null;
    title: string;
    content: string;
    confidence?: number;
    source: string;
    userApproved?: boolean;
  }): MemoryItem {
    const combined = `${input.title}\n${input.content}`;
    if (this.containsSensitiveData(combined)) {
      throw new Error(
        'Refusing to store sensitive credentials, payment details, private keys, or auth tokens in local memory'
      );
    }

    const now = Date.now();
    const existing = input.id
      ? this.repo.listMemory().find((m) => m.id === input.id)
      : undefined;

    const item: MemoryItem = {
      id: input.id ?? randomUUID(),
      category: input.category,
      domain: input.domain?.toLowerCase().trim() || null,
      title: input.title.trim(),
      content: input.content.trim(),
      confidence: Math.min(1, Math.max(0, input.confidence ?? existing?.confidence ?? 0.85)),
      source: input.source,
      userApproved: input.userApproved ?? true,
      useCount: existing?.useCount ?? 0,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now
    };

    return this.repo.saveMemory(item);
  }

  public retrieveRelevant(query: string, domain?: string | null, limit = 5): MemoryItem[] {
    const all = this.repo.listMemory().filter((m) => m.userApproved);
    if (all.length === 0) return [];

    const queryTokens = new Set(tokenize(query));
    const now = Date.now();
    const normalizedDomain = domain?.toLowerCase().trim() || '';

    const scored = all.map((item) => {
      const docTokens = tokenize(`${item.title} ${item.content} ${item.domain || ''}`);
      let overlap = 0;
      for (const t of docTokens) {
        if (queryTokens.has(t)) overlap += 1;
      }
      const lexicalScore = queryTokens.size > 0 ? overlap / Math.sqrt(Math.max(1, docTokens.length)) : 0;
      const domainBoost =
        normalizedDomain && item.domain && (normalizedDomain === item.domain || normalizedDomain.endsWith(`.${item.domain}`))
          ? 0.75
          : 0;
      const ageDays = Math.max(0, (now - item.lastUsedAt) / (1000 * 60 * 60 * 24));
      const recencyScore = 1 / (1 + ageDays / 14);
      const score = lexicalScore * 2.0 + domainBoost + item.confidence * 0.4 + recencyScore * 0.3;
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

  public clear(): void {
    this.repo.clearMemory();
  }

  public exportJson(): string {
    const items = this.repo.listMemory();
    return JSON.stringify({ exportedAt: new Date().toISOString(), items }, null, 2);
  }
}

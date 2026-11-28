import type Redis from 'ioredis';
import type { AiCitedAnswer, SearchResponse } from '@shared/types';

export class SearchCache {
  private readonly l1 = new Map<string, { value: SearchResponse; expiresAt: number }>();
  private readonly aiL1 = new Map<string, { value: AiCitedAnswer; expiresAt: number }>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly redis: Redis | null = null,
    private readonly maxL1Entries = 250
  ) {}

  public async get(key: string): Promise<SearchResponse | null> {
    const now = Date.now();
    const mem = this.l1.get(key);
    if (mem) {
      if (mem.expiresAt > now) {
        // LRU refresh: move to end
        this.l1.delete(key);
        this.l1.set(key, mem);
        this.hits += 1;
        return mem.value;
      }
      this.l1.delete(key);
    }

    if (this.redis && this.redis.status === 'ready') {
      try {
        const raw = await this.redis.get(`lavray:scache:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw) as SearchResponse;
          this.setL1(this.l1, key, parsed, 60_000);
          this.hits += 1;
          return parsed;
        }
      } catch {
        // Degrade gracefully on cache read error
      }
    }
    this.misses += 1;
    return null;
  }

  public async set(key: string, value: SearchResponse, ttlSeconds = 180): Promise<void> {
    this.setL1(this.l1, key, value, ttlSeconds * 1000);
    if (this.redis && this.redis.status === 'ready') {
      try {
        await this.redis.setex(`lavray:scache:${key}`, ttlSeconds, JSON.stringify(value));
      } catch {
        // Non-fatal
      }
    }
  }

  public async getAiAnswer(key: string): Promise<AiCitedAnswer | null> {
    const now = Date.now();
    const mem = this.aiL1.get(key);
    if (mem) {
      if (mem.expiresAt > now) {
        this.aiL1.delete(key);
        this.aiL1.set(key, mem);
        return mem.value;
      }
      this.aiL1.delete(key);
    }
    if (this.redis && this.redis.status === 'ready') {
      try {
        const raw = await this.redis.get(`lavray:aicache:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw) as AiCitedAnswer;
          this.setL1(this.aiL1, key, parsed, 120_000);
          return parsed;
        }
      } catch {
        // Non-fatal
      }
    }
    return null;
  }

  public async setAiAnswer(key: string, value: AiCitedAnswer, ttlSeconds = 300): Promise<void> {
    if (value.status !== 'ok') return;
    this.setL1(this.aiL1, key, value, ttlSeconds * 1000);
    if (this.redis && this.redis.status === 'ready') {
      try {
        await this.redis.setex(`lavray:aicache:${key}`, ttlSeconds, JSON.stringify(value));
      } catch {
        // Non-fatal
      }
    }
  }

  public getStats(): { hits: number; misses: number; resultEntries: number; aiEntries: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      resultEntries: this.l1.size,
      aiEntries: this.aiL1.size
    };
  }

  private setL1<T>(map: Map<string, { value: T; expiresAt: number }>, key: string, value: T, ttlMs: number): void {
    if (map.has(key)) map.delete(key);
    else if (map.size >= this.maxL1Entries) {
      const oldestKey = map.keys().next().value;
      if (oldestKey) map.delete(oldestKey);
    }
    map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

import type Redis from 'ioredis';
import type { SearchResponse } from '@shared/types';

export class SearchCache {
  private readonly l1 = new Map<string, { value: SearchResponse; expiresAt: number }>();

  constructor(
    private readonly redis: Redis | null = null,
    private readonly maxL1Entries = 200
  ) {}

  public async get(key: string): Promise<SearchResponse | null> {
    const now = Date.now();
    const mem = this.l1.get(key);
    if (mem) {
      if (mem.expiresAt > now) {
        return mem.value;
      }
      this.l1.delete(key);
    }

    if (this.redis && this.redis.status === 'ready') {
      try {
        const raw = await this.redis.get(`atlas:scache:${key}`);
        if (raw) {
          const parsed = JSON.parse(raw) as SearchResponse;
          this.setL1(key, parsed, 60_000);
          return parsed;
        }
      } catch {
        // Degrade gracefully on cache read error
      }
    }
    return null;
  }

  public async set(key: string, value: SearchResponse, ttlSeconds = 180): Promise<void> {
    this.setL1(key, value, ttlSeconds * 1000);
    if (this.redis && this.redis.status === 'ready') {
      try {
        await this.redis.setex(`atlas:scache:${key}`, ttlSeconds, JSON.stringify(value));
      } catch {
        // Non-fatal
      }
    }
  }

  private setL1(key: string, value: SearchResponse, ttlMs: number): void {
    if (this.l1.size >= this.maxL1Entries) {
      const oldestKey = this.l1.keys().next().value;
      if (oldestKey) this.l1.delete(oldestKey);
    }
    this.l1.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

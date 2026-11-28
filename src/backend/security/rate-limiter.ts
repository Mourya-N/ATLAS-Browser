import type Redis from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
}

export class RateLimiter {
  private readonly memoryBuckets = new Map<string, number[]>();

  constructor(private readonly redis: Redis | null = null) {}

  public async consume(key: string, limit: number, windowMs = 60_000): Promise<RateLimitResult> {
    const now = Date.now();
    if (this.redis && this.redis.status === 'ready') {
      const redisKey = `lavray:rl:${key}:${Math.floor(now / windowMs)}`;
      const count = await this.redis.incr(redisKey);
      if (count === 1) {
        await this.redis.pexpire(redisKey, windowMs);
      }
      const windowEnd = (Math.floor(now / windowMs) + 1) * windowMs;
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        resetAtMs: windowEnd
      };
    }

    const cutoff = now - windowMs;
    const list = (this.memoryBuckets.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= limit) {
      this.memoryBuckets.set(key, list);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAtMs: list[0] + windowMs
      };
    }
    list.push(now);
    this.memoryBuckets.set(key, list);
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - list.length),
      resetAtMs: now + windowMs
    };
  }
}

import { randomBytes } from 'node:crypto';

export interface BackendConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string | null;
  redisUrl: string | null;
  jwtSecret: string;
  jwtAccessTtlSeconds: number;
  jwtRefreshTtlSeconds: number;
  aiProvider: 'self_hosted';
  selfHostedUrl: string | null;
  selfHostedModel: string;
  selfHostedApiKey: string | null;
  defaultAiModel: string;
  braveSearchApiKey: string | null;
  googleCseApiKey: string | null;
  googleCseCx: string | null;
  bingSearchApiKey: string | null;
  allowMockSearch: boolean;
  allowMockAi: boolean;
  rateLimitPerMinute: number;
  searchRateLimitPerMinute: number;
  fetchTimeoutMs: number;
  maxFetchBytes: number;
  searchCacheTtlSeconds: number;
  workerPollIntervalMs: number;
  corsAllowedOrigins: string[];
}

export function loadBackendConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const nodeEnv =
    env.NODE_ENV === 'production'
      ? 'production'
      : env.NODE_ENV === 'test'
        ? 'test'
        : 'development';

  const jwtSecret =
    env.LAVRAY_JWT_SECRET?.trim() ||
    (nodeEnv === 'production'
      ? (() => {
          throw new Error('LAVRAY_JWT_SECRET must be explicitly set in production');
        })()
      : env.NODE_ENV === 'test'
        ? 'lavray-test-jwt-secret-key-do-not-use-in-prod-32bytes'
        : randomBytes(32).toString('hex'));

  // Never silently enable mock search/AI in production
  const allowMockSearch = nodeEnv !== 'production' && env.LAVRAY_ALLOW_MOCK_SEARCH === 'true';
  const allowMockAi = nodeEnv !== 'production' && env.LAVRAY_ALLOW_MOCK_AI === 'true';

  const corsRaw = env.LAVRAY_CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,file://';

  return {
    nodeEnv,
    port: Number(env.LAVRAY_BACKEND_PORT || env.PORT || 48080),
    host: env.LAVRAY_BACKEND_HOST || '0.0.0.0',
    databaseUrl: env.DATABASE_URL?.trim() || null,
    redisUrl: env.REDIS_URL?.trim() || null,
    jwtSecret,
    jwtAccessTtlSeconds: Number(env.LAVRAY_JWT_ACCESS_TTL || 900),
    jwtRefreshTtlSeconds: Number(env.LAVRAY_JWT_REFRESH_TTL || 60 * 60 * 24 * 14),
    aiProvider: 'self_hosted',
    selfHostedUrl: env.LAVRAY_SELF_HOSTED_URL?.trim() || null,
    selfHostedModel: env.LAVRAY_SELF_HOSTED_MODEL?.trim() || 'qwen2.5:3b',
    selfHostedApiKey: env.LAVRAY_SELF_HOSTED_API_KEY?.trim() || null,
    defaultAiModel: env.LAVRAY_AI_MODEL || env.LAVRAY_SELF_HOSTED_MODEL?.trim() || 'qwen2.5:3b',
    braveSearchApiKey: env.BRAVE_SEARCH_API_KEY?.trim() || null,
    googleCseApiKey: env.GOOGLE_CSE_API_KEY?.trim() || null,
    googleCseCx: env.GOOGLE_CSE_CX?.trim() || null,
    bingSearchApiKey: env.BING_SEARCH_API_KEY?.trim() || null,
    allowMockSearch,
    allowMockAi,
    rateLimitPerMinute: Number(env.LAVRAY_RATE_LIMIT_PER_MIN || 120),
    searchRateLimitPerMinute: Number(env.LAVRAY_SEARCH_RATE_LIMIT_PER_MIN || 40),
    fetchTimeoutMs: Number(env.LAVRAY_FETCH_TIMEOUT_MS || 8000),
    maxFetchBytes: Number(env.LAVRAY_MAX_FETCH_BYTES || 2 * 1024 * 1024),
    searchCacheTtlSeconds: Number(env.LAVRAY_SEARCH_CACHE_TTL || 180),
    workerPollIntervalMs: Number(env.LAVRAY_WORKER_POLL_MS || 2000),
    corsAllowedOrigins: corsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  };
}

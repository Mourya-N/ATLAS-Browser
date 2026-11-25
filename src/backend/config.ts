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
  aiProvider: 'gemini' | 'self_hosted';
  geminiApiKey: string | null;
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
    env.ATLAS_JWT_SECRET?.trim() ||
    (nodeEnv === 'production'
      ? (() => {
          throw new Error('ATLAS_JWT_SECRET must be explicitly set in production');
        })()
      : env.NODE_ENV === 'test'
        ? 'atlas-test-jwt-secret-key-do-not-use-in-prod-32bytes'
        : randomBytes(32).toString('hex'));

  // Never silently enable mock search/AI in production
  const allowMockSearch = nodeEnv !== 'production' && env.ATLAS_ALLOW_MOCK_SEARCH === 'true';
  const allowMockAi = nodeEnv !== 'production' && env.ATLAS_ALLOW_MOCK_AI === 'true';

  const corsRaw = env.ATLAS_CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,file://';

  return {
    nodeEnv,
    port: Number(env.ATLAS_BACKEND_PORT || env.PORT || 48080),
    host: env.ATLAS_BACKEND_HOST || '0.0.0.0',
    databaseUrl: env.DATABASE_URL?.trim() || null,
    redisUrl: env.REDIS_URL?.trim() || null,
    jwtSecret,
    jwtAccessTtlSeconds: Number(env.ATLAS_JWT_ACCESS_TTL || 900),
    jwtRefreshTtlSeconds: Number(env.ATLAS_JWT_REFRESH_TTL || 60 * 60 * 24 * 14),
    aiProvider: env.ATLAS_AI_PROVIDER === 'self_hosted' ? 'self_hosted' : 'gemini',
    geminiApiKey: env.GEMINI_API_KEY?.trim() || null,
    selfHostedUrl: env.ATLAS_SELF_HOSTED_URL?.trim() || null,
    selfHostedModel: env.ATLAS_SELF_HOSTED_MODEL?.trim() || 'qwen2.5:7b-instruct',
    selfHostedApiKey: env.ATLAS_SELF_HOSTED_API_KEY?.trim() || null,
    defaultAiModel: env.ATLAS_AI_MODEL || 'gemini-2.5-flash',
    braveSearchApiKey: env.BRAVE_SEARCH_API_KEY?.trim() || null,
    googleCseApiKey: env.GOOGLE_CSE_API_KEY?.trim() || null,
    googleCseCx: env.GOOGLE_CSE_CX?.trim() || null,
    bingSearchApiKey: env.BING_SEARCH_API_KEY?.trim() || null,
    allowMockSearch,
    allowMockAi,
    rateLimitPerMinute: Number(env.ATLAS_RATE_LIMIT_PER_MIN || 120),
    searchRateLimitPerMinute: Number(env.ATLAS_SEARCH_RATE_LIMIT_PER_MIN || 40),
    fetchTimeoutMs: Number(env.ATLAS_FETCH_TIMEOUT_MS || 8000),
    maxFetchBytes: Number(env.ATLAS_MAX_FETCH_BYTES || 2 * 1024 * 1024),
    searchCacheTtlSeconds: Number(env.ATLAS_SEARCH_CACHE_TTL || 180),
    workerPollIntervalMs: Number(env.ATLAS_WORKER_POLL_MS || 2000),
    corsAllowedOrigins: corsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  };
}

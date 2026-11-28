import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

function resolveBackendMigrationsDir(): string {
  const candidates = [
    path.resolve(__dirname, './db/migrations'),
    path.resolve(__dirname, '../db/migrations'),
    path.resolve(process.cwd(), 'dist/backend/db/migrations'),
    path.resolve(process.cwd(), 'src/backend/db/migrations')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}
import Redis from 'ioredis';
import type { ModelProvider } from '@main/agent/providers/model-provider';
import { loadBackendConfig, type BackendConfig } from './config';
import { InMemoryCloudRepository } from './db/memory-repository';
import { PostgresCloudRepository, runPostgresMigrations } from './db/postgres-repository';
import type { CloudRepository } from './db/repository';
import { BackendLogger } from './observability/logger';
import { MetricsRegistry } from './observability/metrics';
import { RateLimiter } from './security/rate-limiter';
import { EmailDeliveryService } from './modules/identity/email-delivery';
import { SsrfGuard } from './security/ssrf-guard';
import { IdentityService } from './modules/identity/identity-service';
import { AiOrchestrator } from './modules/ai/ai-orchestrator';
import { ResearchExtractorService } from './modules/research/research-extractor';
import { HybridIndexService } from './modules/knowledge/hybrid-index-service';
import { UserDataService } from './modules/userdata/user-data-service';
import {
  LavrayKnowledgeSearchAdapter,
  BingSearchAdapter,
  BraveSearchAdapter,
  GoogleCseSearchAdapter,
  MockSearchProvider
} from './modules/search/adapters';
import type { SearchProvider } from './modules/search/provider';
import { SearchCache } from './modules/search/cache';
import { CitationAnswerPipeline } from './modules/search/citation-pipeline';
import { FirstPartyIndexProvider } from './modules/search/first-party-index-provider';
import { QueryUnderstandingEngine } from './modules/search/query-understanding';
import { SearchOrchestrator } from './modules/search/search-orchestrator';
import { LavrayCrawler } from './modules/crawler/lavray-crawler';
import { WorkerService } from './modules/worker/worker-service';
import type { BackendServicesContainer } from './api/router';

export async function createBackendContainer(opts?: {
  config?: BackendConfig;
  repo?: CloudRepository;
  searchProviders?: SearchProvider[];
  aiOverrideProvider?: ModelProvider;
}): Promise<{ services: BackendServicesContainer; redis: Redis | null }> {
  const config = opts?.config ?? loadBackendConfig();
  const logger = new BackendLogger('lavray-cloud-backend');
  const metrics = new MetricsRegistry();

  let repo: CloudRepository;
  if (opts?.repo) {
    repo = opts.repo;
  } else if (config.databaseUrl) {
    const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
    const migrationsDir = resolveBackendMigrationsDir();
    await runPostgresMigrations(pool, migrationsDir);
    repo = new PostgresCloudRepository(pool);
  } else if (config.nodeEnv === 'production') {
    throw new Error(
      'DATABASE_URL is required in production mode; refusing silent fallback to InMemoryCloudRepository.'
    );
  } else {
    repo = new InMemoryCloudRepository();
  }

  let redis: Redis | null = null;
  if (config.redisUrl) {
    redis = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false
    });
    try {
      await redis.connect();
    } catch (err) {
      if (config.nodeEnv === 'production') {
        throw new Error(
          `Failed to connect to required REDIS_URL in production: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      logger.log('warn', 'Redis connection failed; falling back to in-memory cache/rate-limiter', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const emailDelivery = new EmailDeliveryService({
    provider: config.emailProvider,
    from: config.emailFrom,
    resendApiKey: config.resendApiKey,
    webhookUrl: config.emailWebhookUrl,
    webhookBearer: config.emailWebhookBearer
  });
  if (config.nodeEnv === 'production' && !emailDelivery.isConfigured()) {
    throw new Error(
      'LAVRAY_EMAIL_PROVIDER (resend or webhook) and provider credentials are required in production mode.'
    );
  }

  const rateLimiter = new RateLimiter(redis);
  const ssrfGuard = new SsrfGuard();
  const identity = new IdentityService(repo, config, emailDelivery);
  const ai = new AiOrchestrator(config, metrics, opts?.aiOverrideProvider);
  const extractor = new ResearchExtractorService(ssrfGuard);
  const hybridIndex = new HybridIndexService(repo);
  const userData = new UserDataService(repo, hybridIndex);
  const knowledgeAdapter = new LavrayKnowledgeSearchAdapter(hybridIndex);
  const firstPartyIndex = new FirstPartyIndexProvider(repo);
  const crawler = new LavrayCrawler(repo, ssrfGuard, extractor);

  const searchProviders: SearchProvider[] = opts?.searchProviders
    ? [firstPartyIndex, ...opts.searchProviders]
    : [
        firstPartyIndex,
        new BraveSearchAdapter(config.braveSearchApiKey),
        new GoogleCseSearchAdapter(config.googleCseApiKey, config.googleCseCx),
        new BingSearchAdapter(config.bingSearchApiKey),
        ...(config.allowMockSearch ? [new MockSearchProvider()] : [])
      ];

  const cache = new SearchCache(redis);
  const queryUnderstanding = new QueryUnderstandingEngine(ai);
  const citationPipeline = new CitationAnswerPipeline(ai, extractor);
  const search = new SearchOrchestrator(
    searchProviders,
    knowledgeAdapter,
    queryUnderstanding,
    citationPipeline,
    cache,
    userData,
    metrics,
    config.searchCacheTtlSeconds,
    firstPartyIndex,
    () => ai.getRuntimeStatus()
  );
  const worker = new WorkerService(repo, extractor, hybridIndex, logger);

  const services: BackendServicesContainer = {
    config,
    repo,
    logger,
    metrics,
    isRedisReady: () => Boolean(redis && redis.status === 'ready'),
    rateLimiter,
    identity,
    ai,
    search,
    firstPartyIndex,
    crawler,
    extractor,
    hybridIndex,
    userData,
    worker
  };

  return { services, redis };
}

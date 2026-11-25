import http from 'node:http';
import path from 'node:path';
import { Pool } from 'pg';
import Redis from 'ioredis';
import type { ModelProvider } from '@main/agent/providers/model-provider';
import { loadBackendConfig, type BackendConfig } from '../config';
import { InMemoryCloudRepository } from '../db/memory-repository';
import { PostgresCloudRepository, runPostgresMigrations } from '../db/postgres-repository';
import type { CloudRepository } from '../db/repository';
import { BackendLogger } from '../observability/logger';
import { MetricsRegistry } from '../observability/metrics';
import { RateLimiter } from '../security/rate-limiter';
import { SsrfGuard } from '../security/ssrf-guard';
import { IdentityService } from '../modules/identity/identity-service';
import { AiOrchestrator } from '../modules/ai/ai-orchestrator';
import { ResearchExtractorService } from '../modules/research/research-extractor';
import { HybridIndexService } from '../modules/knowledge/hybrid-index-service';
import { UserDataService } from '../modules/userdata/user-data-service';
import {
  AtlasKnowledgeSearchAdapter,
  BingSearchAdapter,
  BraveSearchAdapter,
  GoogleCseSearchAdapter,
  MockSearchProvider
} from '../modules/search/adapters';
import type { SearchProvider } from '../modules/search/provider';
import { SearchCache } from '../modules/search/cache';
import { CitationAnswerPipeline } from '../modules/search/citation-pipeline';
import { FirstPartyIndexProvider } from '../modules/search/first-party-index-provider';
import { QueryUnderstandingEngine } from '../modules/search/query-understanding';
import { SearchOrchestrator } from '../modules/search/search-orchestrator';
import { AtlasCrawler } from '../modules/crawler/atlas-crawler';
import { WorkerService } from '../modules/worker/worker-service';
import { createCloudApiRouter, type BackendServicesContainer } from './router';

export interface BackendRuntime {
  server: http.Server;
  port: number;
  services: BackendServicesContainer;
  redis: Redis | null;
  stop: () => Promise<void>;
}

export async function createBackendContainer(opts?: {
  config?: BackendConfig;
  repo?: CloudRepository;
  searchProviders?: SearchProvider[];
  aiOverrideProvider?: ModelProvider;
}): Promise<{ services: BackendServicesContainer; redis: Redis | null }> {
  const config = opts?.config ?? loadBackendConfig();
  const logger = new BackendLogger('atlas-cloud-backend');
  const metrics = new MetricsRegistry();

  let repo: CloudRepository;
  if (opts?.repo) {
    repo = opts.repo;
  } else if (config.databaseUrl) {
    const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
    const migrationsDir = path.resolve(__dirname, '../db/migrations');
    await runPostgresMigrations(pool, migrationsDir);
    repo = new PostgresCloudRepository(pool);
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
      logger.log('warn', 'Redis connection failed; falling back to in-memory cache/rate-limiter', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const rateLimiter = new RateLimiter(redis);
  const ssrfGuard = new SsrfGuard();
  const identity = new IdentityService(repo, config);
  const ai = new AiOrchestrator(config, metrics, opts?.aiOverrideProvider);
  const extractor = new ResearchExtractorService(ssrfGuard);
  const hybridIndex = new HybridIndexService(repo);
  const userData = new UserDataService(repo, hybridIndex);
  const knowledgeAdapter = new AtlasKnowledgeSearchAdapter(hybridIndex);
  const firstPartyIndex = new FirstPartyIndexProvider(repo);
  const crawler = new AtlasCrawler(repo, ssrfGuard, extractor);

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

export async function startCloudServer(opts?: {
  config?: BackendConfig;
  repo?: CloudRepository;
  searchProviders?: SearchProvider[];
  aiOverrideProvider?: ModelProvider;
  startInlineWorker?: boolean;
}): Promise<BackendRuntime> {
  const { services, redis } = await createBackendContainer(opts);
  const handler = createCloudApiRouter(services);
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(services.config.port, services.config.host, () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : services.config.port;

  if (opts?.startInlineWorker) {
    services.worker.startLoop(services.config.workerPollIntervalMs);
  }

  services.logger.log('info', 'Atlas Cloud Backend listening', {
    host: services.config.host,
    port,
    storageMode: services.repo.mode
  });

  return {
    server,
    port,
    services,
    redis,
    stop: async () => {
      services.worker.stopLoop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (redis) {
        try {
          await redis.quit();
        } catch {
          redis.disconnect();
        }
      }
      await services.repo.close();
    }
  };
}

if (require.main === module) {
  const inlineWorker = process.env.ATLAS_INLINE_WORKER !== 'false';
  void startCloudServer({ startInlineWorker: inlineWorker }).then((runtime) => {
    const shutdown = async () => {
      await runtime.stop();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });
}

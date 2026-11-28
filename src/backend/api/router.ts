import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CloudAuthSchema, SearchExecuteSchema } from '@shared/ipc-channels';
import { SsrfBlockedError } from '../security/ssrf-guard';
import type { BackendConfig } from '../config';
import type { CloudRepository } from '../db/repository';
import type { BackendLogger } from '../observability/logger';
import type { MetricsRegistry } from '../observability/metrics';
import type { RateLimiter } from '../security/rate-limiter';
import { AuthError, IdentityService } from '../modules/identity/identity-service';
import type { AiOrchestrator } from '../modules/ai/ai-orchestrator';
import type { HybridIndexService } from '../modules/knowledge/hybrid-index-service';
import type { ResearchExtractorService } from '../modules/research/research-extractor';
import type { SearchOrchestrator } from '../modules/search/search-orchestrator';
import type { FirstPartyIndexProvider } from '../modules/search/first-party-index-provider';
import type { LavrayCrawler } from '../modules/crawler/lavray-crawler';
import { ConsentRequiredError, type UserDataService } from '../modules/userdata/user-data-service';
import type { WorkerService } from '../modules/worker/worker-service';

export interface BackendServicesContainer {
  config: BackendConfig;
  repo: CloudRepository;
  logger: BackendLogger;
  metrics: MetricsRegistry;
  isRedisReady?: () => boolean;
  rateLimiter: RateLimiter;
  identity: IdentityService;
  ai: AiOrchestrator;
  search: SearchOrchestrator;
  firstPartyIndex: FirstPartyIndexProvider;
  crawler: LavrayCrawler;
  extractor: ResearchExtractorService;
  hybridIndex: HybridIndexService;
  userData: UserDataService;
  worker: WorkerService;
}

const ConsentPatchSchema = z.object({
  syncProfile: z.boolean().optional(),
  syncBookmarks: z.boolean().optional(),
  syncNotes: z.boolean().optional(),
  syncSearchHistory: z.boolean().optional(),
  syncResearch: z.boolean().optional(),
  syncMemory: z.boolean().optional(),
  syncSkills: z.boolean().optional(),
  allowCloudSearch: z.boolean().optional(),
  allowCloudAi: z.boolean().optional()
});

const BookmarkInputSchema = z.object({
  id: z.string().max(128).optional(),
  url: z.string().url().max(4096),
  title: z.string().min(1).max(500),
  folderName: z.string().max(200).nullable().optional(),
  isPrivate: z.boolean().optional()
});

const NoteInputSchema = z.object({
  id: z.string().max(128).optional(),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(50_000),
  sourceUrl: z.string().max(4096).nullable().optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
  isPrivate: z.boolean().optional()
});

const ExtractUrlSchema = z.object({
  url: z.string().min(1).max(4096),
  allowLocalhostForTest: z.boolean().optional()
});

const JobEnqueueSchema = z.object({
  type: z.enum(['research_job', 'page_extract', 'reindex_knowledge', 'embedding_backfill']),
  payload: z.record(z.string(), z.unknown()).default({})
});

export function createCloudApiRouter(services: BackendServicesContainer) {
  const {
    config,
    repo,
    logger,
    metrics,
    isRedisReady,
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
  } = services;

  async function readJsonBody(req: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        throw new AuthError('Request payload exceeds maximum limit', 413);
      }
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new AuthError('Invalid JSON request body', 400);
    }
  }

  function sendJson(
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    requestId: string,
    extraHeaders: Record<string, string> = {}
  ): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Lavray-API-Version', 'v1');
    for (const [k, v] of Object.entries(extraHeaders)) {
      res.setHeader(k, v);
    }
    res.end(JSON.stringify(payload));
  }

  function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin;
    if (origin && config.corsAllowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
  }

  function requireAuth(req: http.IncomingMessage) {
    const claims = identity.verifyAccessToken(req.headers.authorization);
    if (!claims) {
      throw new AuthError('Authentication required or token expired', 401);
    }
    return claims;
  }

  return async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const started = Date.now();
    const requestId = (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) || randomUUID();
    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('X-Request-Id', requestId);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    try {
      // Rate limit per IP / path bucket
      const clientKey = req.socket.remoteAddress || 'unknown';
      const isSearchRoute = pathname.startsWith('/api/v1/search');
      const rl = await rateLimiter.consume(
        `${clientKey}:${isSearchRoute ? 'search' : 'api'}`,
        isSearchRoute ? config.searchRateLimitPerMinute : config.rateLimitPerMinute
      );
      res.setHeader('X-RateLimit-Limit', String(rl.limit));
      res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
      if (!rl.allowed) {
        sendJson(res, 429, { error: 'Rate limit exceeded', requestId }, requestId);
        return;
      }

      // Health, AI Runtime Status & Observability
      if (method === 'GET' && (pathname === '/health' || pathname === '/api/v1/health')) {
        const dbOk = await repo.ping();
        const providers = await search.getProviderHealth();
        const aiRuntime = await ai.getRuntimeStatus();
        const indexStats = await firstPartyIndex.getStats();
        sendJson(
          res,
          dbOk ? 200 : 503,
          {
            ok: dbOk,
            service: 'lavray-cloud-backend',
            version: 'v1',
            storageMode: repo.mode,
            aiConfigured: ai.isConfigured(),
            aiRuntime,
            indexStats,
            providers
          },
          requestId
        );
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/ai/status') {
        const runtime = await ai.getRuntimeStatus();
        sendJson(res, 200, runtime, requestId);
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/index/stats') {
        const stats = await firstPartyIndex.getStats();
        const checkpoints = await repo.listCrawlCheckpoints(5);
        sendJson(res, 200, { stats, recentCrawls: checkpoints }, requestId);
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/index/crawl') {
        requireAuth(req);
        const body = z
          .object({
            seedUrls: z.array(z.string().url().max(4096)).min(1).max(20),
            allowedDomains: z.array(z.string().min(1).max(255)).min(1).max(20),
            maxDepth: z.number().int().min(0).max(4).optional(),
            maxPages: z.number().int().min(1).max(200).optional(),
            perDomainDelayMs: z.number().int().min(0).max(5000).optional(),
            respectRobotsTxt: z.boolean().optional(),
            allowLocalhostForTest: z.boolean().optional()
          })
          .parse(await readJsonBody(req));

        const cp = await crawler.startCrawl({
          ...body,
          allowLocalhostForTest: config.nodeEnv !== 'production' ? body.allowLocalhostForTest : false
        });
        sendJson(res, 200, { checkpoint: cp }, requestId);
        return;
      }

      if (method === 'DELETE' && pathname === '/api/v1/index/documents') {
        requireAuth(req);
        const body = z.object({ canonicalUrl: z.string().min(1).max(4096) }).parse(await readJsonBody(req));
        const removed = await firstPartyIndex.removeDocument(body.canonicalUrl);
        sendJson(res, 200, { removed }, requestId);
        return;
      }

      if (method === 'GET' && pathname === '/metrics') {
        const providers = await search.getProviderHealth();
        const workerStats = await repo.getJobStats();
        const indexStats = await firstPartyIndex.getStats();
        const snap = metrics.snapshot({
          service: 'lavray-cloud-backend',
          providers,
          worker: workerStats,
          storage: {
            postgresConnected: repo.mode === 'postgres' ? await repo.ping() : false,
            redisConnected: isRedisReady ? isRedisReady() : false,
            mode: repo.mode
          },
          crawler: {
            indexedDocuments: indexStats.totalDocuments,
            crawlErrors: 0,
            duplicateRate: 0,
            crawlThroughputPerMin: 0
          }
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; version=0.0.4');
        res.setHeader('X-Request-Id', requestId);
        res.end(metrics.toPrometheusText(snap));
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/observability/metrics') {
        const providers = await search.getProviderHealth();
        const workerStats = await repo.getJobStats();
        const indexStats = await firstPartyIndex.getStats();
        const snap = metrics.snapshot({
          service: 'lavray-cloud-backend',
          providers,
          worker: workerStats,
          storage: {
            postgresConnected: repo.mode === 'postgres' ? await repo.ping() : false,
            redisConnected: isRedisReady ? isRedisReady() : false,
            mode: repo.mode
          },
          crawler: {
            indexedDocuments: indexStats.totalDocuments,
            crawlErrors: 0,
            duplicateRate: 0,
            crawlThroughputPerMin: 0
          }
        });
        sendJson(res, 200, snap, requestId);
        return;
      }

      // Identity & Profile Routes
      if (method === 'POST' && pathname === '/api/v1/auth/register') {
        const body = CloudAuthSchema.extend({
          deviceName: z.string().max(120).optional(),
          platform: z.string().max(64).optional(),
          appVersion: z.string().max(32).optional()
        }).parse(await readJsonBody(req));
        const session = await identity.register(body);
        sendJson(res, 201, session, requestId);
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/auth/login') {
        const body = CloudAuthSchema.extend({
          deviceName: z.string().max(120).optional(),
          platform: z.string().max(64).optional(),
          appVersion: z.string().max(32).optional()
        }).parse(await readJsonBody(req));
        const session = await identity.login(body);
        sendJson(res, 200, session, requestId);
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/auth/refresh') {
        const body = z.object({ refreshToken: z.string().min(10) }).parse(await readJsonBody(req));
        const session = await identity.refresh(body.refreshToken);
        sendJson(res, 200, session, requestId);
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/auth/logout') {
        const body = z.object({ refreshToken: z.string().optional() }).parse(await readJsonBody(req));
        await identity.logout(body.refreshToken);
        sendJson(res, 200, { ok: true }, requestId);
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/profile') {
        const claims = requireAuth(req);
        const profile = await identity.getProfile(claims.sub, claims.profileId);
        sendJson(res, 200, { profile }, requestId);
        return;
      }

      if (method === 'PUT' && pathname === '/api/v1/profile/consent') {
        const claims = requireAuth(req);
        const body = ConsentPatchSchema.parse(await readJsonBody(req));
        const profile = await identity.updateConsent(claims.sub, claims.profileId, body);
        sendJson(res, 200, { profile }, requestId);
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/account/export') {
        const claims = requireAuth(req);
        const data = await identity.exportUserData(claims.sub);
        sendJson(res, 200, data, requestId);
        return;
      }

      if (method === 'DELETE' && pathname === '/api/v1/account') {
        const claims = requireAuth(req);
        await identity.deleteAccount(claims.sub);
        sendJson(res, 200, { deleted: true }, requestId);
        return;
      }

      // Search Orchestration Routes: GET /api/v1/search?q=... & POST /api/v1/search
      if (method === 'GET' && pathname === '/api/v1/search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) {
          sendJson(res, 400, { error: 'Query parameter "q" is required', requestId }, requestId);
          return;
        }
        const category = url.searchParams.get('category') || url.searchParams.get('mode') || undefined;
        const page = Number(url.searchParams.get('page') || 1);
        const limit = Number(url.searchParams.get('limit') || 10);
        const safeSearchRaw = url.searchParams.get('safeSearch') || 'moderate';
        const freshnessRaw = url.searchParams.get('freshness') || 'any';
        const lang = url.searchParams.get('lang') || undefined;
        const region = url.searchParams.get('region') || undefined;
        const includeAiAnswer = url.searchParams.get('ai') !== 'false';

        const validated = SearchExecuteSchema.parse({
          query: q,
          mode: category,
          filters: {
            page: Number.isFinite(page) ? page : 1,
            limit: Number.isFinite(limit) ? limit : 10,
            safeSearch: safeSearchRaw,
            timeRange: freshnessRaw,
            language: lang,
            region,
            includeAiAnswer
          }
        });
        const claims = identity.verifyAccessToken(req.headers.authorization);
        const result = await search.executeSearch({
          query: validated.query,
          mode: validated.mode,
          filters: validated.filters,
          userId: claims?.sub ?? null,
          profileId: claims?.profileId ?? null,
          allowLocalhostForTest:
            config.nodeEnv !== 'production' && url.searchParams.get('allowLocalhost') === 'true'
        });
        sendJson(res, 200, result, requestId);
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/search') {
        const raw = await readJsonBody(req);
        const parsed = SearchExecuteSchema.extend({
          authorizedTabs: z
            .array(
              z.object({
                tabId: z.string().max(128),
                url: z.string().max(4096),
                title: z.string().max(500),
                text: z.string().max(50_000),
                isPrivate: z.boolean()
              })
            )
            .max(15)
            .optional(),
          isPrivateSession: z.boolean().optional(),
          fetchFullPagesForCitations: z.boolean().optional(),
          allowLocalhostForTest: z.boolean().optional()
        }).parse(raw);

        const claims = identity.verifyAccessToken(req.headers.authorization);
        const result = await search.executeSearch({
          query: parsed.query,
          mode: parsed.mode,
          filters: parsed.filters,
          userId: claims?.sub ?? null,
          profileId: claims?.profileId ?? null,
          isPrivateSession: parsed.isPrivateSession,
          authorizedTabs: parsed.authorizedTabs,
          fetchFullPagesForCitations: parsed.fetchFullPagesForCitations,
          allowLocalhostForTest:
            config.nodeEnv !== 'production' ? parsed.allowLocalhostForTest : false
        });
        sendJson(res, 200, result, requestId);
        return;
      }

      // Research / Extraction Route (SSRF-hardened)
      if (method === 'POST' && pathname === '/api/v1/research/extract') {
        requireAuth(req);
        const body = ExtractUrlSchema.parse(await readJsonBody(req));
        const extracted = await extractor.fetchAndExtract(body.url, {
          timeoutMs: config.fetchTimeoutMs,
          maxBytes: config.maxFetchBytes,
          allowLocalhostForTest: config.nodeEnv !== 'production' ? body.allowLocalhostForTest : false
        });
        sendJson(res, 200, extracted, requestId);
        return;
      }

      // User Data Sync Routes (strict consent + auth enforced)
      if (method === 'GET' && pathname === '/api/v1/userdata/bookmarks') {
        const claims = requireAuth(req);
        const items = await userData.listBookmarks(claims.sub, claims.profileId);
        sendJson(res, 200, { bookmarks: items }, requestId);
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/userdata/bookmarks') {
        const claims = requireAuth(req);
        const body = BookmarkInputSchema.parse(await readJsonBody(req));
        const saved = await userData.saveBookmark({
          ...body,
          userId: claims.sub,
          profileId: claims.profileId
        });
        sendJson(res, 201, { bookmark: saved }, requestId);
        return;
      }

      if (method === 'DELETE' && pathname.startsWith('/api/v1/userdata/bookmarks/')) {
        const claims = requireAuth(req);
        const id = decodeURIComponent(pathname.slice('/api/v1/userdata/bookmarks/'.length));
        await userData.deleteBookmark(claims.sub, claims.profileId, id);
        sendJson(res, 200, { deleted: true }, requestId);
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/userdata/notes') {
        const claims = requireAuth(req);
        const notes = await userData.listNotes(claims.sub, claims.profileId);
        sendJson(res, 200, { notes }, requestId);
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/userdata/notes') {
        const claims = requireAuth(req);
        const body = NoteInputSchema.parse(await readJsonBody(req));
        const note = await userData.saveNote({
          ...body,
          userId: claims.sub,
          profileId: claims.profileId
        });
        sendJson(res, 201, { note }, requestId);
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/userdata/search-history') {
        const claims = requireAuth(req);
        const history = await userData.listSearchHistory(claims.sub, claims.profileId);
        sendJson(res, 200, { history }, requestId);
        return;
      }

      if (method === 'DELETE' && pathname === '/api/v1/userdata/search-history') {
        const claims = requireAuth(req);
        await userData.clearSearchHistory(claims.sub, claims.profileId);
        sendJson(res, 200, { cleared: true }, requestId);
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/knowledge/search') {
        const claims = requireAuth(req);
        const body = z
          .object({
            query: z.string().min(1).max(1000),
            limit: z.number().int().min(1).max(30).optional()
          })
          .parse(await readJsonBody(req));
        const hits = await hybridIndex.search({
          userId: claims.sub,
          profileId: claims.profileId,
          query: body.query,
          limit: body.limit ?? 10
        });
        sendJson(res, 200, { hits }, requestId);
        return;
      }

      // Background Worker Jobs
      if (method === 'POST' && pathname === '/api/v1/jobs') {
        const claims = requireAuth(req);
        const body = JobEnqueueSchema.parse(await readJsonBody(req));
        const job = await worker.enqueue({
          userId: claims.sub,
          profileId: claims.profileId,
          type: body.type,
          payload: body.payload
        });
        sendJson(res, 202, { job }, requestId);
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/jobs/stats') {
        requireAuth(req);
        const stats = await repo.getJobStats();
        sendJson(res, 200, stats, requestId);
        return;
      }

      sendJson(res, 404, { error: `Route not found: ${method} ${pathname}`, requestId }, requestId);
    } catch (err) {
      if (err instanceof AuthError) {
        sendJson(res, err.statusCode, { error: err.message, requestId }, requestId);
      } else if (err instanceof ConsentRequiredError) {
        sendJson(
          res,
          403,
          { error: err.message, consentCategory: err.category, requestId },
          requestId
        );
      } else if (err instanceof SsrfBlockedError) {
        sendJson(res, 400, { error: err.message, ssrfReason: err.reason, requestId }, requestId);
      } else if (err instanceof z.ZodError) {
        sendJson(
          res,
          400,
          { error: 'Validation error', issues: err.issues, requestId },
          requestId
        );
      } else {
        logger.log(
          'error',
          'Unhandled request error',
          { path: pathname, error: err instanceof Error ? err.message : String(err) },
          requestId
        );
        sendJson(res, 500, { error: 'Internal server error', requestId }, requestId);
      }
    } finally {
      metrics.recordHttpRequest(Date.now() - started, res.statusCode || 200);
    }
  };
}

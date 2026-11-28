import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModelProvider } from '@main/agent/providers/model-provider';
import { LavrayDatabase } from '@main/db/database';
import { AgentRepository } from '@main/db/repositories/agent-repo';
import { BrowserRepository } from '@main/db/repositories/browser-repo';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { MemoryService } from '@main/memory/memory-service';
import { AuditLogger } from '@main/security/audit-logger';
import { SecretVault } from '@main/security/secrets';
import { CloudClientService } from '@main/cloud/cloud-client';
import { LocalSearchIndexService } from '@main/cloud/local-search-index';
import { loadBackendConfig } from '../../src/backend/config';
import { InMemoryCloudRepository } from '../../src/backend/db/memory-repository';
import { runComprehensiveSearchBenchmark } from '../../src/backend/eval/comprehensive-benchmark';
import { MetricsRegistry } from '../../src/backend/observability/metrics';
import { AiOrchestrator } from '../../src/backend/modules/ai/ai-orchestrator';
import { HybridIndexService } from '../../src/backend/modules/knowledge/hybrid-index-service';
import { ResearchExtractorService } from '../../src/backend/modules/research/research-extractor';
import { SearchCache } from '../../src/backend/modules/search/cache';
import { CitationAnswerPipeline } from '../../src/backend/modules/search/citation-pipeline';
import { QueryUnderstandingEngine } from '../../src/backend/modules/search/query-understanding';
import { SearchRankingPipeline } from '../../src/backend/modules/search/ranking';
import { SearchOrchestrator } from '../../src/backend/modules/search/search-orchestrator';
import type { SearchProvider } from '../../src/backend/modules/search/provider';
import { UserDataService } from '../../src/backend/modules/userdata/user-data-service';
import { SsrfGuard } from '../../src/backend/security/ssrf-guard';

describe('LAVRAY Search Pipeline — Engineering, Ranking, Caching, Cancellation, Privacy & 110-Query Benchmark', () => {
  let tmpDir = '';

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lavray-pipeline-suite-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves technical syntax, quoted phrases, operators, and typo corrections in QueryUnderstandingEngine', () => {
    const qu = new QueryUnderstandingEngine();

    const exact = qu.analyzeDeterministic('"GIN inverted indexes" site:postgresql.org -mysql c++');
    expect(exact.exactPhrases).toEqual(['GIN inverted indexes']);
    expect(exact.siteFilters).toEqual(['postgresql.org']);
    expect(exact.excludedTerms).toEqual(['mysql']);
    expect(exact.technicalTokens).toContain('c++');
    expect(exact.isExactMatchQuery).toBe(true);
    expect(exact.expandedTerms).toEqual([]); // Do not dilute exact-match queries with synonyms

    const cmp = qu.analyzeDeterministic('PostgreSQL vs SQLite for embedded search');
    expect(cmp.intent).toBe('comparative');
    expect(cmp.recommendedMode).toBe('research');

    const nav = qu.analyzeDeterministic('github.com');
    expect(nav.intent).toBe('navigational');

    const typo = qu.analyzeDeterministic('postgreql kubernets electorn');
    expect(typo.coreTokens).toEqual(expect.arrayContaining(['postgresql', 'kubernetes', 'electron']));
    expect(typo.correctedQuery).toBe('postgresql kubernetes electron');

    const exactTypo = qu.analyzeDeterministic('postgreql', 'web', { disableTypoCorrection: true });
    expect(exactTypo.correctedQuery).toBeNull();
    expect(exactTypo.coreTokens).toEqual(['postgreql']);
  });

  it('enforces deduplication (www/http/utm), spam filtering, excluded terms, timeRange, and domain diversity', async () => {
    const qu = new QueryUnderstandingEngine();
    const ranking = new SearchRankingPipeline();
    const understanding = qu.analyzeDeterministic('postgresql full text search -deprecated');

    const { results, totalBeforeDedup, duplicatesRemoved } = ranking.normalizeAndRank({
      understanding,
      filters: { timeRange: 'year', safeSearch: 'moderate' },
      candidates: [
        {
          title: 'PostgreSQL Documentation: Full Text Search',
          url: 'https://www.postgresql.org/docs/current/textsearch.html',
          snippet: 'PostgreSQL tsvector and GIN indexes provide fast full text search.',
          sourceProvider: 'lavray_first_party_index',
          publishedAt: '2026-08-01T00:00:00Z',
          contentType: 'docs',
          rawRank: 1
        },
        {
          title: 'PostgreSQL Documentation: Full Text Search',
          url: 'http://postgresql.org/docs/current/textsearch.html?utm_source=feed',
          snippet: 'PostgreSQL tsvector and GIN indexes.',
          sourceProvider: 'brave_web_api',
          publishedAt: '2026-08-01T00:00:00Z',
          contentType: 'docs',
          rawRank: 2
        },
        {
          title: 'PostgreSQL Deprecated Guide',
          url: 'https://example.org/deprecated-pg',
          snippet: 'This deprecated guide is excluded by -deprecated.',
          sourceProvider: 'wikipedia_api',
          publishedAt: '2026-08-01T00:00:00Z'
        },
        {
          title: '404 Not Found',
          url: 'https://broken.example.com/404',
          snippet: 'Just a moment... Enable JavaScript',
          sourceProvider: 'brave_web_api',
          publishedAt: '2026-10-01T00:00:00Z'
        },
        {
          title: 'PostgreSQL PostgreSQL PostgreSQL Free Buy Cheap Click Here',
          url: 'https://a-b-c-d-e-spam.example.com/1/2/3/4/5/6/7/8/spam',
          snippet: 'postgresql postgresql postgresql postgresql buy cheap online click here to claim',
          sourceProvider: 'searxng_custom',
          publishedAt: '2026-11-01T00:00:00Z'
        },
        {
          title: 'PostgreSQL PostgreSQL PostgreSQL Text Search Search Search',
          url: 'https://a-b-c-d-e-stuffed.example.com/1/2/3/4/5/6/7/8/pg',
          snippet: 'postgresql postgresql postgresql text text search search postgresql postgresql postgresql',
          sourceProvider: 'searxng_custom',
          publishedAt: '2026-11-01T00:00:00Z',
          rawRank: 5
        },
        {
          title: 'PostgreSQL 2019 Old Notes',
          url: 'https://old.example.org/pg-2019',
          snippet: 'Old notes on postgresql full text search from 2019.',
          sourceProvider: 'wikipedia_api',
          publishedAt: '2019-01-01T00:00:00Z'
        },
        {
          title: 'PostgreSQL Second Page',
          url: 'https://www.postgresql.org/docs/current/functions-textsearch.html',
          snippet: 'Additional functions for postgresql full text search.',
          sourceProvider: 'lavray_first_party_index',
          publishedAt: '2026-08-01T00:00:00Z',
          contentType: 'docs',
          rawRank: 3
        },
        {
          title: 'Independent Blog: PostgreSQL Full Text Search Tuning',
          url: 'https://pgtuning.example.org/fts-guide',
          snippet: 'Practical guide to tuning postgresql full text search and GIN indexes.',
          sourceProvider: 'hackernews_algolia',
          publishedAt: '2026-09-01T00:00:00Z',
          contentType: 'web',
          rawRank: 4
        }
      ]
    });

    expect(totalBeforeDedup).toBe(5); // deprecated, 404 boilerplate, blatant buy-cheap spam, and 2019 stale dropped
    expect(duplicatesRemoved).toBeGreaterThanOrEqual(1); // www vs http+utm merged
    expect(results.some((r) => r.canonicalUrl.includes('deprecated'))).toBe(false);
    expect(results.some((r) => r.canonicalUrl.includes('404'))).toBe(false);
    expect(results.some((r) => r.domain.includes('spam'))).toBe(false);
    expect(results[0].canonicalUrl).toBe('https://www.postgresql.org/docs/current/textsearch.html');
    // Keyword-stuffed domain ranked below legitimate independent blog
    const stuffedIdx = results.findIndex((r) => r.domain.includes('stuffed'));
    const blogIdx = results.findIndex((r) => r.domain === 'pgtuning.example.org');
    expect(blogIdx).toBeGreaterThanOrEqual(0);
    if (stuffedIdx >= 0) expect(blogIdx).toBeLessThan(stuffedIdx);
  });

  it('supports SQLite FTS5 AND-first retrieval, separate result/AI caching, cancellation, fallback, and private isolation', async () => {
    const db = new LavrayDatabase(':memory:');
    const localIdx = new LocalSearchIndexService(db.db);
    localIdx.indexRawPageForLocalCache(
      'https://sqlite.org/fts5.html',
      'SQLite FTS5 Virtual Table',
      'SQLite FTS5 provides fast bm25 full text search with Porter stemming inside SQLite databases. '.repeat(2)
    );
    localIdx.indexRawPageForLocalCache(
      'https://example.org/only-sqlite',
      'SQLite Overview',
      'SQLite is a C library that implements a self-contained transactional SQL database engine without FTS. '.repeat(2)
    );
    const ftsHits = localIdx.searchLocalIndex('SQLite FTS5');
    expect(ftsHits[0].url).toBe('https://sqlite.org/fts5.html');
    db.close();

    // Orchestrator: separate result vs AI cache, inflight dedup, provider fallback, cancellation, private isolation
    const repo = new InMemoryCloudRepository();
    const metrics = new MetricsRegistry();
    const config = loadBackendConfig({ ...process.env, NODE_ENV: 'test' });
    const hybrid = new HybridIndexService(repo);
    const userData = new UserDataService(repo, hybrid);
    const cache = new SearchCache(null, 50);

    let searchCalls = 0;
    const slowOrFailing: SearchProvider = {
      id: 'failing_provider',
      name: 'Failing',
      isMock: true,
      isConfigured: () => true,
      supportsMode: () => true,
      async search() {
        throw new Error('Upstream 503');
      },
      async healthCheck() {
        return { providerId: 'failing_provider', name: 'Failing', configured: true, healthy: false, isMock: true, avgLatencyMs: 0 };
      }
    };
    const healthyProvider: SearchProvider = {
      id: 'healthy_provider',
      name: 'Healthy',
      isMock: true,
      isConfigured: () => true,
      supportsMode: () => true,
      async search(p) {
        searchCalls += 1;
        if (p.signal?.aborted) throw new Error('Aborted');
        await new Promise((r) => setTimeout(r, 15));
        if (p.signal?.aborted) throw new Error('Aborted');
        return [
          {
            title: 'SQLite FTS5 Documentation',
            url: 'https://sqlite.org/fts5.html',
            snippet: 'SQLite FTS5 extension provides bm25 full text indexing.',
            sourceProvider: 'healthy_provider',
            rawRank: 1
          }
        ];
      },
      async healthCheck() {
        return { providerId: 'healthy_provider', name: 'Healthy', configured: true, healthy: true, isMock: true, avgLatencyMs: 1 };
      }
    };

    const mockAi: ModelProvider = {
      id: 'mock_citation_ai',
      async generate() {
        return {
          text: JSON.stringify({
            sufficientEvidence: true,
            summary: 'SQLite FTS5 supports bm25 ranking.',
            claims: [
              {
                statement: 'SQLite FTS5 supports bm25 indexing.',
                kind: 'fact',
                sourceUrl: 'https://sqlite.org/fts5.html',
                supportingQuote: 'SQLite FTS5 extension provides bm25 full text indexing.'
              }
            ],
            contradictions: []
          }),
          functionCalls: [],
          usage: { inputTokens: 50, outputTokens: 30, fromProvider: true },
          finishReason: 'STOP'
        };
      }
    };

    const aiOrch = new AiOrchestrator(config, metrics, mockAi);
    const orch = new SearchOrchestrator(
      [slowOrFailing, healthyProvider],
      null,
      new QueryUnderstandingEngine(aiOrch),
      new CitationAnswerPipeline(aiOrch, new ResearchExtractorService(new SsrfGuard())),
      cache,
      userData,
      metrics,
      180
    );

    // 1. Concurrent identical searches deduplicate into 1 provider call
    const [r1, r2] = await Promise.all([
      orch.executeSearch({ query: 'sqlite fts5', mode: 'web', filters: { includeAiAnswer: false }, fetchFullPagesForCitations: false }),
      orch.executeSearch({ query: 'sqlite fts5', mode: 'web', filters: { includeAiAnswer: false }, fetchFullPagesForCitations: false })
    ]);
    expect(searchCalls).toBe(1);
    expect(r1.results.length).toBe(1);
    expect(r1.providerErrors.length).toBe(1);
    expect(r2.results[0].url).toBe('https://sqlite.org/fts5.html');

    // 2. Subsequent call requesting AI hits result cache (no extra provider call!) and generates AI answer
    const r3 = await orch.executeSearch({
      query: 'sqlite fts5',
      mode: 'web',
      filters: { includeAiAnswer: true },
      fetchFullPagesForCitations: false
    });
    expect(searchCalls).toBe(1);
    expect(r3.cacheHit).toBe(true);
    expect(r3.aiAnswer?.status).toBe('ok');
    expect(r3.aiAnswer?.citations[0]?.url).toBe('https://sqlite.org/fts5.html');

    // 3. Private session never reads or writes cache and never leaks private tabs
    await orch.executeSearch({
      query: 'sqlite fts5 private',
      mode: 'web',
      isPrivateSession: true,
      filters: { includeAiAnswer: false },
      authorizedTabs: [
        { tabId: 'priv', url: 'https://secret.invalid/x', title: 'Secret', text: 'sqlite fts5 secret', isPrivate: true }
      ]
    });
    expect(searchCalls).toBe(2);
    const callsAfterPriv = searchCalls;
    await orch.executeSearch({ query: 'sqlite fts5 private', mode: 'web', isPrivateSession: true, filters: { includeAiAnswer: false } });
    expect(searchCalls).toBe(callsAfterPriv + 1);

    // 4. Aborted search signal cancels cleanly without polluting cache
    const ac = new AbortController();
    ac.abort();
    const aborted = await orch.executeSearch({
      query: 'aborted query test',
      mode: 'web',
      filters: { includeAiAnswer: false },
      signal: ac.signal
    });
    expect(aborted.results.length).toBe(0);
  });

  it('rejects fabricated LLM claims in desktop CloudClientService via verifyClaimAgainstPassages', async () => {
    const db = new LavrayDatabase(':memory:');
    const browserRepo = new BrowserRepository(db.db);
    const agentRepo = new AgentRepository(db.db);
    const platformRepo = new PlatformRepository(db.db);
    const auditLogger = new AuditLogger(platformRepo);
    const memory = new MemoryService(platformRepo);
    const vault = new SecretVault(tmpDir);
    const localIdx = new LocalSearchIndexService(db.db);
    localIdx.indexRawPageForLocalCache(
      'https://sqlite.org/fts5.html',
      'SQLite FTS5 Virtual Table',
      'SQLite FTS5 provides bm25 ranking and Porter stemming for local search. '.repeat(3)
    );

    const hallucinatingAi: ModelProvider = {
      id: 'hallucinating_local_ai',
      async generate() {
        return {
          text: JSON.stringify({
            sufficientEvidence: true,
            summary: 'SQLite FTS5 provides bm25 ranking.',
            claims: [
              {
                statement: 'SQLite FTS5 provides bm25 ranking.',
                kind: 'fact',
                sourceUrl: 'https://sqlite.org/fts5.html',
                supportingQuote: 'SQLite FTS5 provides bm25 ranking and Porter stemming'
              },
              {
                statement: 'Fabricated claim with fake URL',
                kind: 'fact',
                sourceUrl: 'https://fake-hallucinated.invalid/foo',
                supportingQuote: 'Never existed'
              }
            ],
            contradictions: []
          }),
          functionCalls: [],
          usage: { inputTokens: 40, outputTokens: 20, fromProvider: true },
          finishReason: 'STOP'
        };
      }
    };

    const client = new CloudClientService(
      platformRepo,
      browserRepo,
      agentRepo,
      { getAllTabs: () => [], getWebContents: () => undefined } as never,
      { capture: async () => null } as never,
      memory,
      vault,
      auditLogger,
      () => hallucinatingAi,
      localIdx
    );

    const res = await client.executeSearch({
      query: 'sqlite fts5 bm25 ranking',
      mode: 'research',
      filters: { includeAiAnswer: true }
    });
    expect(res.aiAnswer?.status).toBe('ok');
    expect(res.aiAnswer?.unsupportedClaimsCount).toBe(1);
    expect(res.aiAnswer?.claims.every((c) => c.sourceUrl === 'https://sqlite.org/fts5.html')).toBe(true);
    db.close();
  });

  it('runs the 110-query reproducible search benchmark and improves quality over baseline', async () => {
    const report = await runComprehensiveSearchBenchmark();
    console.log('[COMPREHENSIVE_BENCHMARK_110]', JSON.stringify(report));

    expect(report.queryCount).toBe(110);
    expect(report.improved.ndcgAt10).toBeGreaterThan(report.baseline.ndcgAt10);
    expect(report.improved.mrr).toBeGreaterThan(report.baseline.mrr);
    expect(report.improved.ndcgAt10).toBeGreaterThanOrEqual(0.85);
    expect(report.improved.mrr).toBeGreaterThanOrEqual(0.85);
    expect(report.improved.recallAt10).toBeGreaterThanOrEqual(0.9);
  });
});

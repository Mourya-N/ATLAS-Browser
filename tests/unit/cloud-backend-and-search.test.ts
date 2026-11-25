import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelProvider
} from '@main/agent/providers/model-provider';
import { AtlasDatabase } from '@main/db/database';
import { AgentRepository } from '@main/db/repositories/agent-repo';
import { BrowserRepository } from '@main/db/repositories/browser-repo';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { MemoryService } from '@main/memory/memory-service';
import { SecretVault } from '@main/security/secrets';
import { AuditLogger } from '@main/security/audit-logger';
import { MockModelProvider } from '@main/agent/providers/mock-provider';
import { CloudClientService } from '@main/cloud/cloud-client';
import { loadBackendConfig } from '../../src/backend/config';
import { startCloudServer, type BackendRuntime } from '../../src/backend/api/server';
import { MockSearchProvider } from '../../src/backend/modules/search/adapters';
import { FirstPartyIndexProvider } from '../../src/backend/modules/search/first-party-index-provider';
import { AiUnavailableError } from '../../src/backend/modules/ai/ai-orchestrator';
import { SsrfBlockedError, SsrfGuard } from '../../src/backend/security/ssrf-guard';

describe('Atlas Cloud Backend, Security, Hybrid Search & Local-First Desktop Client', () => {
  let fixtureServer: http.Server;
  let fixtureBaseUrl = '';
  let runtime: BackendRuntime;
  let apiBaseUrl = '';
  let tmpDir = '';

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cloud-test-'));

    fixtureServer = http.createServer((req, res) => {
      const u = req.url || '/';
      if (u.startsWith('/redirect-to-metadata')) {
        res.statusCode = 302;
        res.setHeader('Location', 'http://169.254.169.254/latest/meta-data/');
        res.end();
        return;
      }
      if (u.startsWith('/huge')) {
        res.statusCode = 200;
        res.setHeader('Content-Length', String(10 * 1024 * 1024));
        res.end('too large');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html><head><title>Safe Public Fixture</title></head><body><article><h1>PostgreSQL Text Search</h1><p>PostgreSQL uses tsvector and GIN indexes to accelerate lexical search queries.</p></article></body></html>'
      );
    });
    await new Promise<void>((resolve) => fixtureServer.listen(0, '127.0.0.1', () => resolve()));
    const fAddr = fixtureServer.address();
    const fPort = typeof fAddr === 'object' && fAddr ? fAddr.port : 0;
    fixtureBaseUrl = `http://127.0.0.1:${fPort}`;

    // AI provider returning one valid cited claim and one fabricated URL to verify anti-hallucination filter
    const citationTestAi: ModelProvider = {
      id: 'test_ai_with_hallucination_check',
      async generate(req: ModelGenerateRequest): Promise<ModelGenerateResponse> {
        const prompt = req.messages.map((m) => m.parts.map((p) => p.text || '').join(' ')).join('\n');
        const urlMatch = /URL:\s*(\S+)/.exec(prompt);
        const excerptMatch = /EXCERPT:\s*([^\n]+)/.exec(prompt);
        const validUrl = urlMatch?.[1] || 'https://www.postgresql.org/docs/current/textsearch.html';
        const excerpt = excerptMatch?.[1]?.trim() || 'PostgreSQL tsvector and tsquery provide native stemming';
        return {
          text: JSON.stringify({
            sufficientEvidence: true,
            summary: 'PostgreSQL supports tsvector indexing for fast lexical search.',
            claims: [
              {
                statement: 'PostgreSQL uses tsvector for lexical search.',
                kind: 'fact',
                sourceUrl: validUrl,
                supportingQuote: excerpt.slice(0, 80)
              },
              {
                statement: 'Fabricated claim that must be stripped.',
                kind: 'fact',
                sourceUrl: 'https://fabricated-hallucinated-domain.invalid/fake',
                supportingQuote: 'Invented quote'
              }
            ],
            contradictions: []
          }),
          functionCalls: [],
          usage: { inputTokens: 100, outputTokens: 60, fromProvider: true },
          finishReason: 'STOP'
        };
      }
    };

    const config = {
      ...loadBackendConfig({ ...process.env, NODE_ENV: 'test' }),
      port: 0,
      host: '127.0.0.1'
    };

    runtime = await startCloudServer({
      config,
      searchProviders: [new MockSearchProvider()],
      aiOverrideProvider: citationTestAi
    });
    apiBaseUrl = `http://127.0.0.1:${runtime.port}`;
  });

  afterAll(async () => {
    await runtime.stop();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enforces SSRF protections across private IPs, metadata endpoints, DNS rebinding, redirects, and size limits', async () => {
    const guard = new SsrfGuard();

    const blockedUrls = [
      'http://127.0.0.1:48080/health',
      'http://localhost/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://10.0.0.5/internal',
      'http://192.168.1.1/',
      'http://172.16.10.2/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'file:///etc/passwd',
      'http://user:pass@example.com/'
    ];

    for (const bad of blockedUrls) {
      await expect(guard.safeFetchText(bad)).rejects.toThrow(SsrfBlockedError);
    }

    // DNS rebinding simulation (public domain resolving to RFC1918 IP)
    await expect(
      guard.validateResolvedHost(new URL('https://rebind.example.com'), {
        dnsLookup: async () => [{ address: '10.20.30.40', family: 4 }]
      })
    ).rejects.toThrow(SsrfBlockedError);

    // Redirect into cloud metadata must be blocked on hop 1
    await expect(
      guard.safeFetchText(`${fixtureBaseUrl}/redirect-to-metadata`, { allowLocalhostForTest: true })
    ).rejects.toThrow(SsrfBlockedError);

    // Oversized Content-Length blocked
    await expect(
      guard.safeFetchText(`${fixtureBaseUrl}/huge`, { allowLocalhostForTest: true, maxBytes: 1024 })
    ).rejects.toThrow(SsrfBlockedError);

    // Legitimate fixture extraction works cleanly
    const extracted = await runtime.services.extractor.fetchAndExtract(fixtureBaseUrl, {
      allowLocalhostForTest: true
    });
    expect(extracted.title).toContain('Safe Public Fixture');
    expect(extracted.textContent).toContain('tsvector');
  });

  it('rejects silent AI mock fallback in production configuration', async () => {
    expect(() => loadBackendConfig({ NODE_ENV: 'production' })).toThrow(/ATLAS_JWT_SECRET/);
    const prodConfig = loadBackendConfig({
      NODE_ENV: 'production',
      ATLAS_JWT_SECRET: '0123456789abcdef0123456789abcdef',
      ATLAS_ALLOW_MOCK_AI: 'true',
      ATLAS_ALLOW_MOCK_SEARCH: 'true'
    });
    expect(prodConfig.allowMockAi).toBe(false);
    expect(prodConfig.allowMockSearch).toBe(false);

    const { AiOrchestrator } = await import('../../src/backend/modules/ai/ai-orchestrator');
    const { MetricsRegistry } = await import('../../src/backend/observability/metrics');
    const prodAi = new AiOrchestrator(prodConfig, new MetricsRegistry());
    await expect(
      prodAi.generate({
        systemInstruction: 'sys',
        messages: [{ role: 'user', parts: [{ text: 'hello' }] }]
      })
    ).rejects.toThrow(AiUnavailableError);
  });

  it('supports JWT/scrypt auth, granular consent enforcement, hybrid knowledge indexing, cited search, and GDPR delete', async () => {
    // 1. Register & Verify no plaintext password in repository
    const regRes = await fetch(`${apiBaseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'architect@atlasbrowser.dev',
        password: 'StrongPassword!2026',
        displayName: 'Atlas Architect'
      })
    });
    expect(regRes.status).toBe(201);
    const session = (await regRes.json()) as {
      user: { id: string; email: string };
      profile: { id: string };
      accessToken: string;
      refreshToken: string;
    };
    expect(session.accessToken).toBeTruthy();

    const storedUser = await runtime.services.repo.findUserByEmail('architect@atlasbrowser.dev');
    expect(storedUser?.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(storedUser?.passwordHash).not.toContain('StrongPassword!2026');

    // 2. Refresh token rotation & old refresh token rejection
    const refreshRes = await fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    expect(refreshRes.status).toBe(200);
    const rotated = (await refreshRes.json()) as typeof session;

    const replayRefresh = await fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    expect(replayRefresh.status).toBe(401);

    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${rotated.accessToken}`
    };

    // 3. Consent defaults to FALSE -> saving cloud note without consent returns 403
    const deniedNote = await fetch(`${apiBaseUrl}/api/v1/userdata/notes`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Secret Architecture', content: 'Must fail without consent' })
    });
    expect(deniedNote.status).toBe(403);

    // 4. Enable consent explicitly for notes & bookmarks -> sync succeeds & populates Hybrid Index
    const consentRes = await fetch(`${apiBaseUrl}/api/v1/profile/consent`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ syncNotes: true, syncBookmarks: true, allowCloudSearch: true })
    });
    expect(consentRes.status).toBe(200);

    const okNote = await fetch(`${apiBaseUrl}/api/v1/userdata/notes`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Atlas Hybrid Retrieval Design',
        content: 'Combines PostgreSQL tsvector keyword search with 64-dim embeddings for personal memory.',
        tags: ['search', 'architecture']
      })
    });
    expect(okNote.status).toBe(201);

    // Verify private note upload rejected even with consent
    const privateNote = await fetch(`${apiBaseUrl}/api/v1/userdata/notes`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Private session tab note',
        content: 'Must stay local',
        isPrivate: true
      })
    });
    expect(privateNote.status).toBe(500);

    // 5. Knowledge hybrid search finds synced note
    const kRes = await fetch(`${apiBaseUrl}/api/v1/knowledge/search`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ query: 'tsvector embeddings architecture' })
    });
    expect(kRes.status).toBe(200);
    const kData = (await kRes.json()) as { hits: Array<{ document: { title: string } }> };
    expect(kData.hits[0].document.title).toContain('Atlas Hybrid Retrieval Design');

    // 6. Execute Intelligent Search with Cited AI Answer & verify hallucinated URLs are stripped
    const sRes = await fetch(`${apiBaseUrl}/api/v1/search`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        query: 'PostgreSQL tsvector GIN indexes',
        mode: 'research',
        filters: { includeAiAnswer: true, includePersonalKnowledge: true },
        fetchFullPagesForCitations: false
      })
    });
    expect(sRes.status).toBe(200);
    const sData = (await sRes.json()) as {
      results: Array<{ url: string; canonicalUrl: string }>;
      aiAnswer: {
        status: string;
        claims: Array<{ sourceUrl: string; verifiedAgainstSource: boolean }>;
        citations: Array<{ url: string }>;
      };
    };
    expect(sData.results.length).toBeGreaterThan(0);
    expect(sData.aiAnswer.status).toBe('ok');
    expect(
      sData.aiAnswer.citations.some((c) => c.url.includes('fabricated-hallucinated-domain'))
    ).toBe(false);
    expect(sData.aiAnswer.claims.every((c) => c.verifiedAgainstSource)).toBe(true);

    // 7. Observability metrics
    const mRes = await fetch(`${apiBaseUrl}/api/v1/observability/metrics`);
    expect(mRes.status).toBe(200);
    const mData = (await mRes.json()) as { search: { totalSearches: number }; ai: { totalCalls: number } };
    expect(mData.search.totalSearches).toBeGreaterThanOrEqual(1);
    expect(mData.ai.totalCalls).toBeGreaterThanOrEqual(1);

    // 8. Export & Delete Account cascade
    const expRes = await fetch(`${apiBaseUrl}/api/v1/account/export`, { headers: authHeaders });
    expect(expRes.status).toBe(200);
    const expData = (await expRes.json()) as { notes: unknown[] };
    expect(expData.notes.length).toBe(1);

    const delRes = await fetch(`${apiBaseUrl}/api/v1/account`, {
      method: 'DELETE',
      headers: authHeaders
    });
    expect(delRes.status).toBe(200);
    expect(await runtime.services.repo.findUserByEmail('architect@atlasbrowser.dev')).toBeNull();
  });

  it('processes retryable background worker jobs and sends persistent failures to dead_letter', async () => {
    const { worker, repo } = runtime.services;

    // 1. Valid page extraction job completes cleanly
    const goodJob = await worker.enqueue({
      userId: 'u-worker',
      profileId: 'p-worker',
      type: 'page_extract',
      payload: { url: fixtureBaseUrl, allowLocalhostForTest: true }
    });
    const completed = await worker.processOnce();
    expect(completed?.id).toBe(goodJob.id);
    expect(completed?.status).toBe('completed');

    // 2. SSRF-blocked job fails and moves to dead_letter after maxAttempts
    const badJob = await worker.enqueue({
      userId: 'u-worker',
      profileId: 'p-worker',
      type: 'page_extract',
      payload: { url: 'http://169.254.169.254/latest/meta-data/' },
      maxAttempts: 2
    });
    const attempt1 = await worker.processOnce();
    expect(attempt1?.id).toBe(badJob.id);
    expect(attempt1?.status).toBe('queued');
    // Force immediate due time for attempt 2 test
    await repo.updateJob({ ...attempt1!, runAfter: Date.now() - 100 });
    const attempt2 = await worker.processOnce();
    expect(attempt2?.status).toBe('dead_letter');
  });

  it('supports prototype FirstPartyIndexProvider with robots.txt policy enforcement', async () => {
    const provider = new FirstPartyIndexProvider(
      runtime.services.hybridIndex,
      new SsrfGuard()
    );
    const robots = 'User-agent: *\nDisallow: /private/\n';
    expect(provider.parseRobotsAllows(robots, '/private/secret')).toBe(false);
    expect(provider.parseRobotsAllows(robots, '/docs/search')).toBe(true);

    const blocked = await provider.indexApprovedPublicPage({
      url: 'https://docs.example.org/private/secret',
      title: 'Private',
      content: 'Should not index',
      robotsTxt: robots
    });
    expect(blocked).toBe(false);

    const allowed = await provider.indexApprovedPublicPage({
      url: 'https://docs.example.org/docs/search',
      title: 'Atlas Web Index Prototype',
      content: 'Policy-compliant prototype crawler adapter respecting robots.txt and rate limits.',
      robotsTxt: robots
    });
    expect(allowed).toBe(true);

    const hits = await provider.search({
      query: 'robots.txt prototype crawler',
      mode: 'web',
      limit: 5
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].sourceProvider).toBe('atlas_first_party_index');
  });

  it('operates Electron CloudClientService in local-first fallback AND cloud-connected hybrid mode while excluding private tabs', async () => {
    const db = new AtlasDatabase(':memory:');
    const browserRepo = new BrowserRepository(db.db);
    const agentRepo = new AgentRepository(db.db);
    const platformRepo = new PlatformRepository(db.db);
    const auditLogger = new AuditLogger(platformRepo);
    const memory = new MemoryService(platformRepo);
    const vault = new SecretVault(tmpDir);

    browserRepo.addBookmark('https://postgresql.org/docs', 'PostgreSQL Local Docs Bookmark');
    memory.save({
      category: 'task_knowledge',
      title: 'PostgreSQL Query Tuning Note',
      content: 'Always verify GIN indexes and EXPLAIN ANALYZE on tsvector columns.',
      source: 'user'
    });

    const mockTabs = [
      {
        id: 'tab-public',
        windowId: 1,
        url: 'https://example.org/postgres-guide',
        title: 'Public Postgres Guide Tab',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isPinned: false,
        isMuted: false,
        isPrivate: false,
        orderIndex: 0,
        zoomFactor: 1,
        crashed: false,
        securityState: 'secure' as const,
        blockedCount: 0,
        agentActive: false,
        lastActiveAt: Date.now()
      },
      {
        id: 'tab-private',
        windowId: 1,
        url: 'https://secret-bank.example.com/private-page',
        title: 'Private Incognito Secret Tab',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isPinned: false,
        isMuted: false,
        isPrivate: true,
        orderIndex: 1,
        zoomFactor: 1,
        crashed: false,
        securityState: 'secure' as const,
        blockedCount: 0,
        agentActive: false,
        lastActiveAt: Date.now()
      }
    ];

    const fakeTabManager = {
      getAllTabs: () => mockTabs,
      getWebContents: (id: string) => ({ id })
    } as never;

    const fakePerception = {
      capture: async (tabId: string) => ({
        tabId,
        url: tabId === 'tab-public' ? 'https://example.org/postgres-guide' : 'https://secret-bank.example.com/private-page',
        title: tabId === 'tab-public' ? 'Public Postgres Guide Tab' : 'Private Incognito Secret Tab',
        capturedAt: Date.now(),
        viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, scrollHeight: 1000 },
        axSummary: '',
        interactiveElements: [],
        mainText:
          tabId === 'tab-public'
            ? 'Public tab discussing PostgreSQL tsvector search indexing.'
            : 'PRIVATE SECRET BANK BALANCE SHOULD NEVER APPEAR',
        selectedText: '',
        headings: [],
        tablesSummary: [],
        injectionWarnings: [],
        hitlSignals: []
      })
    } as never;

    const client = new CloudClientService(
      platformRepo,
      browserRepo,
      agentRepo,
      fakeTabManager,
      fakePerception,
      memory,
      vault,
      auditLogger,
      () => new MockModelProvider()
    );

    // 1. Offline/Local-only mode: still retrieves bookmarks, memory, and public tab while strictly excluding private tab
    const localSearch = await client.executeSearch({
      query: 'PostgreSQL tsvector',
      mode: 'web',
      filters: { includeOpenTabs: true, includeAiAnswer: false }
    });
    expect(localSearch.sourceMode).toBe('local_fallback');
    expect(localSearch.results.length).toBeGreaterThanOrEqual(2);
    expect(localSearch.results.some((r) => r.url.includes('secret-bank'))).toBe(false);

    // 2. Connect to running local cloud backend
    platformRepo.setSetting('cloud.endpointUrl', apiBaseUrl);
    await client.register({
      email: 'desktop-client@atlasbrowser.dev',
      password: 'DesktopPassword!2026',
      displayName: 'Desktop Client'
    });
    await client.updateConsent({ allowCloudSearch: true, syncBookmarks: true, allowCloudAi: true });

    const syncStats = await client.syncApprovedData();
    expect(syncStats.synced.bookmarks).toBe(1);

    const hybridSearch = await client.executeSearch({
      query: 'PostgreSQL tsvector GIN',
      mode: 'research',
      filters: { includeOpenTabs: true }
    });
    expect(hybridSearch.sourceMode).toBe('hybrid');
    expect(hybridSearch.results.some((r) => r.url.includes('secret-bank'))).toBe(false);

    db.close();
  });
});

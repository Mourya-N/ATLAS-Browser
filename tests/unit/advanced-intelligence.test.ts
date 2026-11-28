import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import { LavrayDatabase } from '@main/db/database';
import { AgentRepository } from '@main/db/repositories/agent-repo';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { InjectionGuard } from '@main/security/injection-guard';
import { GeminiApiError, GeminiProvider } from '@main/agent/providers/gemini-provider';
import { MockModelProvider } from '@main/agent/providers/mock-provider';
import { ResearchEngine } from '@main/agent/research-engine';
import { PageUnderstandingEngine } from '@main/agent/page-understanding';
import { CrossTabIntelligence } from '@main/agent/cross-tab';
import { ProactiveAssistant } from '@main/agent/proactive-assistant';
import { MemoryService, computeLocalEmbedding, cosineSimilarity } from '@main/memory/memory-service';
import type { PagePerception, TabInfo } from '@shared/types';

describe('Advanced AI Intelligence & Gemini HTTP Error/Retry Hardening', () => {
  let server: http.Server;
  let baseUrl = '';
  let attemptCounter = 0;
  let observedHeaders: Record<string, string | string[] | undefined> = {};
  let observedUrls: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      observedHeaders = req.headers;
      observedUrls.push(req.url || '');
      const u = req.url || '';

      if (req.method === 'GET' && u.includes('/models/gemini-2.5-flash')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }));
        return;
      }

      if (u.includes('rate-limit-then-ok')) {
        attemptCounter += 1;
        if (attemptCounter === 1) {
          res.statusCode = 429;
          res.setHeader('Retry-After', '0');
          res.end(JSON.stringify({ error: { message: 'Rate limited' } }));
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Recovered after 429' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 5 }
          })
        );
        return;
      }

      if (u.includes('invalid-key-model')) {
        res.statusCode = 401;
        res.end('API key not valid');
        return;
      }

      if (u.includes('missing-model')) {
        res.statusCode = 404;
        res.end('Model not found');
        return;
      }

      if (u.includes('malformed-model')) {
        res.setHeader('Content-Type', 'application/json');
        res.end('{not valid json');
        return;
      }

      if (u.includes('slow-model')) {
        setTimeout(() => {
          res.end(JSON.stringify({ candidates: [] }));
        }, 1200);
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends Gemini key in x-goog-api-key header (not URL), handles 429 retries, 401, 404, malformed JSON, and timeouts', async () => {
    attemptCounter = 0;
    observedUrls = [];
    const provider = new GeminiProvider(() => 'AIzaSyTestHeaderSecret123456', {
      baseUrl,
      timeoutMs: 400,
      maxRetries: 2,
      baseDelayMs: 20
    });

    const conn = await provider.testConnection('gemini-2.5-flash');
    expect(conn.ok).toBe(true);
    expect(conn.capabilities.tools).toBe(true);
    expect(observedHeaders['x-goog-api-key']).toBe('AIzaSyTestHeaderSecret123456');
    expect(observedUrls.some((u) => u.includes('AIzaSyTestHeaderSecret'))).toBe(false);

    // 429 retry recovery
    const recovered = await provider.generate({
      model: 'rate-limit-then-ok',
      systemInstruction: 'sys',
      messages: [{ role: 'user', parts: [{ text: 'hi' }] }]
    });
    expect(recovered.text).toBe('Recovered after 429');
    expect(attemptCounter).toBe(2);

    // 401 invalid key
    await expect(
      provider.generate({
        model: 'invalid-key-model',
        systemInstruction: 'sys',
        messages: [{ role: 'user', parts: [{ text: 'hi' }] }]
      })
    ).rejects.toMatchObject({ code: 'invalid_key' });

    // 404 model unavailable
    await expect(
      provider.generate({
        model: 'missing-model',
        systemInstruction: 'sys',
        messages: [{ role: 'user', parts: [{ text: 'hi' }] }]
      })
    ).rejects.toMatchObject({ code: 'model_unavailable' });

    // Malformed JSON
    await expect(
      provider.generate({
        model: 'malformed-model',
        systemInstruction: 'sys',
        messages: [{ role: 'user', parts: [{ text: 'hi' }] }]
      })
    ).rejects.toMatchObject({ code: 'malformed_response' });

    // Timeout / cancellation
    await expect(
      provider.generate({
        model: 'slow-model',
        systemInstruction: 'sys',
        messages: [{ role: 'user', parts: [{ text: 'hi' }] }]
      })
    ).rejects.toBeInstanceOf(GeminiApiError);
  });

  it('builds cited ResearchReports, filters fabricated URLs, and detects contradictions', async () => {
    const db = new LavrayDatabase(':memory:');
    const agentRepo = new AgentRepository(db.db);
    const mock = new MockModelProvider();
    mock.enqueue([
      {
        text: JSON.stringify({
          summary: 'Comparison of Option A and Option B.',
          claims: [
            {
              claim: 'Option A costs $29/mo.',
              kind: 'fact',
              supportingQuote: 'Price: $29/mo',
              sourceUrl: 'https://a.test',
              sourceTitle: 'Option A',
              confidence: 0.95
            },
            {
              claim: 'Fabricated source claim',
              kind: 'fact',
              supportingQuote: 'Fake',
              sourceUrl: 'https://hallucinated.invalid',
              sourceTitle: 'Fake',
              confidence: 0.5
            }
          ],
          conflicts: [
            {
              topic: 'Monthly Price',
              statementA: '$29/mo',
              sourceA: 'https://a.test',
              statementB: '$99/mo',
              sourceB: 'https://b.test'
            }
          ],
          comparisonTable: { columns: ['Product', 'Price'], rows: [['A', '$29'], ['B', '$99']] },
          notes: 'Checked pricing.'
        }),
        functionCalls: [],
        usage: { inputTokens: 100, outputTokens: 80, fromProvider: false }
      }
    ]);

    const engine = new ResearchEngine(() => mock, agentRepo, new InjectionGuard());
    const report = await engine.buildReport({
      query: 'Compare pricing',
      sources: [
        { url: 'https://a.test', title: 'Option A', text: 'Price: $29/mo', headings: ['Option A'] },
        { url: 'https://b.test', title: 'Option B', text: 'Price: $99/mo', headings: ['Option B'] }
      ],
      model: 'mock'
    });

    expect(report.claims.some((c) => c.sourceUrl === 'https://hallucinated.invalid')).toBe(false);
    expect(report.conflicts).toHaveLength(1);
    expect(engine.toMarkdown(report)).toContain('## Detected Contradictions');
    expect(agentRepo.listResearchReports(10)).toHaveLength(1);
  });

  it('performs semantic page search, detects page changes, and computes cross-tab intelligence', () => {
    const db = new LavrayDatabase(':memory:');
    const platformRepo = new PlatformRepository(db.db);
    const guard = new InjectionGuard();
    const pageEngine = new PageUnderstandingEngine(() => new MockModelProvider(), platformRepo, guard);

    const perc1: PagePerception = {
      tabId: 't1',
      url: 'https://docs.test/auth',
      title: 'Auth Guide',
      capturedAt: Date.now(),
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, scrollHeight: 1600 },
      axSummary: '',
      interactiveElements: [],
      mainText: 'OAuth2 Bearer tokens must be sent in the Authorization header.\n\nBilling rates are $19 per seat.',
      selectedText: '',
      headings: ['H1: Auth Guide', 'H2: Bearer Tokens'],
      tablesSummary: [],
      injectionWarnings: [],
      hitlSignals: []
    };

    const firstVisit = pageEngine.checkAndRecordPageChanges(perc1);
    expect(firstVisit.hasPrevious).toBe(false);

    const perc2 = {
      ...perc1,
      mainText: perc1.mainText + '\n\nAdded Section: Rotate keys every 30 days.',
      headings: [...perc1.headings, 'H2: Key Rotation']
    };
    const secondVisit = pageEngine.checkAndRecordPageChanges(perc2);
    expect(secondVisit.hasPrevious).toBe(true);
    expect(secondVisit.addedHeadings).toContain('H2: Key Rotation');

    const chunks = pageEngine.semanticSearchInPage(perc2, 'Authorization header bearer token', 2);
    expect(chunks[0].text).toContain('Authorization header');

    const crossTab = new CrossTabIntelligence(() => new MockModelProvider(), guard);
    const tabs: TabInfo[] = [
      { id: 't1', windowId: 1, url: 'https://docs.test/auth', title: 'Auth', isLoading: false, canGoBack: false, canGoForward: false, isPinned: false, isMuted: false, isPrivate: false, orderIndex: 0, zoomFactor: 1, crashed: false, securityState: 'secure', blockedCount: 0, agentActive: false, lastActiveAt: 1 },
      { id: 't2', windowId: 1, url: 'https://docs.test/auth', title: 'Auth Copy', isLoading: false, canGoBack: false, canGoForward: false, isPinned: false, isMuted: false, isPrivate: false, orderIndex: 1, zoomFactor: 1, crashed: false, securityState: 'secure', blockedCount: 0, agentActive: false, lastActiveAt: 1 },
      { id: 't3', windowId: 1, url: 'https://secret.test', title: 'Private', isLoading: false, canGoBack: false, canGoForward: false, isPinned: false, isMuted: false, isPrivate: true, orderIndex: 2, zoomFactor: 1, crashed: false, securityState: 'secure', blockedCount: 0, agentActive: false, lastActiveAt: 1 }
    ];
    const allowed = crossTab.filterAllowedTabs(tabs);
    expect(allowed.map((t) => t.id)).toEqual(['t1', 't2']);

    const analysis = crossTab.analyzeTabs(allowed, new Map([['t1', perc2], ['t2', perc2]]));
    expect(analysis.duplicateGroups).toHaveLength(1);
    expect(analysis.duplicateGroups[0].tabIds).toEqual(['t1', 't2']);
  });

  it('supports semantic embeddings, profile scoping, expiration, checkpoints, and opt-in proactive suggestions', () => {
    const db = new LavrayDatabase(':memory:');
    const platformRepo = new PlatformRepository(db.db);
    const agentRepo = new AgentRepository(db.db);
    const mem = new MemoryService(platformRepo);

    const v1 = computeLocalEmbedding('authentication bearer oauth2 token');
    const v2 = computeLocalEmbedding('oauth2 authentication headers');
    const v3 = computeLocalEmbedding('chocolate cake recipe baking');
    expect(cosineSimilarity(v1, v2)).toBeGreaterThan(cosineSimilarity(v1, v3));

    mem.save({
      profileId: 'work',
      category: 'approved_fact',
      title: 'OAuth2 Endpoint',
      content: 'Use Bearer token authentication for API calls.',
      source: 'user'
    });
    mem.save({
      profileId: 'work',
      category: 'note',
      title: 'Expired Note',
      content: 'Should be pruned automatically.',
      source: 'user',
      expiresAt: Date.now() - 1000
    });
    const workHits = mem.retrieveRelevant('authentication bearer', null, 5, 'work');
    expect(workHits).toHaveLength(1);
    expect(workHits[0].title).toBe('OAuth2 Endpoint');
    expect(mem.list(undefined, 'personal')).toHaveLength(0);

    // Checkpoints & Proactive
    const conv = agentRepo.createConversation('Long');
    agentRepo.saveRun({
      id: 'run-cp',
      conversationId: conv.id,
      goal: 'Long research task',
      mode: 'agent',
      status: 'running',
      subgoals: [],
      steps: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      isCostEstimated: false,
      model: 'mock',
      provider: 'mock',
      isPrivate: false,
      startedAt: Date.now()
    });
    agentRepo.saveCheckpoint({
      runId: 'run-cp',
      conversationId: conv.id,
      goal: 'Long research task',
      mode: 'agent',
      subgoals: [],
      currentSubgoalIdx: 0,
      activeTabId: 't1',
      activeUrl: 'https://example.com',
      evidenceCollected: ['Step 1 done'],
      stepCount: 1,
      updatedAt: Date.now()
    });

    const proactive = new ProactiveAssistant(agentRepo);
    expect(
      proactive.evaluate({
        enabled: false,
        tabs: [],
        activeTab: null,
        activePerception: null,
        relatedPairsCount: 1,
        duplicateGroups: []
      })
    ).toHaveLength(0);

    const suggestions = proactive.evaluate({
      enabled: true,
      tabs: [],
      activeTab: null,
      activePerception: null,
      relatedPairsCount: 1,
      duplicateGroups: [{ url: 'https://a.test', tabIds: ['1', '2'] }]
    });
    expect(suggestions.some((s) => s.kind === 'interrupted_task')).toBe(true);
    expect(suggestions.some((s) => s.kind === 'duplicate_tabs')).toBe(true);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { AtlasDatabase } from '@main/db/database';
import { LocalSearchIndexService } from '@main/cloud/local-search-index';
import { SelfHostedOpenAiProvider } from '@main/agent/providers/self-hosted-provider';
import { GeminiApiError } from '@main/agent/providers/gemini-provider';
import {
  exportConsentedTrainingExamples,
  serializeToJsonl
} from '@main/agent/training/dataset-exporter';
import { loadBackendConfig } from '../../src/backend/config';
import { startCloudServer, type BackendRuntime } from '../../src/backend/api/server';
import type { AgentRun } from '@shared/types';

describe('Independent Atlas Search (Crawler + FTS5/PG Index) & Self-Hosted Atlas AI Runtime', () => {
  let siteServer: http.Server;
  let siteBaseUrl = '';
  let pageVersion = 1;

  let llmServer: http.Server;
  let llmBaseUrl = '';

  let cloudRuntime: BackendRuntime;
  let cloudBaseUrl = '';

  beforeAll(async () => {
    // 1. Controlled public-style fixture website with robots.txt, sitemap.xml, canonical link, disallowed admin, and updateable doc page
    siteServer = http.createServer((req, res) => {
      const u = req.url || '/';
      if (u === '/robots.txt') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end(
          `User-agent: *\nDisallow: /private-admin/\nAllow: /\nCrawl-delay: 0\nSitemap: ${siteBaseUrl}/sitemap.xml\n`
        );
        return;
      }
      if (u === '/sitemap.xml') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/xml');
        res.end(
          `<?xml version="1.0"?><urlset><url><loc>${siteBaseUrl}/docs/atlas-crawler</loc></url><url><loc>${siteBaseUrl}/docs/self-hosted-ai</loc></url><url><loc>${siteBaseUrl}/private-admin/secrets</loc></url></urlset>`
        );
        return;
      }
      if (u === '/private-admin/secrets') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><head><title>Admin Secrets</title></head><body>TOP SECRET DO NOT INDEX</body></html>');
        return;
      }
      if (u === '/docs/self-hosted-ai') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(
          `<html><head><title>Atlas Self-Hosted AI Guide</title><link rel="canonical" href="${siteBaseUrl}/docs/self-hosted-ai" /></head><body><main><h1>Ollama & vLLM Integration</h1><p>Self-hosted Qwen2.5-7B-Instruct serves OpenAI compatible chat completions locally without external cloud calls.</p></main></body></html>`
        );
        return;
      }
      if (u === '/docs/duplicate-mirror') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(
          `<html><head><title>Atlas Crawler Docs v${pageVersion}</title><link rel="canonical" href="${siteBaseUrl}/docs/atlas-crawler" /></head><body><main><h1>Crawler Pipeline v${pageVersion}</h1><p>Atlas Crawler obeys robots.txt, enforces SSRF protections, and extracts canonical HTML articles.</p></main></body></html>`
        );
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<html><head><title>Atlas Crawler Docs v${pageVersion}</title><link rel="canonical" href="${siteBaseUrl}/docs/atlas-crawler" /></head><body><main><h1>Crawler Pipeline v${pageVersion}</h1><p>Atlas Crawler obeys robots.txt, enforces SSRF protections, and extracts canonical HTML articles. Revision ${pageVersion}.</p><a href="${siteBaseUrl}/docs/duplicate-mirror">Mirror</a><a href="https://external-disallowed.invalid/out">Out</a></main></body></html>`
      );
    });
    await new Promise<void>((resolve) => siteServer.listen(0, '127.0.0.1', () => resolve()));
    const sAddr = siteServer.address();
    siteBaseUrl = `http://127.0.0.1:${typeof sAddr === 'object' && sAddr ? sAddr.port : 0}`;

    // 2. Local OpenAI-compatible self-hosted inference HTTP fixture (supports /v1/models, /v1/chat/completions, streaming SSE, tool calls, structured JSON)
    llmServer = http.createServer(async (req, res) => {
      const u = req.url || '/';
      if (req.method === 'GET' && u === '/v1/models') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'qwen2.5:7b-instruct' }, { id: 'llama3.2:3b' }]
          })
        );
        return;
      }
      if (req.method === 'POST' && u === '/v1/chat/completions') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.from(c));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          model: string;
          stream?: boolean;
          tools?: Array<{ function: { name: string } }>;
          response_format?: { type: string };
          messages: Array<{ role: string; content: string }>;
        };

        if (body.model === 'missing-weights') {
          res.statusCode = 404;
          res.end('model missing-weights not found');
          return;
        }

        if (body.stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Atlas ' } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'AI works.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5 } })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        if (body.tools && body.tools.length > 0 && body.messages.some((m) => String(m.content).includes('use_tool'))) {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        type: 'function',
                        function: { name: body.tools[0].function.name, arguments: '{"q":"postgres"}' }
                      }
                    ]
                  },
                  finish_reason: 'tool_calls'
                }
              ],
              usage: { prompt_tokens: 30, completion_tokens: 12 }
            })
          );
          return;
        }

        // Grounded citation JSON synthesis reading URL/EXCERPT from prompt
        const userText = body.messages.map((m) => String(m.content)).join('\n');
        const urlMatch = /URL:\s*(http:\/\/127\.0\.0\.1:\d+\S+)/.exec(userText);
        const excerptMatch = /EXCERPT:\s*([^\n]+)/.exec(userText);
        const citedUrl = urlMatch?.[1] || `${siteBaseUrl}/docs/atlas-crawler`;
        const quote = excerptMatch?.[1]?.trim() || 'Atlas Crawler obeys robots.txt';

        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    sufficientEvidence: true,
                    summary: `Grounded answer from local runtime: ${quote.slice(0, 140)}`,
                    claims: [
                      {
                        statement: 'Atlas Crawler obeys robots.txt and enforces SSRF protections.',
                        kind: 'fact',
                        sourceUrl: citedUrl,
                        supportingQuote: quote.slice(0, 100)
                      }
                    ],
                    contradictions: []
                  })
                },
                finish_reason: 'stop'
              }
            ],
            usage: { prompt_tokens: 90, completion_tokens: 45 }
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', () => resolve()));
    const lAddr = llmServer.address();
    llmBaseUrl = `http://127.0.0.1:${typeof lAddr === 'object' && lAddr ? lAddr.port : 0}`;

    // 3. Start Atlas Cloud Backend configured to use self-hosted AI runtime + FirstPartyIndexProvider
    const config = {
      ...loadBackendConfig({
        NODE_ENV: 'test',
        ATLAS_AI_PROVIDER: 'self_hosted',
        ATLAS_SELF_HOSTED_URL: `${llmBaseUrl}/v1`,
        ATLAS_SELF_HOSTED_MODEL: 'qwen2.5:7b-instruct'
      }),
      port: 0,
      host: '127.0.0.1'
    };
    cloudRuntime = await startCloudServer({ config });
    cloudBaseUrl = `http://127.0.0.1:${cloudRuntime.port}`;
  });

  afterAll(async () => {
    await cloudRuntime.stop();
    await new Promise<void>((resolve) => llmServer.close(() => resolve()));
    await new Promise<void>((resolve) => siteServer.close(() => resolve()));
  });

  it('supports SelfHostedOpenAiProvider discovery, streaming, tool calling, structured JSON, and honest missing-model failure', async () => {
    const provider = new SelfHostedOpenAiProvider({
      getEndpointUrl: () => `${llmBaseUrl}/v1`
    });

    const status = await provider.getRuntimeStatus('qwen2.5:7b-instruct');
    expect(status.reachable).toBe(true);
    expect(status.modelAvailable).toBe(true);
    expect(status.availableModels).toContain('qwen2.5:7b-instruct');

    const missingStatus = await provider.getRuntimeStatus('missing-weights');
    expect(missingStatus.reachable).toBe(true);
    expect(missingStatus.modelAvailable).toBe(false);

    // Streaming delta check
    let streamed = '';
    const streamRes = await provider.generate({
      model: 'qwen2.5:7b-instruct',
      systemInstruction: 'sys',
      messages: [{ role: 'user', parts: [{ text: 'hello' }] }],
      onTextDelta: (d) => {
        streamed += d;
      }
    });
    expect(streamed).toBe('Atlas AI works.');
    expect(streamRes.usage.inputTokens).toBe(20);

    // Tool call check
    const toolRes = await provider.generate({
      model: 'qwen2.5:7b-instruct',
      systemInstruction: 'sys',
      messages: [{ role: 'user', parts: [{ text: 'please use_tool' }] }],
      tools: [
        {
          name: 'search_docs',
          description: 'Search docs',
          parameters: { type: 'object', properties: { q: { type: 'string' } } }
        }
      ]
    });
    expect(toolRes.functionCalls).toEqual([{ name: 'search_docs', args: { q: 'postgres' } }]);

    // Unavailable model rejects explicitly (no silent mock fallback)
    await expect(
      provider.generate({
        model: 'missing-weights',
        systemInstruction: 'sys',
        messages: [{ role: 'user', parts: [{ text: 'hi' }] }]
      })
    ).rejects.toThrow(GeminiApiError);
  });

  it('crawls controlled seeds respecting robots.txt & domain scope, updates & removes index docs, and serves GET /api/v1/search?q= with grounded self-hosted AI citations', async () => {
    // Register & auth for crawl + delete endpoints
    const reg = await fetch(`${cloudBaseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'search-admin@atlas.dev', password: 'AdminPassword!2026' })
    });
    const session = (await reg.json()) as { accessToken: string };
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`
    };

    // 1. Run controlled crawl over fixture site
    const crawlRes = await fetch(`${cloudBaseUrl}/api/v1/index/crawl`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        seedUrls: [`${siteBaseUrl}/docs/atlas-crawler`],
        allowedDomains: ['127.0.0.1'],
        maxDepth: 2,
        maxPages: 10,
        perDomainDelayMs: 0,
        respectRobotsTxt: true,
        allowLocalhostForTest: true
      })
    });
    expect(crawlRes.status).toBe(200);
    const crawlData = (await crawlRes.json()) as {
      checkpoint: {
        status: string;
        indexedCount: number;
        visitedUrls: string[];
      };
    };
    expect(crawlData.checkpoint.status).toBe('completed');
    // Both /docs/atlas-crawler and /docs/self-hosted-ai from sitemap indexed; /private-admin disallowed by robots.txt; duplicate mirror deduplicated
    expect(crawlData.checkpoint.indexedCount).toBe(2);
    expect(await cloudRuntime.services.repo.getAtlasIndexDocument(`${siteBaseUrl}/private-admin/secrets`)).toBeNull();
    expect(await cloudRuntime.services.repo.getAtlasIndexDocument(`${siteBaseUrl}/docs/atlas-crawler`)).not.toBeNull();

    // 2. Query via GET /api/v1/search?q=... and verify Atlas Index labeling + self-hosted grounded AI citations
    const getSearchRes = await fetch(
      `${cloudBaseUrl}/api/v1/search?q=${encodeURIComponent('Atlas Crawler robots.txt SSRF')}&category=research&limit=5&allowLocalhost=true`
    );
    expect(getSearchRes.status).toBe(200);
    const searchData = (await getSearchRes.json()) as {
      results: Array<{ canonicalUrl: string; sourceOrigin: string; sourceProvider: string }>;
      pagination: { page: number; totalResults: number };
      indexStatus: { indexedDocuments: number; limitedCoverage: boolean };
      aiAnswer: {
        status: string;
        provider: string;
        claims: Array<{ sourceUrl: string; verifiedAgainstSource: boolean }>;
      };
      aiRuntimeStatus: { reachable: boolean; configuredModel: string };
    };
    expect(searchData.results.length).toBeGreaterThanOrEqual(1);
    expect(searchData.results[0].sourceOrigin).toBe('atlas_index');
    expect(searchData.results[0].canonicalUrl).toBe(`${siteBaseUrl}/docs/atlas-crawler`);
    expect(searchData.pagination.page).toBe(1);
    expect(searchData.indexStatus.indexedDocuments).toBe(2);
    expect(searchData.indexStatus.limitedCoverage).toBe(true);
    expect(searchData.aiAnswer.status).toBe('ok');
    expect(searchData.aiAnswer.provider).toBe('self_hosted');
    expect(searchData.aiAnswer.claims[0].verifiedAgainstSource).toBe(true);
    expect(searchData.aiRuntimeStatus.configuredModel).toBe('qwen2.5:7b-instruct');

    // 3. Content update detection on incremental re-crawl
    pageVersion = 2;
    const recrawlRes = await fetch(`${cloudBaseUrl}/api/v1/index/crawl`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        seedUrls: [`${siteBaseUrl}/docs/atlas-crawler`],
        allowedDomains: ['127.0.0.1'],
        maxDepth: 1,
        maxPages: 5,
        perDomainDelayMs: 0,
        allowLocalhostForTest: true
      })
    });
    const recrawlData = (await recrawlRes.json()) as { checkpoint: { updatedCount: number } };
    expect(recrawlData.checkpoint.updatedCount).toBeGreaterThanOrEqual(1);
    const updatedDoc = await cloudRuntime.services.repo.getAtlasIndexDocument(`${siteBaseUrl}/docs/atlas-crawler`);
    expect(updatedDoc?.title).toContain('v2');

    // 4. Document removal
    const delRes = await fetch(`${cloudBaseUrl}/api/v1/index/documents`, {
      method: 'DELETE',
      headers: authHeaders,
      body: JSON.stringify({ canonicalUrl: `${siteBaseUrl}/docs/atlas-crawler` })
    });
    expect(delRes.status).toBe(200);
    expect(await cloudRuntime.services.repo.getAtlasIndexDocument(`${siteBaseUrl}/docs/atlas-crawler`)).toBeNull();
  });

  it('supports local SQLite FTS5 first-party index CRUD, search, history clear, and consent-gated training JSONL export', async () => {
    const db = new AtlasDatabase(':memory:');
    const localIdx = new LocalSearchIndexService(db.db);

    const cp = await localIdx.crawlSeeds({
      seedUrls: [`${siteBaseUrl}/docs/self-hosted-ai`],
      allowedDomains: ['127.0.0.1'],
      maxDepth: 1,
      maxPages: 5,
      perDomainDelayMs: 0,
      allowLocalhostForTest: true
    });
    expect(cp.indexedCount).toBeGreaterThanOrEqual(1);

    const hits = localIdx.searchLocalIndex('Qwen2.5 Ollama locally');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].sourceProvider).toBe('atlas_first_party_index');

    // Search history respects private flag and clears cleanly
    localIdx.recordSearchHistory('private query', 'web', 1, true);
    localIdx.recordSearchHistory('public query', 'web', 1, false);
    expect(localIdx.listSearchHistory().length).toBe(1);
    localIdx.clearSearchHistory();
    expect(localIdx.listSearchHistory().length).toBe(0);

    // Document removal cleans up SQLite + FTS5
    expect(localIdx.removeDocument(`${siteBaseUrl}/docs/self-hosted-ai`)).toBe(true);
    expect(localIdx.searchLocalIndex('Qwen2.5 Ollama locally').length).toBe(0);
    db.close();

    // Consent-gated training data exporter rejects unconsented, private runs, and redacts secrets
    const mockRuns: AgentRun[] = [
      {
        id: 'r-priv',
        conversationId: 'c1',
        goal: 'Secret task',
        mode: 'agent',
        status: 'completed',
        subgoals: [],
        steps: [],
        finalAnswer: 'Done',
        totalInputTokens: 10,
        totalOutputTokens: 10,
        estimatedCostUsd: 0,
        isCostEstimated: false,
        model: 'qwen2.5:7b-instruct',
        provider: 'self_hosted',
        isPrivate: true,
        startedAt: 1000
      },
      {
        id: 'r-pub',
        conversationId: 'c1',
        goal: 'Summarize docs without key AIzaSySecretKey12345678901234',
        mode: 'ask',
        status: 'completed',
        subgoals: [],
        steps: [],
        finalAnswer: 'Docs summary completed safely.',
        totalInputTokens: 20,
        totalOutputTokens: 10,
        estimatedCostUsd: 0,
        isCostEstimated: false,
        model: 'qwen2.5:7b-instruct',
        provider: 'self_hosted',
        isPrivate: false,
        startedAt: 2000
      }
    ];
    expect(exportConsentedTrainingExamples({ runs: mockRuns, explicitUserConsent: false })).toEqual([]);
    const exported = exportConsentedTrainingExamples({ runs: mockRuns, explicitUserConsent: true });
    expect(exported.length).toBe(1);
    const jsonl = serializeToJsonl(exported);
    expect(jsonl).not.toContain('AIzaSySecretKey');
    expect(jsonl).toContain('[REDACTED_SECRET]');
  });
});

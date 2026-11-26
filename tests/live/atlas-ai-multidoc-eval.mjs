#!/usr/bin/env node
/**
 * Atlas AI — Multi-Document Real-World Live Evaluation (NO fixtures, NO Gemini)
 *
 * Crawls 3 real public documentation pages across 3 domains into PostgreSQL,
 * runs 5 evaluation queries (explicit detail, second domain, multi-doc, absent,
 * misleading keyword overlap), plus repeated-query cache latency check.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const API = 'http://127.0.0.1:48080';

const SEEDS = [
  {
    url: 'https://www.rfc-editor.org/rfc/rfc9309.html',
    domain: 'rfc-editor.org'
  },
  {
    url: 'https://www.postgresql.org/docs/current/textsearch-intro.html',
    domain: 'postgresql.org'
  },
  {
    url: 'https://httpwg.org/specs/rfc9111.html',
    domain: 'httpwg.org'
  }
];

const EVAL_CASES = [
  {
    id: 'explicit-detail-rfc9309',
    kind: 'explicit_present',
    query: 'What character encoding and Internet Media Type does RFC 9309 require for robots.txt?',
    expectStatus: 'ok'
  },
  {
    id: 'explicit-detail-postgres',
    kind: 'explicit_present_domain2',
    query: 'What is a tsvector in PostgreSQL full text search?',
    expectStatus: 'ok'
  },
  {
    id: 'multi-doc-caching',
    kind: 'multi_document',
    query: 'What do RFC 9309 and RFC 9111 say about caching?',
    expectStatus: 'ok'
  },
  {
    id: 'absent-from-index',
    kind: 'absent',
    query: 'What is the pricing and default TCP port of Mars Rover Telemetry v9?',
    expectStatus: 'insufficient_evidence'
  },
  {
    id: 'misleading-keyword-overlap',
    kind: 'misleading_overlap',
    query: 'Does RFC 9309 require robots.txt to be signed with OAuth2 and JSON-LD?',
    expectStatus: 'insufficient_evidence_or_negated'
  }
];

async function main() {
  console.log('=== ATLAS AI MULTI-DOCUMENT LIVE EVALUATION ===\n');

  const healthRes = await fetch(`${API}/health`);
  assert.ok(healthRes.ok, 'Backend /health failed');
  const health = await healthRes.json();
  assert.equal(health.storageMode, 'postgres');
  assert.equal(health.aiRuntime?.backendKind, 'self_hosted');
  assert.equal(health.aiRuntime?.reachable, true);
  console.log(`[OK] Runtime: ${health.aiRuntime.configuredModel} via ${health.aiRuntime.backendKind} (${health.aiRuntime.endpointUrl})`);

  const uid = `eval-${Date.now()}`;
  const regRes = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${uid}@test.local`, password: uid + '-pass-secure' })
  });
  assert.equal(regRes.status, 201);
  const { accessToken } = await regRes.json();
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };

  await fetch(`${API}/api/v1/consent`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ allowCloudSearch: true, allowCloudAi: true })
  });

  // Crawl all 3 public pages cleanly
  for (const seed of SEEDS) {
    await fetch(`${API}/api/v1/index/documents`, {
      method: 'DELETE',
      headers: auth,
      body: JSON.stringify({ canonicalUrl: seed.url })
    });
    const crawlRes = await fetch(`${API}/api/v1/index/crawl`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        seedUrls: [seed.url],
        allowedDomains: [seed.domain],
        maxDepth: 0,
        maxPages: 1,
        respectRobotsTxt: true
      })
    });
    const crawl = await crawlRes.json();
    console.log(`[CRAWL] ${seed.url} -> indexed=${crawl.checkpoint.indexedCount}, failed=${crawl.checkpoint.failedCount}`);
  }

  execFileSync('docker-compose', ['exec', '-T', 'redis', 'redis-cli', 'FLUSHDB']);

  const records = [];
  for (const tc of EVAL_CASES) {
    const started = Date.now();
    const res = await fetch(`${API}/api/v1/search`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        query: tc.query,
        mode: 'research',
        filters: { includeAiAnswer: true, limit: 6 },
        fetchFullPagesForCitations: true
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    const totalLatencyMs = Date.now() - started;

    const aa = data.aiAnswer;
    const record = {
      id: tc.id,
      kind: tc.kind,
      query: tc.query,
      retrievedDocs: data.results.map((r) => ({ id: r.id, url: r.url, origin: r.sourceOrigin })),
      passagesCount: aa?.passages?.length ?? 0,
      model: aa?.model,
      provider: aa?.provider,
      aiStatus: aa?.status,
      answer: aa?.summary,
      verifiedClaimsCount: aa?.claims?.filter((c) => c.verifiedAgainstSource).length ?? 0,
      unsupportedClaimsCount: aa?.unsupportedClaimsCount ?? 0,
      citations: aa?.citations ?? [],
      inputTokens: aa?.inputTokens ?? 0,
      outputTokens: aa?.outputTokens ?? 0,
      inferenceLatencyMs: aa?.latencyMs ?? 0,
      totalLatencyMs
    };
    records.push(record);
    console.log(
      `[EVAL] ${tc.id}: status=${record.aiStatus}, verified=${record.verifiedClaimsCount}, unsupported=${record.unsupportedClaimsCount}, tokens=${record.inputTokens}/${record.outputTokens}, aiMs=${record.inferenceLatencyMs}, totalMs=${record.totalLatencyMs}`
    );

    if (tc.expectStatus === 'ok') {
      assert.equal(aa?.status, 'ok', `${tc.id} expected status=ok, got ${aa?.status}: ${aa?.summary}`);
      assert.ok((record.verifiedClaimsCount ?? 0) >= 1, `${tc.id} expected >= 1 verified claim`);
    } else if (tc.expectStatus === 'insufficient_evidence') {
      assert.equal(aa?.status, 'insufficient_evidence', `${tc.id} expected insufficient_evidence`);
      assert.equal(record.verifiedClaimsCount, 0);
    }
  }

  // Repeated-question cache latency test
  const cacheStart = Date.now();
  const cachedRes = await fetch(`${API}/api/v1/search`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      query: EVAL_CASES[0].query,
      mode: 'research',
      filters: { includeAiAnswer: true, limit: 6 },
      fetchFullPagesForCitations: true
    })
  });
  const cachedData = await cachedRes.json();
  const cachedLatencyMs = Date.now() - cacheStart;
  console.log(`[CACHE] Repeated query cacheHit=${cachedData.cacheHit}, latencyMs=${cachedLatencyMs}`);

  await fetch(`${API}/api/v1/account`, { method: 'DELETE', headers: auth });

  console.log('\n=== MULTI-DOC LIVE EVAL SUMMARY JSON ===');
  console.log(JSON.stringify({ cachedLatencyMs, cacheHit: cachedData.cacheHit, records }, null, 2));
}

main().catch((err) => {
  console.error('MULTI-DOC LIVE EVAL FAILED:', err);
  process.exit(1);
});

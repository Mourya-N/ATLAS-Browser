import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const API = 'http://127.0.0.1:48080';

async function main() {
  console.log('=== PHASE 2/3/4/8: LIVE DOCKER + POSTGRES + REDIS + PUBLIC CRAWLER VERIFICATION ===');

  // 1. Health & Connectivity Check
  const healthRes = await fetch(`${API}/health`);
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.ok, true);
  assert.equal(health.storageMode, 'postgres');
  console.log('[OK] /health verified storageMode=postgres, aiConfigured=' + health.aiConfigured);

  // 2. Register user against live Postgres + Verify Rate Limit + Redis keys
  const uniqueEmail = `live-verify-${Date.now()}@lavraybrowser.dev`;
  const regRes = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: uniqueEmail,
      password: 'LiveVerifyPassword!2026',
      displayName: 'Live Postgres Verifier'
    })
  });
  assert.equal(regRes.status, 201);
  assert.ok(regRes.headers.get('x-ratelimit-limit'), 'Rate limit header missing');
  const session = await regRes.json();
  const auth = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`
  };
  console.log('[OK] Registered user in PostgreSQL & verified rate limit headers');

  // Enable consents for notes, bookmarks, search history, cloud search
  const consentRes = await fetch(`${API}/api/v1/profile/consent`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({
      syncBookmarks: true,
      syncNotes: true,
      syncSearchHistory: true,
      allowCloudSearch: true,
      allowCloudAi: true
    })
  });
  assert.equal(consentRes.status, 200);

  // 3. Controlled REAL public web crawl into PostgreSQL lavray_index_documents
  // Clear prior fixture rows (if re-running against persistent Docker volume) so fresh insert + deduplication both run cleanly.
  for (const url of ['https://example.com/', 'https://www.rfc-editor.org/rfc/rfc9309.html']) {
    await fetch(`${API}/api/v1/index/documents`, {
      method: 'DELETE',
      headers: auth,
      body: JSON.stringify({ canonicalUrl: url })
    });
  }

  // Uses IANA example.com and RFC 9309 (robots.txt specification) at maxDepth=0 so only 2 tiny public pages are crawled.
  const crawlStarted = Date.now();
  const crawlRes = await fetch(`${API}/api/v1/index/crawl`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      seedUrls: [
        'https://example.com/',
        'https://www.rfc-editor.org/rfc/rfc9309.html'
      ],
      allowedDomains: ['example.com', 'rfc-editor.org'],
      maxDepth: 0,
      maxPages: 2,
      perDomainDelayMs: 250,
      respectRobotsTxt: true
    })
  });
  assert.equal(crawlRes.status, 200);
  const crawlBody = await crawlRes.json();
  const crawlMs = Date.now() - crawlStarted;
  console.log('[OK] Live crawl finished in ' + crawlMs + 'ms:', JSON.stringify({
    status: crawlBody.checkpoint.status,
    indexedCount: crawlBody.checkpoint.indexedCount,
    updatedCount: crawlBody.checkpoint.updatedCount,
    skippedCount: crawlBody.checkpoint.skippedCount,
    failedCount: crawlBody.checkpoint.failedCount,
    errorSamples: crawlBody.checkpoint.errorSamples
  }));
  assert.equal(crawlBody.checkpoint.indexedCount, 2, 'Expected both real public pages freshly indexed');

  // Verify crawl checkpoint & documents stored directly in Postgres
  const pgCount = execFileSync('docker-compose', [
    'exec', '-T', 'postgres', 'psql', '-U', 'lavray', '-d', 'lavray_cloud', '-t', '-A',
    '-c', 'SELECT COUNT(*) FROM lavray_index_documents;'
  ]).toString().trim();
  const cpCount = execFileSync('docker-compose', [
    'exec', '-T', 'postgres', 'psql', '-U', 'lavray', '-d', 'lavray_cloud', '-t', '-A',
    '-c', 'SELECT COUNT(*) FROM crawl_checkpoints;'
  ]).toString().trim();
  console.log(`[OK] Postgres live rows -> lavray_index_documents=${pgCount}, crawl_checkpoints=${cpCount}`);
  assert.ok(Number(pgCount) >= 2);
  assert.ok(Number(cpCount) >= 1);

  // 4. Execute GET /api/v1/search against PostgreSQL tsvector + Redis Cache (with NO mock_search)
  const uniqueSuffix = Date.now().toString(36);
  const searchUrl = `${API}/api/v1/search?q=${encodeURIComponent(`robots exclusion crawler user-agent`)}&category=web&limit=5&page=1&_t=${uniqueSuffix}`;
  // Flush scache only in Redis so repeated test runs still test cold PG -> warm Redis hit cleanly
  execFileSync('docker-compose', ['exec', '-T', 'redis', 'redis-cli', 'FLUSHDB']);

  const s1Started = Date.now();
  const s1Res = await fetch(searchUrl, { headers: auth });
  assert.equal(s1Res.status, 200);
  const s1 = await s1Res.json();
  const s1Ms = Date.now() - s1Started;
  assert.equal(s1.cacheHit, false);
  assert.ok(!s1.providersQueried.includes('mock_search'), 'Docker Compose stack must NOT query mock_search by default');
  assert.ok(s1.results.some((r) => r.sourceOrigin === 'lavray_index'), 'Expected real first-party lavray_index result from Postgres');
  if (health.aiConfigured) {
    assert.ok(['ok', 'insufficient_evidence'].includes(s1.aiAnswer.status), `Expected valid AI answer status when aiConfigured=true, got ${s1.aiAnswer.status}`);
  } else {
    assert.equal(s1.aiAnswer.status, 'unavailable', 'Must stay honestly unavailable without model weights (never mock silently)');
  }

  // Repeat identical query -> verify Redis Search Cache HIT!
  const s2Started = Date.now();
  const s2Res = await fetch(searchUrl, { headers: auth });
  assert.equal(s2Res.status, 200);
  const s2 = await s2Res.json();
  const s2Ms = Date.now() - s2Started;
  assert.equal(s2.cacheHit, true, 'Expected Redis cacheHit=true on repeated query');
  console.log(`[OK] Search query verified -> live PG latency=${s1Ms}ms, Redis cached latency=${s2Ms}ms, providers=${JSON.stringify(s1.providersQueried)}, topTitle=${JSON.stringify(s1.results[0]?.title)}, indexDocs=${s1.indexStatus.indexedDocuments}`);

  const redisKeys = execFileSync('docker-compose', ['exec', '-T', 'redis', 'redis-cli', 'KEYS', 'lavray:*']).toString().trim();
  console.log('[OK] Redis active keys sample:\n' + redisKeys.split('\n').slice(0, 6).join('\n'));
  assert.ok(redisKeys.includes('lavray:rl:') && redisKeys.includes('lavray:scache:'));

  // 5. Enqueue real background worker job (`page_extract`) and verify lavray-cloud-worker processes it in Postgres
  const jobRes = await fetch(`${API}/api/v1/jobs`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      type: 'page_extract',
      payload: { url: 'https://example.com/' }
    })
  });
  assert.equal(jobRes.status, 202);
  const { job } = await jobRes.json();
  let jobDone = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const jobRow = execFileSync('docker-compose', [
      'exec', '-T', 'postgres', 'psql', '-U', 'lavray', '-d', 'lavray_cloud', '-t', '-A',
      '-c', `SELECT status FROM background_jobs WHERE id='${job.id}';`
    ]).toString().trim();
    if (jobRow === 'completed') {
      jobDone = true;
      break;
    }
  }
  assert.ok(jobDone, 'Worker did not complete background_job within 15s');
  console.log('[OK] Independent lavray-cloud-worker processed PostgreSQL job id=' + job.id);

  // 6. Security verification: live SSRF rejection against metadata & internal Docker services
  for (const badUrl of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:48080/health',
    'http://postgres:5432/',
    'http://10.0.0.1/'
  ]) {
    const ssrfRes = await fetch(`${API}/api/v1/research/extract`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ url: badUrl })
    });
    assert.equal(ssrfRes.status, 400, `Expected SSRF block HTTP 400 for ${badUrl}, got ${ssrfRes.status}`);
  }
  console.log('[OK] Live SSRF guard blocked metadata, localhost, internal container hostname, and RFC1918');

  // 7. Restart persistence: restart lavray-backend container & confirm indexed data + search still work cleanly!
  console.log('[INFO] Restarting lavray-backend container to verify PostgreSQL persistence...');
  execFileSync('docker-compose', ['restart', 'lavray-backend'], { stdio: 'inherit' });
  let ready = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const h = await fetch(`${API}/health`);
      if (h.ok) {
        ready = true;
        break;
      }
    } catch {}
  }
  assert.ok(ready, 'lavray-backend failed to become ready after restart');

  const postRestartStats = await (await fetch(`${API}/api/v1/index/stats`)).json();
  assert.ok(postRestartStats.stats.totalDocuments >= 1, 'Index documents did not persist across container restart');
  console.log('[OK] Post-restart indexStats persisted in PostgreSQL:', JSON.stringify(postRestartStats.stats));

  // 8. Verify metrics endpoint reports live Postgres + Redis connectivity & indexed count
  const obs = await (await fetch(`${API}/api/v1/observability/metrics`)).json();
  assert.equal(obs.storage.postgresConnected, true);
  assert.equal(obs.storage.redisConnected, true);
  console.log('[OK] Observability metrics verified:', JSON.stringify({
    storage: obs.storage,
    crawler: obs.crawler,
    worker: obs.worker,
    searchCacheHitRate: obs.search.cacheHitRate
  }));

  // 9. Test document deletion + cleanup test account
  const delDoc = await fetch(`${API}/api/v1/index/documents`, {
    method: 'DELETE',
    headers: auth,
    body: JSON.stringify({ canonicalUrl: 'https://example.com/' })
  });
  assert.equal(delDoc.status, 200);
  const delDocBody = await delDoc.json();
  assert.equal(delDocBody.removed, true, 'Expected deleted canonicalUrl https://example.com/ to return removed=true');
  const delAcc = await fetch(`${API}/api/v1/account`, { method: 'DELETE', headers: auth });
  assert.equal(delAcc.status, 200);
  console.log('[OK] Verified document removal (removed=true) and GDPR account deletion');
  console.log('=== LIVE DOCKER VERIFICATION PASSED 100% ===');
}

main().catch((err) => {
  console.error('LIVE VERIFICATION FAILED:', err);
  process.exit(1);
});

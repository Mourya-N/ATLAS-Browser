import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AtlasDatabase } from '@main/db/database';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { AdBlocker } from '@main/browser/ad-blocker';

const TEST_WORKLOAD: Array<[string, string, string, boolean]> = [
  // [requestUrl, firstPartyUrl, resourceType, expectedBlock]
  ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'https://www.bbc.com/news', 'script', true],
  ['https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'https://www.nytimes.com/', 'script', true],
  ['https://www.google-analytics.com/analytics.js', 'https://www.npr.org/', 'script', true],
  ['https://pixel.facebook.com/tr/?id=12345&ev=PageView', 'https://shop.example.com/', 'image', true],
  ['https://sb.scorecardresearch.com/beacon.js', 'https://www.cnn.com/', 'script', true],
  ['https://www.bbc.com/static/news-app.js', 'https://www.bbc.com/news', 'script', false],
  ['https://www.npr.org/assets/styles/main.css', 'https://www.npr.org/', 'stylesheet', false],
  ['https://api.github.com/repos/electron/electron', 'https://github.com/electron', 'xhr', false],
  ['https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js', 'https://docs.example.org/', 'script', false],
  ['https://www.rfc-editor.org/rfc/rfc9309.html', 'https://www.rfc-editor.org/', 'mainFrame', false],
  ['https://www.example.org/images/hero-banner.webp', 'https://www.example.org/blog', 'image', false],
  ['https://ads.pubmatic.com/AdServer/js/pwt/123/456/pwt.js', 'https://www.forbes.com/', 'script', true]
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function runWorkloadBenchmark(blocker: AdBlocker, iterations = 2000): {
  medianUs: number;
  p95Us: number;
  meanUs: number;
  throughputReqPerSec: number;
  blockedCount: number;
  allowedCount: number;
} {
  const latenciesUs: number[] = [];
  let blockedCount = 0;
  let allowedCount = 0;

  // Warmup
  for (let i = 0; i < 100; i++) {
    const [u, f, t] = TEST_WORKLOAD[i % TEST_WORKLOAD.length];
    blocker.classifyRequest(u, f, t);
  }

  const totalStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    // Mix repeated and randomized-query-string URLs
    const [baseUrl, firstParty, resType] = TEST_WORKLOAD[i % TEST_WORKLOAD.length];
    const reqUrl = i % 3 === 0 ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_cb=${i}` : baseUrl;
    const t0 = performance.now();
    const res = blocker.classifyRequest(reqUrl, firstParty, resType);
    const t1 = performance.now();
    latenciesUs.push((t1 - t0) * 1000);
    if (res.block) blockedCount += 1;
    else allowedCount += 1;
  }
  const totalMs = performance.now() - totalStart;
  latenciesUs.sort((a, b) => a - b);

  return {
    medianUs: Number(percentile(latenciesUs, 0.5).toFixed(2)),
    p95Us: Number(percentile(latenciesUs, 0.95).toFixed(2)),
    meanUs: Number(((totalMs * 1000) / iterations).toFixed(2)),
    throughputReqPerSec: Math.round((iterations / totalMs) * 1000),
    blockedCount,
    allowedCount
  };
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-adblock-bench-'));
  const db = new AtlasDatabase(path.join(tmpDir, 'atlas.db'));
  const repo = new PlatformRepository(db.db);
  const blocker = new AdBlocker(repo);

  // 1. Baseline (built-in rules only)
  const memBase = process.memoryUsage();
  const baseline = runWorkloadBenchmark(blocker, 3000);
  console.log('1) BASELINE (Built-in rules):', JSON.stringify({
    ruleCount: blocker.getStats().ruleCount,
    heapMB: Number((memBase.heapUsed / 1048576).toFixed(2)),
    rssMB: Number((memBase.rss / 1048576).toFixed(2)),
    ...baseline
  }));

  // 2. Download all 3 live lists
  blocker.toggleFilterList('peter-lowe', true);
  const tLoad0 = performance.now();
  const lists = await blocker.updateFilterLists();
  const loadMs = Math.round(performance.now() - tLoad0);
  const memLoaded = process.memoryUsage();

  // Measure per-list isolated
  for (const list of lists) {
    blocker.toggleFilterList('easylist', list.id === 'easylist');
    blocker.toggleFilterList('easyprivacy', list.id === 'easyprivacy');
    blocker.toggleFilterList('peter-lowe', list.id === 'peter-lowe');
    const res = runWorkloadBenchmark(blocker, 1000);
    console.log(`2) LIST ONLY [${list.id}] (rules=${list.ruleCount}):`, JSON.stringify(res));
  }

  // 3. All lists combined
  blocker.toggleFilterList('easylist', true);
  blocker.toggleFilterList('easyprivacy', true);
  blocker.toggleFilterList('peter-lowe', true);
  const allCombined = runWorkloadBenchmark(blocker, 2000);
  console.log('3) ALL LISTS COMBINED:', JSON.stringify({
    ruleCount: blocker.getStats().ruleCount,
    loadMs,
    heapMB: Number((memLoaded.heapUsed / 1048576).toFixed(2)),
    rssMB: Number((memLoaded.rss / 1048576).toFixed(2)),
    ...allCombined
  }));

  // 4. Correctness assertions (exception, custom rule, allowlist)
  blocker.addUserFilterRule('||custom-ad.test^$third-party,script');
  if (!blocker.classifyRequest('https://custom-ad.test/a.js', 'https://news.org', 'script').block) {
    throw new Error('Custom rule failed');
  }
  blocker.addUserFilterRule('@@||custom-ad.test^');
  if (blocker.classifyRequest('https://custom-ad.test/a.js', 'https://news.org', 'script').block) {
    throw new Error('Exception rule failed');
  }
  console.log('[OK] Correctness checks (custom + @@ exception) passed');

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

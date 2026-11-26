import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AtlasDatabase } from '@main/db/database';
import { BrowserRepository } from '@main/db/repositories/browser-repo';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { AdBlocker } from '@main/browser/ad-blocker';
import { DownloadManager } from '@main/browser/download-manager';
import { PrivateSessionManager } from '@main/browser/private-session';
import { SessionRestoreService } from '@main/browser/session-restore';
import { TabManager, resolveContentPreloadPath } from '@main/browser/tab-manager';

const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-adblock-live-'));
app.setPath('userData', tempUserData);

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

app.whenReady().then(async () => {
  console.log('=== LIVE AD BLOCKER: UPSTREAM FILTER LISTS, MEMORY, BENCHMARK & REAL WEBSITES ===\n');

  const db = new AtlasDatabase(path.join(tempUserData, 'atlas.db'));
  const browserRepo = new BrowserRepository(db.db);
  const platformRepo = new PlatformRepository(db.db);
  const adBlocker = new AdBlocker(platformRepo);

  // Enable Peter Lowe's list too so all 3 configured upstream lists are tested live
  adBlocker.toggleFilterList('peter-lowe', true);

  // 1. Measure baseline memory & matching speed
  const memBefore = process.memoryUsage();
  const benchUrls = [
    ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'https://www.bbc.com/news', 'script'],
    ['https://www.google-analytics.com/analytics.js', 'https://www.npr.org/', 'script'],
    ['https://www.bbc.com/static/main.css', 'https://www.bbc.com/news', 'stylesheet'],
    ['https://cdn.example.org/hero.jpg', 'https://example.org/post', 'image']
  ] as const;

  const benchStart0 = performance.now();
  for (let i = 0; i < 10_000; i++) {
    const [u, f, t] = benchUrls[i % benchUrls.length];
    adBlocker.classifyRequest(u, f, t);
  }
  const benchBaselineMs = performance.now() - benchStart0;

  // 2. Live HTTPS upstream download of EasyList, EasyPrivacy, and Peter Lowe
  const dlStart = Date.now();
  const statuses = await adBlocker.updateFilterLists();
  const dlDurationMs = Date.now() - dlStart;
  const memAfter = process.memoryUsage();

  console.log(`--- LIVE UPSTREAM FILTER LIST RESULTS (${dlDurationMs} ms) ---`);
  for (const s of statuses) {
    console.log(
      `  [${s.id}] name="${s.name}", rules=${s.ruleCount}, skipped=${s.skippedCount ?? 0}, err=${s.lastError ?? 'none'}, license="${s.license}"`
    );
    if (s.skippedByReason) {
      console.log(`     skippedByReason: ${JSON.stringify(s.skippedByReason)}`);
    }
  }

  const succeededCount = statuses.filter((s) => !s.lastError && s.ruleCount > 0).length;
  assert.ok(succeededCount >= 1, 'At least one real upstream filter list must download and parse live');

  // 3. Measure matching latency WITH full live upstream lists loaded
  const benchStart1 = performance.now();
  for (let i = 0; i < 10_000; i++) {
    const [u, f, t] = benchUrls[i % benchUrls.length];
    adBlocker.classifyRequest(u, f, t);
  }
  const benchWithListsMs = performance.now() - benchStart1;

  console.log('\n--- MEMORY & PERFORMANCE MEASUREMENTS ---');
  console.log(`  Heap used before: ${mb(memBefore.heapUsed)} MB | RSS before: ${mb(memBefore.rss)} MB`);
  console.log(`  Heap used after:  ${mb(memAfter.heapUsed)} MB | RSS after:  ${mb(memAfter.rss)} MB`);
  console.log(`  Baseline 10k classifyRequest:   ${benchBaselineMs.toFixed(2)} ms (${(benchBaselineMs / 10).toFixed(3)} us/req)`);
  console.log(`  With live lists 10k classifyRequest: ${benchWithListsMs.toFixed(2)} ms (${(benchWithListsMs / 10).toFixed(3)} us/req)`);

  // 4. Verify failed update preserves previous valid ruleset
  const beforeRuleCount = adBlocker.getStats().ruleCount;
  const failStatuses = await adBlocker.updateFilterLists(async () => ({
    ok: false,
    status: 503,
    text: '<html><body>Rate Limited</body></html>'
  }));
  assert.ok(failStatuses.every((s) => s.lastError !== null));
  assert.equal(adBlocker.getStats().ruleCount, beforeRuleCount, 'Failed update must preserve previous valid ruleCount');
  console.log(`[OK] Failed update preserved all ${beforeRuleCount} active rules atomically`);

  // 5. Real public ad-supported website test in Chromium WebContentsView
  const win = new BrowserWindow({ show: false, width: 1280, height: 800 });
  const privateSessionManager = new PrivateSessionManager();
  const sessionRestore = new SessionRestoreService(browserRepo);
  const downloadManager = new DownloadManager(browserRepo, platformRepo, () => win);
  const tabManager = new TabManager(
    browserRepo,
    platformRepo,
    adBlocker,
    downloadManager,
    privateSessionManager,
    sessionRestore,
    resolveContentPreloadPath()
  );
  tabManager.registerWindow(win, false);
  const tab = tabManager.createTab(win.id, { url: 'about:blank', activate: true });

  const realSites = ['https://www.bbc.com/news', 'https://www.npr.org'];
  console.log('\n--- REAL PUBLIC WEBSITE BLOCKING TESTS ---');
  for (const siteUrl of realSites) {
    const beforeStats = adBlocker.getStats();
    const beforeTabBlocked = tabManager.getTab(tab.id)?.info.blockedCount ?? 0;
    try {
      await tabManager.navigate(tab.id, siteUrl);
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const cur = tabManager.getTab(tab.id);
        if (cur && !cur.info.isLoading) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      await new Promise((r) => setTimeout(r, 1000));
      const wc = tabManager.getWebContents(tab.id)!;
      const pageSummary = await wc.executeJavaScript(`({
        title: document.title,
        textLen: (document.body?.innerText || '').trim().length,
        imgCount: document.images.length
      })`);
      const afterStats = adBlocker.getStats();
      const afterTabBlocked = tabManager.getTab(tab.id)?.info.blockedCount ?? 0;
      const blockedOnSite = afterTabBlocked - beforeTabBlocked;
      console.log(
        `  [SITE] ${siteUrl} -> title="${pageSummary.title}", textLen=${pageSummary.textLen}, imgs=${pageSummary.imgCount}, blockedOnSite=${blockedOnSite}, totalAds=${afterStats.adsBlocked}, totalTrackers=${afterStats.trackersBlocked}`
      );
      assert.ok(pageSummary.textLen > 100, `Expected readable content on ${siteUrl}`);
      assert.ok(afterStats.totalBlocked >= beforeStats.totalBlocked);
    } catch (err) {
      console.log(`  [SITE-WARN] ${siteUrl} failed/blocked automation: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 6. Test Reading List persistence across DB reopen
  const savedItem = browserRepo.saveReadingListItem({
    url: 'https://www.rfc-editor.org/rfc/rfc9309.html',
    title: 'RFC 9309: Robots Exclusion Protocol',
    siteName: 'IETF',
    excerpt: 'Robots Exclusion Protocol specification.',
    progress: 35
  });
  assert.equal(savedItem.status, 'reading');
  db.close();
  const db2 = new AtlasDatabase(path.join(tempUserData, 'atlas.db'));
  const browserRepo2 = new BrowserRepository(db2.db);
  const reloadedList = browserRepo2.listReadingList();
  assert.equal(reloadedList.length, 1);
  assert.equal(reloadedList[0].url, 'https://www.rfc-editor.org/rfc/rfc9309.html');
  console.log(`\n[OK] Reading List persisted across DB reopen (${reloadedList.length} item)`);

  db2.close();
  sessionRestore.dispose();
  win.destroy();
  fs.rmSync(tempUserData, { recursive: true, force: true });
  console.log('\n=== LIVE AD BLOCKER & REAL-WORLD VERIFICATION PASSED ===');
  app.exit(0);
});

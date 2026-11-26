import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AtlasDatabase } from '@main/db/database';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { AdBlocker } from '@main/browser/ad-blocker';
import { parseFilterListText, isSafeCssSelector } from '@main/browser/filter-parser';

describe('Native Atlas Ad Blocker & Cosmetic Filter Engine', () => {
  let tmpDir: string;
  let db: AtlasDatabase;
  let repo: PlatformRepository;
  let adBlocker: AdBlocker;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-adblock-test-'));
    db = new AtlasDatabase(path.join(tmpDir, 'atlas.db'));
    repo = new PlatformRepository(db.db);
    adBlocker = new AdBlocker(repo);
  });

  it('parses EasyList/EasyPrivacy network rules, exception rules, and rejects unsafe/malformed rules', () => {
    const sampleList = `
! Comment line
[Adblock Plus 2.0]
||ads.example.com^$third-party,script
@@||trusted.ads.example.com^$script
||tracker.example.org^$image,domain=news.com|~exempt.com
0.0.0.0 telemetry.badhost.net
/([a-z]+)+$/
##.ad-banner
news.com##.sponsored-card
news.com#@#.ad-banner
##div{background:url(javascript:alert(1))}
`;
    const parsed = parseFilterListText(sampleList);
    expect(parsed.networkRules.length).toBe(4);
    expect(parsed.cosmeticRules.length).toBe(3);
    expect(isSafeCssSelector('div{background:url(javascript:alert(1))}')).toBe(false);
    expect(isSafeCssSelector('.ad-banner')).toBe(true);
  });

  it('blocks ad/tracker domains, respects @@ exception rules, third-party, resource types, and allowlist', () => {
    // Built-in domain block
    const res1 = adBlocker.classifyRequest(
      'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
      'https://example.com/article',
      'script'
    );
    expect(res1.block).toBe(true);
    expect(res1.category).toBe('advertising');

    // Non-ad first-party request is NOT blocked
    const resOk = adBlocker.classifyRequest(
      'https://example.com/static/app.js',
      'https://example.com/article',
      'script'
    );
    expect(resOk.block).toBe(false);

    // User ABP rule with $third-party and $script
    expect(adBlocker.addUserFilterRule('||promo.cdn.test^$third-party,script')).toBe(true);
    expect(
      adBlocker.classifyRequest('https://promo.cdn.test/banner.js', 'https://news.org/', 'script').block
    ).toBe(true);
    // Not blocked for image when rule is $script
    expect(
      adBlocker.classifyRequest('https://promo.cdn.test/logo.png', 'https://news.org/', 'image').block
    ).toBe(false);

    // Exception rule @@ overrides block rule
    expect(adBlocker.addUserFilterRule('@@||promo.cdn.test^')).toBe(true);
    expect(
      adBlocker.classifyRequest('https://promo.cdn.test/banner.js', 'https://news.org/', 'script').block
    ).toBe(false);

    // Per-site allowlist & temporary disable
    adBlocker.toggleDomainAllowlist('example.com', true);
    expect(
      adBlocker.classifyRequest(
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://example.com/article',
        'script'
      ).block
    ).toBe(false);
    adBlocker.toggleDomainAllowlist('example.com', false);

    adBlocker.toggleTemporaryDisable('example.com', true);
    expect(
      adBlocker.classifyRequest(
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://example.com/article',
        'script'
      ).block
    ).toBe(false);
  });

  it('updates filter lists safely and preserves previous valid ruleset if an update fails', async () => {
    // 1. Successful update
    await adBlocker.updateFilterLists(async (url) => {
      if (url.includes('easylist.txt')) {
        return { ok: true, status: 200, text: '! EasyList\n||evil-ad-network.test^\n##.evil-ad-box\n' };
      }
      return { ok: true, status: 200, text: '! EasyPrivacy\n||evil-tracker.test^\n' };
    });

    expect(
      adBlocker.classifyRequest('https://evil-ad-network.test/ad.js', 'https://site.org', 'script').block
    ).toBe(true);
    expect(adBlocker.getCosmeticCssForUrl('https://site.org/page')).toContain('.evil-ad-box');

    // 2. Failed update (HTTP 503 / HTML error page) must preserve previous ruleset!
    const statuses = await adBlocker.updateFilterLists(async () => ({
      ok: false,
      status: 503,
      text: '<html><body>Service Unavailable</body></html>'
    }));

    expect(statuses.some((s) => s.lastError && s.lastError.includes('503'))).toBe(true);
    // Previous valid ruleset is still intact!
    expect(
      adBlocker.classifyRequest('https://evil-ad-network.test/ad.js', 'https://site.org', 'script').block
    ).toBe(true);
  });

  it('applies separate cosmetic filtering with per-site disable and broken site reports', () => {
    const css = adBlocker.getCosmeticCssForUrl('https://news.example.com/story');
    expect(css).toContain('.ad-banner');
    expect(css).toContain('display: none !important');

    adBlocker.cosmetic.toggleDomainDisabled('news.example.com', true);
    expect(adBlocker.getCosmeticCssForUrl('https://news.example.com/story')).toBeNull();

    adBlocker.reportBrokenSite('https://news.example.com/story', 'Sidebar hidden');
    expect(adBlocker.getStats().brokenSiteReportsCount).toBe(1);
  });
});

import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import {
  hostMatchesDomain,
  parseCosmeticRuleLine,
  type ParsedCosmeticRule
} from './filter-parser';

export interface BrokenSiteReport {
  url: string;
  hostname: string;
  reason: string;
  reportedAt: number;
}

const DEFAULT_COSMETIC_RULES = [
  '##.ad-banner',
  '##.ad-container',
  '##.ad-slot',
  '##.ad-wrapper',
  '##.ad-unit',
  '##.advertisement',
  '##[data-ad-slot]',
  '##[data-ad-unit]',
  '##[data-google-query-id]',
  '##ins.adsbygoogle',
  '##div[id^="div-gpt-ad"]',
  '##iframe[id^="google_ads_iframe"]',
  '##iframe[src*="doubleclick.net"]',
  '##iframe[src*="googlesyndication.com"]',
  '##.OUTBRAIN',
  '##[id^="taboola-"]',
  '##.trc_rbox_container',
  '##[aria-label="Advertisement"]',
  '##[aria-label="Sponsored Content"]',
  // YouTube ad slots & banners (preserves actual player video element)
  'youtube.com###player-ads',
  'youtube.com###masthead-ad',
  'youtube.com##ytd-ad-slot-renderer',
  'youtube.com##ytd-promoted-sparkles-web-renderer',
  'youtube.com##ytd-display-ad-renderer',
  'youtube.com##ytd-in-feed-ad-layout-renderer',
  'youtube.com##ytd-banner-promo-renderer',
  'youtube.com##ytd-action-companion-ad-renderer',
  'youtube.com##ytd-statement-banner-renderer',
  'youtube.com##.ytp-ad-overlay-container',
  'youtube.com##.ytp-ad-text-overlay'
];

/**
 * Separate cosmetic filtering engine.
 * Generates safe CSS hiding rules (`display: none !important`) for matched
 * selectors without altering network blocking or using AI guesses.
 */
export class CosmeticFilterEngine {
  private enabled: boolean;
  private disabledDomains: Set<string>;
  private rules: ParsedCosmeticRule[] = [];
  private customRules: ParsedCosmeticRule[] = [];
  private filterListRules: ParsedCosmeticRule[] = [];
  private brokenReports: BrokenSiteReport[];

  constructor(private readonly repo: PlatformRepository) {
    this.enabled = repo.getSetting<boolean>('adblock.cosmeticEnabled', true);
    this.disabledDomains = new Set(
      repo.getSetting<string[]>('adblock.cosmeticDisabledDomains', []).map((d) => d.toLowerCase())
    );
    this.brokenReports = repo.getSetting<BrokenSiteReport[]>('adblock.brokenSites', []);
    this.rebuildRules([]);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.repo.setSetting('adblock.cosmeticEnabled', enabled);
  }

  public isDomainDisabled(hostname: string): boolean {
    const clean = hostname.toLowerCase().trim();
    if (!clean) return false;
    for (const d of this.disabledDomains) {
      if (hostMatchesDomain(clean, d)) return true;
    }
    return false;
  }

  public toggleDomainDisabled(domain: string, disabled: boolean): void {
    const clean = domain.toLowerCase().trim();
    if (!clean) return;
    if (disabled) {
      this.disabledDomains.add(clean);
    } else {
      this.disabledDomains.delete(clean);
    }
    this.repo.setSetting('adblock.cosmeticDisabledDomains', Array.from(this.disabledDomains));
  }

  public getDisabledDomains(): string[] {
    return Array.from(this.disabledDomains);
  }

  public setCustomCosmeticRules(rawRules: string[]): void {
    this.customRules = rawRules
      .map((r) => parseCosmeticRuleLine(r))
      .filter((r): r is ParsedCosmeticRule => r !== null);
  }

  public setFilterListCosmeticRules(rules: ParsedCosmeticRule[]): void {
    this.filterListRules = rules;
  }

  private rebuildRules(listRules: ParsedCosmeticRule[]): void {
    this.rules = DEFAULT_COSMETIC_RULES
      .map((r) => parseCosmeticRuleLine(r))
      .filter((r): r is ParsedCosmeticRule => r !== null);
    this.filterListRules = listRules;
  }

  public getRuleCount(): number {
    return this.rules.length + this.customRules.length + this.filterListRules.length;
  }

  public getCssForHostname(hostname: string): string | null {
    if (!this.enabled) return null;
    const host = hostname.toLowerCase().trim();
    if (!host || this.isDomainDisabled(host)) return null;

    const all = [...this.rules, ...this.filterListRules, ...this.customRules];
    const hiddenSelectors = new Set<string>();
    const exceptedSelectors = new Set<string>();

    for (const rule of all) {
      const domainMatch =
        rule.domains.length === 0 || rule.domains.some((d) => hostMatchesDomain(host, d));
      const excluded = rule.excludedDomains.some((d) => hostMatchesDomain(host, d));
      if (!domainMatch || excluded) continue;

      if (rule.isException) {
        exceptedSelectors.add(rule.selector);
      } else {
        hiddenSelectors.add(rule.selector);
      }
    }

    for (const ex of exceptedSelectors) {
      hiddenSelectors.delete(ex);
    }

    if (hiddenSelectors.size === 0) return null;
    // Cap injected selectors to avoid layout/style thrash
    const bounded = Array.from(hiddenSelectors).slice(0, 1200);
    return `${bounded.join(',\n')} {\n  display: none !important;\n}`;
  }

  public shouldRunYouTubeAdHelper(hostname: string): boolean {
    if (!this.enabled) return false;
    const host = hostname.toLowerCase().trim();
    if (!host || this.isDomainDisabled(host)) return false;
    return host === 'youtube.com' || host.endsWith('.youtube.com');
  }

  public reportBrokenSite(url: string, reason = 'Layout or functionality broken with ad blocker'): BrokenSiteReport {
    let hostname = '';
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      hostname = url.slice(0, 120);
    }
    const report: BrokenSiteReport = {
      url: url.slice(0, 500),
      hostname,
      reason: reason.slice(0, 300),
      reportedAt: Date.now()
    };
    this.brokenReports.push(report);
    if (this.brokenReports.length > 100) {
      this.brokenReports = this.brokenReports.slice(-100);
    }
    this.repo.setSetting('adblock.brokenSites', this.brokenReports);
    return report;
  }

  public getBrokenReportsCount(): number {
    return this.brokenReports.length;
  }
}

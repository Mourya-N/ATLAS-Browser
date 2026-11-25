import type { Session } from 'electron';
import type { AdBlockStats } from '@shared/types';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';

export type TrackerCategory = 'advertising' | 'analytics' | 'social' | 'fingerprinting' | 'cryptomining';

interface BlockRule {
  domain: string;
  category: TrackerCategory;
}

const DEFAULT_BLOCK_RULES: BlockRule[] = [
  // Advertising & Ad Networks
  { domain: 'doubleclick.net', category: 'advertising' },
  { domain: 'googlesyndication.com', category: 'advertising' },
  { domain: 'googleadservices.com', category: 'advertising' },
  { domain: 'adservice.google.com', category: 'advertising' },
  { domain: 'pagead2.googlesyndication.com', category: 'advertising' },
  { domain: 'amazon-adsystem.com', category: 'advertising' },
  { domain: 'adnxs.com', category: 'advertising' },
  { domain: 'rubiconproject.com', category: 'advertising' },
  { domain: 'pubmatic.com', category: 'advertising' },
  { domain: 'openx.net', category: 'advertising' },
  { domain: 'criteo.com', category: 'advertising' },
  { domain: 'criteo.net', category: 'advertising' },
  { domain: 'taboola.com', category: 'advertising' },
  { domain: 'outbrain.com', category: 'advertising' },
  { domain: 'casalemedia.com', category: 'advertising' },
  { domain: 'indexww.com', category: 'advertising' },
  { domain: 'bidswitch.net', category: 'advertising' },
  { domain: 'adsrvr.org', category: 'advertising' },
  { domain: 'mediavine.com', category: 'advertising' },
  { domain: 'adthrive.com', category: 'advertising' },
  { domain: 'smartadserver.com', category: 'advertising' },
  { domain: 'advertising.com', category: 'advertising' },
  { domain: 'ads.yahoo.com', category: 'advertising' },
  { domain: 'adform.net', category: 'advertising' },
  { domain: 'rlcdn.com', category: 'advertising' },
  { domain: 'moatads.com', category: 'advertising' },
  { domain: 'serving-sys.com', category: 'advertising' },
  { domain: 'sharethrough.com', category: 'advertising' },
  { domain: 'triplelift.com', category: 'advertising' },
  { domain: 'yieldmo.com', category: 'advertising' },
  { domain: '33across.com', category: 'advertising' },
  { domain: 'spotxchange.com', category: 'advertising' },
  { domain: 'teads.tv', category: 'advertising' },
  { domain: 'zemanta.com', category: 'advertising' },
  { domain: 'revcontent.com', category: 'advertising' },
  { domain: 'mgid.com', category: 'advertising' },
  { domain: 'propellerads.com', category: 'advertising' },
  { domain: 'popads.net', category: 'advertising' },

  // Analytics & Telemetry
  { domain: 'google-analytics.com', category: 'analytics' },
  { domain: 'googletagmanager.com', category: 'analytics' },
  { domain: 'scorecardresearch.com', category: 'analytics' },
  { domain: 'quantserve.com', category: 'analytics' },
  { domain: 'mixpanel.com', category: 'analytics' },
  { domain: 'segment.io', category: 'analytics' },
  { domain: 'segment.com', category: 'analytics' },
  { domain: 'hotjar.com', category: 'analytics' },
  { domain: 'fullstory.com', category: 'analytics' },
  { domain: 'amplitude.com', category: 'analytics' },
  { domain: 'clarity.ms', category: 'analytics' },
  { domain: 'newrelic.com', category: 'analytics' },
  { domain: 'nr-data.net', category: 'analytics' },
  { domain: 'omtrdc.net', category: 'analytics' },
  { domain: 'demdex.net', category: 'analytics' },
  { domain: 'krxd.net', category: 'analytics' },
  { domain: 'bluekai.com', category: 'analytics' },
  { domain: 'chartbeat.com', category: 'analytics' },
  { domain: 'parsely.com', category: 'analytics' },
  { domain: 'mouseflow.com', category: 'analytics' },
  { domain: 'crazyegg.com', category: 'analytics' },
  { domain: 'luckyorange.com', category: 'analytics' },
  { domain: 'kissmetrics.com', category: 'analytics' },
  { domain: 'heapanalytics.com', category: 'analytics' },
  { domain: 'branch.io', category: 'analytics' },
  { domain: 'appsflyer.com', category: 'analytics' },
  { domain: 'adjust.com', category: 'analytics' },
  { domain: 'bugsnag.com', category: 'analytics' },

  // Social Trackers
  { domain: 'connect.facebook.net', category: 'social' },
  { domain: 'pixel.facebook.com', category: 'social' },
  { domain: 'ads-twitter.com', category: 'social' },
  { domain: 'analytics.twitter.com', category: 'social' },
  { domain: 'analytics.tiktok.com', category: 'social' },
  { domain: 'snap.licdn.com', category: 'social' },
  { domain: 'px.ads.linkedin.com', category: 'social' },
  { domain: 'ct.pinterest.com', category: 'social' },
  { domain: 'sc-static.net', category: 'social' },

  // Fingerprinting & Cryptomining
  { domain: 'fpjs.io', category: 'fingerprinting' },
  { domain: 'fingerprintjs.com', category: 'fingerprinting' },
  { domain: 'coin-hive.com', category: 'cryptomining' },
  { domain: 'coinhive.com', category: 'cryptomining' },
  { domain: 'cryptoloot.pro', category: 'cryptomining' }
];

const TRACKER_PATH_PATTERNS: RegExp[] = [
  /\/pagead\/(js|lvz|conversion)/i,
  /\/gampad\/ads/i,
  /\/adsense\/domains/i,
  /\/pixel\.(gif|png|js)(\?|$)/i,
  /\/tr\/\?id=\d+&ev=/i
];

export class AdBlocker {
  private globalEnabled: boolean;
  private allowlistedDomains: Set<string>;
  private domainRules = new Map<string, TrackerCategory>();
  private totalBlocked = 0;
  private attachedSessions = new WeakSet<Session>();
  private onBlockedCallbacks = new Set<(webContentsId: number, domain: string, category: TrackerCategory) => void>();

  constructor(private readonly repo: PlatformRepository) {
    this.globalEnabled = repo.getSetting<boolean>('adblock.enabled', true);
    const savedAllowlist = repo.getSetting<string[]>('adblock.allowlist', []);
    this.allowlistedDomains = new Set(savedAllowlist.map((d) => d.toLowerCase()));
    for (const rule of DEFAULT_BLOCK_RULES) {
      this.domainRules.set(rule.domain, rule.category);
    }
    const customRules = repo.getSetting<BlockRule[]>('adblock.customRules', []);
    for (const rule of customRules) {
      this.domainRules.set(rule.domain.toLowerCase(), rule.category);
    }
  }

  public onBlocked(cb: (webContentsId: number, domain: string, category: TrackerCategory) => void): () => void {
    this.onBlockedCallbacks.add(cb);
    return () => this.onBlockedCallbacks.delete(cb);
  }

  public setGlobalEnabled(enabled: boolean): void {
    this.globalEnabled = enabled;
    this.repo.setSetting('adblock.enabled', enabled);
  }

  public toggleDomainAllowlist(domain: string, allow: boolean): void {
    const clean = domain.toLowerCase().trim();
    if (allow) {
      this.allowlistedDomains.add(clean);
    } else {
      this.allowlistedDomains.delete(clean);
    }
    this.repo.setSetting('adblock.allowlist', Array.from(this.allowlistedDomains));
  }

  public addCustomRule(domain: string, category: TrackerCategory = 'advertising'): void {
    const clean = domain.toLowerCase().trim();
    this.domainRules.set(clean, category);
    const custom = this.repo.getSetting<BlockRule[]>('adblock.customRules', []);
    custom.push({ domain: clean, category });
    this.repo.setSetting('adblock.customRules', custom);
  }

  public classifyRequest(
    requestUrl: string,
    firstPartyUrl: string,
    resourceType: string
  ): { block: boolean; category?: TrackerCategory; matchedDomain?: string } {
    if (!this.globalEnabled) return { block: false };
    // Never block top-level document navigations so false positives don't break user-clicked links
    if (resourceType === 'mainFrame') return { block: false };

    let reqHost = '';
    let firstHost = '';
    try {
      const reqParsed = new URL(requestUrl);
      if (reqParsed.protocol !== 'http:' && reqParsed.protocol !== 'https:') {
        return { block: false };
      }
      reqHost = reqParsed.hostname.toLowerCase();
      if (firstPartyUrl) {
        firstHost = new URL(firstPartyUrl).hostname.toLowerCase();
      }
    } catch {
      return { block: false };
    }

    if (firstHost && this.isDomainAllowlisted(firstHost)) {
      return { block: false };
    }

    // Match request domain or any parent domain against blocklist
    const parts = reqHost.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const candidate = parts.slice(i).join('.');
      const category = this.domainRules.get(candidate);
      if (category) {
        return { block: true, category, matchedDomain: candidate };
      }
    }

    // Third-party tracking pixel / ad script URL pattern check
    if (firstHost && reqHost !== firstHost) {
      for (const regex of TRACKER_PATH_PATTERNS) {
        if (regex.test(requestUrl)) {
          return { block: true, category: 'advertising', matchedDomain: reqHost };
        }
      }
    }

    return { block: false };
  }

  private isDomainAllowlisted(host: string): boolean {
    if (this.allowlistedDomains.has(host)) return true;
    for (const d of this.allowlistedDomains) {
      if (host.endsWith(`.${d}`)) return true;
    }
    return false;
  }

  public attachToSession(sess: Session): void {
    if (this.attachedSessions.has(sess)) return;
    this.attachedSessions.add(sess);

    sess.webRequest.onBeforeRequest((details, callback) => {
      const firstPartyUrl = details.referrer || details.webContents?.getURL() || '';
      const result = this.classifyRequest(details.url, firstPartyUrl, details.resourceType);
      if (result.block) {
        this.totalBlocked += 1;
        const wcId = details.webContentsId ?? -1;
        for (const cb of this.onBlockedCallbacks) {
          cb(wcId, result.matchedDomain || '', result.category || 'advertising');
        }
        callback({ cancel: true });
        return;
      }
      callback({ cancel: false });
    });
  }

  public getStats(): AdBlockStats {
    return {
      globalEnabled: this.globalEnabled,
      totalBlocked: this.totalBlocked,
      ruleCount: this.domainRules.size + TRACKER_PATH_PATTERNS.length,
      allowlistedDomains: Array.from(this.allowlistedDomains)
    };
  }
}

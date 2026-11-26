import type { Session } from 'electron';
import type { AdBlockStats, FilterListStatus } from '@shared/types';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import {
  hostMatchesDomain,
  mapElectronResourceType,
  matchesNetworkRule,
  parseFilterListText,
  parseNetworkRuleLine,
  type ParsedCosmeticRule,
  type ParsedNetworkRule
} from './filter-parser';
import { CosmeticFilterEngine, type BrokenSiteReport } from './cosmetic-filter';

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

const DEFAULT_FILTER_LISTS: FilterListStatus[] = [
  {
    id: 'easylist',
    name: 'EasyList (Ads)',
    category: 'advertising',
    url: 'https://easylist.to/easylist/easylist.txt',
    license: 'GPLv3 / CC BY-SA 3.0',
    attribution: 'EasyList Authors (easylist.to)',
    enabled: true,
    ruleCount: 0,
    lastUpdatedAt: null,
    lastError: null
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy (Trackers)',
    category: 'privacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    license: 'GPLv3 / CC BY-SA 3.0',
    attribution: 'EasyList Authors (easylist.to)',
    enabled: true,
    ruleCount: 0,
    lastUpdatedAt: null,
    lastError: null
  },
  {
    id: 'peter-lowe',
    name: "Peter Lowe's Ad & Tracking List",
    category: 'privacy',
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
    license: 'Free for use with attribution',
    attribution: 'Peter Lowe (pgl.yoyo.org)',
    enabled: false,
    ruleCount: 0,
    lastUpdatedAt: null,
    lastError: null
  }
];

const MAX_FILTER_LIST_BYTES = 12 * 1024 * 1024; // 12 MB streaming safety cap

interface CompiledListCache {
  networkRuleCount: number;
  domainIndex: Map<string, ParsedNetworkRule[]>;
  exceptionDomainIndex: Map<string, ParsedNetworkRule[]>;
  tokenIndex: Map<string, ParsedNetworkRule[]>;
  exceptionTokenIndex: Map<string, ParsedNetworkRule[]>;
  patternRules: ParsedNetworkRule[];
  exceptionPatternRules: ParsedNetworkRule[];
  cosmeticRules: ParsedCosmeticRule[];
  category: TrackerCategory;
}

function addToIndex(map: Map<string, ParsedNetworkRule[]>, key: string, rule: ParsedNetworkRule): void {
  const arr = map.get(key);
  if (arr) arr.push(rule);
  else map.set(key, [rule]);
}

function buildCompiledListCache(
  networkRules: ParsedNetworkRule[],
  cosmeticRules: ParsedCosmeticRule[],
  category: TrackerCategory
): CompiledListCache {
  const domainIndex = new Map<string, ParsedNetworkRule[]>();
  const exceptionDomainIndex = new Map<string, ParsedNetworkRule[]>();
  const tokenIndex = new Map<string, ParsedNetworkRule[]>();
  const exceptionTokenIndex = new Map<string, ParsedNetworkRule[]>();
  const patternRules: ParsedNetworkRule[] = [];
  const exceptionPatternRules: ParsedNetworkRule[] = [];
  const seenRaw = new Set<string>();
  let dedupedCount = 0;

  for (const rule of networkRules) {
    if (seenRaw.has(rule.raw)) continue;
    seenRaw.add(rule.raw);
    dedupedCount += 1;

    if (rule.domainAnchor) {
      addToIndex(rule.isException ? exceptionDomainIndex : domainIndex, rule.domainAnchor, rule);
    } else if (rule.indexToken) {
      addToIndex(rule.isException ? exceptionTokenIndex : tokenIndex, rule.indexToken, rule);
    } else if (rule.isException) {
      exceptionPatternRules.push(rule);
    } else {
      patternRules.push(rule);
    }
  }

  return {
    networkRuleCount: dedupedCount,
    domainIndex,
    exceptionDomainIndex,
    tokenIndex,
    exceptionTokenIndex,
    patternRules,
    exceptionPatternRules,
    cosmeticRules,
    category
  };
}

function sanitizeFilterListError(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'Filter list update failed';
  // Never expose local filesystem paths or internal stack details
  if (/[/\\](Users|home|var|tmp|etc|app)[/\\]/i.test(msg)) {
    return 'Filter list update failed due to an internal I/O error';
  }
  return msg.slice(0, 180);
}

export class AdBlocker {
  private globalEnabled: boolean;
  private allowlistedDomains: Set<string>;
  private temporaryDisabledDomains = new Set<string>();
  private domainRules = new Map<string, TrackerCategory>();
  private userRawRules: string[] = [];
  private userBlockRules: ParsedNetworkRule[] = [];
  private userExceptionRules: ParsedNetworkRule[] = [];
  private listCaches = new Map<string, CompiledListCache>();
  private filterLists: FilterListStatus[] = [];
  private totalBlocked = 0;
  private adsBlocked = 0;
  private trackersBlocked = 0;
  private attachedSessions = new WeakSet<Session>();
  private onBlockedCallbacks = new Set<
    (webContentsId: number, domain: string, category: TrackerCategory, requestUrl: string) => void
  >();
  public readonly cosmetic: CosmeticFilterEngine;

  constructor(private readonly repo: PlatformRepository) {
    this.cosmetic = new CosmeticFilterEngine(repo);
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

    this.userRawRules = repo.getSetting<string[]>('adblock.userFilterRules', []);
    this.recompileUserRules();

    const savedLists = repo.getSetting<FilterListStatus[]>('adblock.filterLists', []);
    this.filterLists = DEFAULT_FILTER_LISTS.map((def) => {
      const existing = savedLists.find((s) => s.id === def.id);
      return existing ? { ...def, ...existing } : { ...def };
    });

    // Restore cached filter list texts safely if previously downloaded
    for (const list of this.filterLists) {
      if (!list.enabled) continue;
      const cachedText = repo.getSetting<string | null>(`adblock.listText.${list.id}`, null);
      if (cachedText) {
        const parsed = parseFilterListText(cachedText);
        const cat: TrackerCategory = list.category === 'advertising' ? 'advertising' : 'analytics';
        this.listCaches.set(list.id, buildCompiledListCache(parsed.networkRules, parsed.cosmeticRules, cat));
        list.ruleCount = parsed.networkRules.length + parsed.cosmeticRules.length;
        list.skippedCount = parsed.skippedCount;
        list.skippedByReason = parsed.skippedByReason;
      }
    }
    this.syncCosmeticFilterListRules();
  }

  private recompileUserRules(): void {
    const blocks: ParsedNetworkRule[] = [];
    const exceptions: ParsedNetworkRule[] = [];
    const cosmeticLines: string[] = [];

    for (const raw of this.userRawRules) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (trimmed.includes('##') || trimmed.includes('#@#')) {
        cosmeticLines.push(trimmed);
        continue;
      }
      // Also support bare domain like "ads.example.com" -> `||ads.example.com^`
      const normalized =
        !trimmed.startsWith('||') &&
        !trimmed.startsWith('@@') &&
        !trimmed.startsWith('|') &&
        /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)
          ? `||${trimmed}^`
          : trimmed;

      const parsed = parseNetworkRuleLine(normalized);
      if (parsed) {
        if (parsed.isException) {
          exceptions.push(parsed);
        } else {
          blocks.push(parsed);
        }
      }
    }

    this.userBlockRules = blocks;
    this.userExceptionRules = exceptions;
    this.cosmetic.setCustomCosmeticRules(cosmeticLines);
  }

  private syncCosmeticFilterListRules(): void {
    const allCosmetic: ParsedCosmeticRule[] = [];
    for (const list of this.filterLists) {
      if (!list.enabled) continue;
      const cache = this.listCaches.get(list.id);
      if (cache) {
        allCosmetic.push(...cache.cosmeticRules);
      }
    }
    this.cosmetic.setFilterListCosmeticRules(allCosmetic);
  }

  public onBlocked(
    cb: (webContentsId: number, domain: string, category: TrackerCategory, requestUrl: string) => void
  ): () => void {
    this.onBlockedCallbacks.add(cb);
    return () => this.onBlockedCallbacks.delete(cb);
  }

  public setGlobalEnabled(enabled: boolean): void {
    this.globalEnabled = enabled;
    this.repo.setSetting('adblock.enabled', enabled);
  }

  public toggleDomainAllowlist(domain: string, allow: boolean): void {
    const clean = domain.toLowerCase().trim();
    if (!clean) return;
    if (allow) {
      this.allowlistedDomains.add(clean);
    } else {
      this.allowlistedDomains.delete(clean);
    }
    this.repo.setSetting('adblock.allowlist', Array.from(this.allowlistedDomains));
  }

  public toggleTemporaryDisable(domain: string, disabled: boolean): void {
    const clean = domain.toLowerCase().trim();
    if (!clean) return;
    if (disabled) {
      this.temporaryDisabledDomains.add(clean);
    } else {
      this.temporaryDisabledDomains.delete(clean);
    }
  }

  public addCustomRule(domain: string, category: TrackerCategory = 'advertising'): void {
    const clean = domain.toLowerCase().trim();
    if (!clean) return;
    this.domainRules.set(clean, category);
    const custom = this.repo.getSetting<BlockRule[]>('adblock.customRules', []);
    custom.push({ domain: clean, category });
    this.repo.setSetting('adblock.customRules', custom);
  }

  public addUserFilterRule(rawRule: string): boolean {
    const trimmed = rawRule.trim();
    if (!trimmed) return false;
    if (trimmed.includes('##') || trimmed.includes('#@#')) {
      if (!this.userRawRules.includes(trimmed)) {
        this.userRawRules.push(trimmed);
        this.repo.setSetting('adblock.userFilterRules', this.userRawRules);
        this.recompileUserRules();
      }
      return true;
    }

    const normalized =
      !trimmed.startsWith('||') &&
      !trimmed.startsWith('@@') &&
      !trimmed.startsWith('|') &&
      /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)
        ? `||${trimmed}^`
        : trimmed;
    const parsed = parseNetworkRuleLine(normalized);
    if (!parsed) return false;

    if (!this.userRawRules.includes(trimmed)) {
      this.userRawRules.push(trimmed);
      this.repo.setSetting('adblock.userFilterRules', this.userRawRules);
      this.recompileUserRules();
    }
    return true;
  }

  public removeUserFilterRule(rawRule: string): void {
    const trimmed = rawRule.trim();
    this.userRawRules = this.userRawRules.filter((r) => r !== trimmed);
    this.repo.setSetting('adblock.userFilterRules', this.userRawRules);
    this.recompileUserRules();
  }

  public toggleFilterList(listId: string, enabled: boolean): void {
    const target = this.filterLists.find((l) => l.id === listId);
    if (!target) return;
    target.enabled = enabled;
    this.repo.setSetting('adblock.filterLists', this.filterLists);
    this.syncCosmeticFilterListRules();
  }

  /**
   * Safely downloads and parses enabled HTTPS filter lists.
   * Preserves the previous valid ruleset atomically if any fetch/validation fails.
   */
  public async updateFilterLists(
    fetcher?: (url: string) => Promise<{ ok: boolean; status: number; text: string }>
  ): Promise<FilterListStatus[]> {
    const doFetch =
      fetcher ??
      (async (url: string) => {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') {
          throw new Error('Only HTTPS filter list URLs are allowed');
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
          const res = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'User-Agent': 'AtlasBrowser/1.0 (+https://atlasbrowser.local)' }
          });
          if (!res.ok) {
            return { ok: false, status: res.status, text: '' };
          }

          // Enforce size limit while streaming chunks (before buffering entire response)
          if (!res.body) {
            const text = await res.text();
            if (Buffer.byteLength(text, 'utf8') > MAX_FILTER_LIST_BYTES) {
              throw new Error(`Filter list exceeds ${MAX_FILTER_LIST_BYTES / (1024 * 1024)} MB streaming limit`);
            }
            return { ok: true, status: res.status, text };
          }

          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let totalBytes = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              totalBytes += value.byteLength;
              if (totalBytes > MAX_FILTER_LIST_BYTES) {
                await reader.cancel().catch(() => {});
                throw new Error(`Filter list exceeds ${MAX_FILTER_LIST_BYTES / (1024 * 1024)} MB streaming limit`);
              }
              chunks.push(value);
            }
          }
          const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)));
          return { ok: true, status: res.status, text: combined.toString('utf8') };
        } finally {
          clearTimeout(timer);
        }
      });

    for (const list of this.filterLists) {
      if (!list.enabled) continue;
      // Validate trusted HTTPS URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(list.url);
        if (parsedUrl.protocol !== 'https:') {
          list.lastError = 'Rejected non-HTTPS filter list URL';
          continue;
        }
      } catch {
        list.lastError = 'Invalid filter list URL';
        continue;
      }

      try {
        const res = await doFetch(list.url);
        if (!res.ok) {
          list.lastError = `HTTP ${res.status} while fetching filter list`;
          continue;
        }
        if (Buffer.byteLength(res.text, 'utf8') > MAX_FILTER_LIST_BYTES) {
          list.lastError = `Filter list exceeds ${MAX_FILTER_LIST_BYTES / (1024 * 1024)} MB safety limit`;
          continue;
        }
        const headLower = res.text.slice(0, 500).toLowerCase();
        if (headLower.includes('<!doctype html') || headLower.includes('<html') || headLower.includes('<script')) {
          list.lastError = 'Rejected unexpected HTML/script response instead of filter list';
          continue;
        }

        const parsed = parseFilterListText(res.text);
        if (parsed.networkRules.length === 0 && parsed.cosmeticRules.length === 0) {
          list.lastError = 'Filter list contained zero valid rules; keeping previous ruleset';
          continue;
        }

        // Atomic swap: only overwrite cache and metadata after successful parse
        const cat: TrackerCategory = list.category === 'advertising' ? 'advertising' : 'analytics';
        this.listCaches.set(list.id, buildCompiledListCache(parsed.networkRules, parsed.cosmeticRules, cat));
        // Persist bounded text if small enough for settings JSON (< 4 MB)
        if (res.text.length < 4 * 1024 * 1024) {
          this.repo.setSetting(`adblock.listText.${list.id}`, res.text);
        }
        list.ruleCount = parsed.networkRules.length + parsed.cosmeticRules.length;
        list.skippedCount = parsed.skippedCount;
        list.skippedByReason = parsed.skippedByReason;
        list.lastUpdatedAt = Date.now();
        list.lastError = null;
      } catch (err) {
        // Preserve previous valid ruleset on failure and sanitize message
        list.lastError = sanitizeFilterListError(err);
      }
    }

    this.repo.setSetting('adblock.filterLists', this.filterLists);
    this.syncCosmeticFilterListRules();
    return this.filterLists.map((l) => ({ ...l }));
  }

  public getCosmeticCssForUrl(pageUrl: string): string | null {
    if (!this.globalEnabled) return null;
    try {
      const parsed = new URL(pageUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      const host = parsed.hostname.toLowerCase();
      if (this.isDomainAllowlisted(host) || this.isDomainTempDisabled(host)) {
        return null;
      }
      return this.cosmetic.getCssForHostname(host);
    } catch {
      return null;
    }
  }

  public reportBrokenSite(url: string, reason?: string): BrokenSiteReport {
    return this.cosmetic.reportBrokenSite(url, reason);
  }

  public classifyRequest(
    requestUrl: string,
    firstPartyUrl: string,
    resourceType: string
  ): { block: boolean; category?: TrackerCategory; matchedDomain?: string; matchedRule?: string } {
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

    if (firstHost && (this.isDomainAllowlisted(firstHost) || this.isDomainTempDisabled(firstHost))) {
      return { block: false };
    }

    const mappedType = mapElectronResourceType(resourceType);
    const isThirdParty = Boolean(firstHost && reqHost !== firstHost && !this.isSameSite(reqHost, firstHost));
    const matchCtx = {
      requestUrl,
      reqHost,
      firstHost,
      isThirdParty,
      resourceType: mappedType
    };

    const parts = reqHost.split('.');
    const hostCandidates: string[] = [];
    for (let i = 0; i < parts.length - 1; i++) {
      hostCandidates.push(parts.slice(i).join('.'));
    }
    if (hostCandidates.length === 0 && reqHost) hostCandidates.push(reqHost);

    // 1. Check user & filter-list exception (`@@`) rules first (allowlist precedence)
    for (const exRule of this.userExceptionRules) {
      if (matchesNetworkRule(exRule, matchCtx)) {
        return { block: false };
      }
    }

    const urlTokens = requestUrl.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];

    for (const list of this.filterLists) {
      if (!list.enabled) continue;
      const cache = this.listCaches.get(list.id);
      if (!cache) continue;
      for (const candidate of hostCandidates) {
        const exBucket = cache.exceptionDomainIndex.get(candidate);
        if (exBucket) {
          for (const rule of exBucket) {
            if (matchesNetworkRule(rule, matchCtx)) return { block: false };
          }
        }
      }
      for (const tok of urlTokens) {
        const exTokBucket = cache.exceptionTokenIndex.get(tok);
        if (exTokBucket) {
          for (const rule of exTokBucket) {
            if (matchesNetworkRule(rule, matchCtx)) return { block: false };
          }
        }
      }
      for (const rule of cache.exceptionPatternRules) {
        if (matchesNetworkRule(rule, matchCtx)) {
          return { block: false };
        }
      }
    }

    // 2. Check user-defined blocking rules
    for (const uRule of this.userBlockRules) {
      if (matchesNetworkRule(uRule, matchCtx)) {
        return {
          block: true,
          category: 'advertising',
          matchedDomain: uRule.domainAnchor || reqHost,
          matchedRule: uRule.raw
        };
      }
    }

    // 3. Match request domain or any parent domain against built-in/custom domain blocklist
    for (const candidate of hostCandidates) {
      const category = this.domainRules.get(candidate);
      if (category) {
        return { block: true, category, matchedDomain: candidate };
      }
    }

    // 4. Third-party tracking pixel / ad script URL pattern check
    if (firstHost && reqHost !== firstHost) {
      for (const regex of TRACKER_PATH_PATTERNS) {
        if (regex.test(requestUrl)) {
          return { block: true, category: 'advertising', matchedDomain: reqHost };
        }
      }
    }

    // 5. Check compiled filter list blocking rules (O(labels) domain index + token inverted index + fallback)
    for (const list of this.filterLists) {
      if (!list.enabled) continue;
      const cache = this.listCaches.get(list.id);
      if (!cache) continue;
      for (const candidate of hostCandidates) {
        const blockBucket = cache.domainIndex.get(candidate);
        if (blockBucket) {
          for (const rule of blockBucket) {
            if (matchesNetworkRule(rule, matchCtx)) {
              return {
                block: true,
                category: cache.category,
                matchedDomain: rule.domainAnchor || reqHost,
                matchedRule: rule.raw
              };
            }
          }
        }
      }
      for (const tok of urlTokens) {
        const tokBucket = cache.tokenIndex.get(tok);
        if (tokBucket) {
          for (const rule of tokBucket) {
            if (matchesNetworkRule(rule, matchCtx)) {
              return {
                block: true,
                category: cache.category,
                matchedDomain: reqHost,
                matchedRule: rule.raw
              };
            }
          }
        }
      }
      for (const rule of cache.patternRules) {
        if (matchesNetworkRule(rule, matchCtx)) {
          return {
            block: true,
            category: cache.category,
            matchedDomain: reqHost,
            matchedRule: rule.raw
          };
        }
      }
    }

    return { block: false };
  }

  private isSameSite(hostA: string, hostB: string): boolean {
    if (hostA === hostB) return true;
    const partsA = hostA.split('.');
    const partsB = hostB.split('.');
    if (partsA.length >= 2 && partsB.length >= 2) {
      return partsA.slice(-2).join('.') === partsB.slice(-2).join('.');
    }
    return false;
  }

  private isDomainAllowlisted(host: string): boolean {
    if (this.allowlistedDomains.has(host)) return true;
    for (const d of this.allowlistedDomains) {
      if (hostMatchesDomain(host, d)) return true;
    }
    return false;
  }

  private isDomainTempDisabled(host: string): boolean {
    if (this.temporaryDisabledDomains.has(host)) return true;
    for (const d of this.temporaryDisabledDomains) {
      if (hostMatchesDomain(host, d)) return true;
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
        const cat = result.category || 'advertising';
        if (cat === 'advertising') {
          this.adsBlocked += 1;
        } else {
          this.trackersBlocked += 1;
        }
        const wcId = details.webContentsId ?? -1;
        for (const cb of this.onBlockedCallbacks) {
          cb(wcId, result.matchedDomain || '', cat, details.url);
        }
        callback({ cancel: true });
        return;
      }
      callback({ cancel: false });
    });
  }

  public getStats(): AdBlockStats {
    let listRuleCount = 0;
    for (const list of this.filterLists) {
      if (list.enabled) {
        listRuleCount += this.listCaches.get(list.id)?.networkRuleCount ?? 0;
      }
    }
    return {
      globalEnabled: this.globalEnabled,
      totalBlocked: this.totalBlocked,
      adsBlocked: this.adsBlocked,
      trackersBlocked: this.trackersBlocked,
      ruleCount: this.domainRules.size + TRACKER_PATH_PATTERNS.length + this.userBlockRules.length + listRuleCount,
      allowlistedDomains: Array.from(this.allowlistedDomains),
      temporaryDisabledDomains: Array.from(this.temporaryDisabledDomains),
      cosmeticEnabled: this.cosmetic.isEnabled(),
      cosmeticRuleCount: this.cosmetic.getRuleCount(),
      cosmeticDisabledDomains: this.cosmetic.getDisabledDomains(),
      customRules: [...this.userRawRules],
      filterLists: this.filterLists.map((l) => ({ ...l })),
      brokenSiteReportsCount: this.cosmetic.getBrokenReportsCount()
    };
  }
}

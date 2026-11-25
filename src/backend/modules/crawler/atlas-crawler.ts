import { createHash, randomUUID } from 'node:crypto';
import type {
  AtlasIndexDocument,
  CrawlCheckpoint,
  CrawlSeedConfig
} from '@shared/types';
import { computeLocalEmbedding } from '@main/memory/memory-service';
import type { CloudRepository } from '../../db/repository';
import { SsrfGuard } from '../../security/ssrf-guard';
import type { ResearchExtractorService } from '../research/research-extractor';
import { sanitizeAndCanonicalizeUrl } from '../search/ranking';

interface ParsedRobots {
  rules: Array<{ allow: boolean; path: string }>;
  crawlDelayMs: number;
  sitemaps: string[];
  fetchedAt: number;
}

const DOC_HOST_HINTS = ['.gov', '.edu', 'postgresql.org', 'electronjs.org', 'owasp.org', 'nodejs.org', 'kubernetes.io', 'developer.mozilla.org', 'github.com', 'ietf.org', 'arxiv.org'];

export function computeExplainableAuthority(params: {
  url: string;
  domain: string;
  title: string;
  headingsCount: number;
  contentLength: number;
}): { score: number; method: string } {
  let score = 0.35;
  if (params.url.startsWith('https://')) score += 0.15;
  if (DOC_HOST_HINTS.some((h) => params.domain === h || params.domain.endsWith(h))) {
    score += 0.3;
  }
  if (params.headingsCount >= 2 && params.title.length >= 6) score += 0.1;
  if (params.contentLength >= 400) score += 0.08;
  return {
    score: Number(Math.min(1, score).toFixed(3)),
    method: 'https_plus_domain_tier_plus_structure_v1'
  };
}

export class AtlasCrawler {
  private readonly robotsCache = new Map<string, ParsedRobots>();
  private readonly lastDomainFetch = new Map<string, number>();

  constructor(
    private readonly repo: CloudRepository,
    private readonly ssrfGuard: SsrfGuard,
    private readonly extractor: ResearchExtractorService
  ) {}

  public parseRobotsTxt(raw: string, userAgent = 'AtlasBot'): ParsedRobots {
    const lines = raw.split(/\r?\n/).map((l) => l.trim());
    let matchesUa = false;
    let genericSection = false;
    const rules: Array<{ allow: boolean; path: string }> = [];
    const sitemaps: string[] = [];
    let crawlDelayMs = 0;

    for (const rawLine of lines) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;

      const sm = /^sitemap:\s*(https?:\/\/\S+)$/i.exec(line);
      if (sm) {
        sitemaps.push(sm[1]);
        continue;
      }

      const ua = /^user-agent:\s*(.+)$/i.exec(line);
      if (ua) {
        const agent = ua[1].trim().toLowerCase();
        matchesUa = agent === userAgent.toLowerCase();
        genericSection = agent === '*';
        continue;
      }

      if (!matchesUa && !genericSection) continue;

      const allowMatch = /^allow:\s*(.*)$/i.exec(line);
      if (allowMatch) {
        const p = allowMatch[1].trim();
        if (p) rules.push({ allow: true, path: p });
        continue;
      }

      const disallowMatch = /^disallow:\s*(.*)$/i.exec(line);
      if (disallowMatch) {
        const p = disallowMatch[1].trim();
        if (p) rules.push({ allow: false, path: p });
        continue;
      }

      const cdMatch = /^crawl-delay:\s*(\d+(?:\.\d+)?)$/i.exec(line);
      if (cdMatch) {
        crawlDelayMs = Math.min(10_000, Math.round(Number(cdMatch[1]) * 1000));
      }
    }

    // Specific longest prefix wins
    rules.sort((a, b) => b.path.length - a.path.length);
    return { rules, crawlDelayMs, sitemaps, fetchedAt: Date.now() };
  }

  public isPathAllowed(robots: ParsedRobots, pathname: string): boolean {
    for (const rule of robots.rules) {
      if (rule.path === '/' || pathname.startsWith(rule.path)) {
        return rule.allow;
      }
    }
    return true;
  }

  public extractLinksAndSitemapsFromHtml(html: string, baseUrl: string): string[] {
    const urls = new Set<string>();
    const hrefRx = /href\s*=\s*["']([^"'#]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = hrefRx.exec(html)) !== null) {
      const candidate = m[1].trim();
      if (!candidate || candidate.startsWith('mailto:') || candidate.startsWith('javascript:')) continue;
      try {
        const resolved = new URL(candidate, baseUrl);
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
          resolved.hash = '';
          urls.add(resolved.toString());
        }
      } catch {
        // Ignore invalid links
      }
    }
    return Array.from(urls);
  }

  public extractUrlsFromSitemapXml(xml: string): string[] {
    const urls: string[] = [];
    const locRx = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = locRx.exec(xml)) !== null) {
      const u = m[1].trim();
      if (u.startsWith('http://') || u.startsWith('https://')) {
        urls.push(u);
      }
    }
    return urls;
  }

  private isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
    if (allowedDomains.length === 0) return false;
    const host = hostname.toLowerCase();
    return allowedDomains.some((d) => {
      const clean = d.toLowerCase().trim();
      return host === clean || host.endsWith(`.${clean}`);
    });
  }

  private async getRobots(origin: string, allowLocalhostForTest: boolean): Promise<ParsedRobots> {
    const cached = this.robotsCache.get(origin);
    if (cached && Date.now() - cached.fetchedAt < 300_000) {
      return cached;
    }
    try {
      const res = await this.ssrfGuard.safeFetchText(`${origin}/robots.txt`, {
        timeoutMs: 4000,
        maxBytes: 256 * 1024,
        allowLocalhostForTest
      });
      if (res.status < 400) {
        const parsed = this.parseRobotsTxt(res.bodyText);
        this.robotsCache.set(origin, parsed);
        return parsed;
      }
    } catch {
      // Missing/unreachable robots.txt defaults to conservative allow on seed host
    }
    const empty: ParsedRobots = { rules: [], crawlDelayMs: 0, sitemaps: [], fetchedAt: Date.now() };
    this.robotsCache.set(origin, empty);
    return empty;
  }

  private async throttleDomain(domain: string, minDelayMs: number): Promise<void> {
    if (minDelayMs <= 0) return;
    const prev = this.lastDomainFetch.get(domain) ?? 0;
    const elapsed = Date.now() - prev;
    if (elapsed < minDelayMs) {
      await new Promise((r) => setTimeout(r, minDelayMs - elapsed));
    }
    this.lastDomainFetch.set(domain, Date.now());
  }

  public async startCrawl(config: CrawlSeedConfig): Promise<CrawlCheckpoint> {
    const now = Date.now();
    const checkpoint: CrawlCheckpoint = {
      id: randomUUID(),
      status: 'running',
      seedUrls: config.seedUrls,
      allowedDomains: config.allowedDomains,
      maxDepth: Math.max(0, Math.min(5, config.maxDepth ?? 2)),
      maxPages: Math.max(1, Math.min(500, config.maxPages ?? 30)),
      perDomainDelayMs: Math.max(0, config.perDomainDelayMs ?? 150),
      visitedUrls: [],
      queue: config.seedUrls.map((url) => ({ url, depth: 0 })),
      discoveredCount: config.seedUrls.length,
      indexedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      errorSamples: [],
      startedAt: now,
      updatedAt: now,
      completedAt: null
    };

    await this.repo.saveCrawlCheckpoint(checkpoint);
    return this.runCheckpointLoop(checkpoint, {
      respectRobotsTxt: config.respectRobotsTxt !== false,
      allowLocalhostForTest: Boolean(config.allowLocalhostForTest)
    });
  }

  public async resumeCrawl(
    checkpointId: string,
    opts?: { respectRobotsTxt?: boolean; allowLocalhostForTest?: boolean }
  ): Promise<CrawlCheckpoint> {
    const cp = await this.repo.getCrawlCheckpoint(checkpointId);
    if (!cp) throw new Error(`Crawl checkpoint ${checkpointId} not found`);
    if (cp.status === 'completed') return cp;
    cp.status = 'running';
    return this.runCheckpointLoop(cp, {
      respectRobotsTxt: opts?.respectRobotsTxt !== false,
      allowLocalhostForTest: Boolean(opts?.allowLocalhostForTest)
    });
  }

  private async runCheckpointLoop(
    cp: CrawlCheckpoint,
    opts: { respectRobotsTxt: boolean; allowLocalhostForTest: boolean; stepBudget?: number }
  ): Promise<CrawlCheckpoint> {
    const visited = new Set(cp.visitedUrls);
    let processedInRun = 0;

    while (
      cp.queue.length > 0 &&
      visited.size < cp.maxPages &&
      (opts.stepBudget === undefined || processedInRun < opts.stepBudget)
    ) {
      const next = cp.queue.shift()!;
      const normalized = this.normalizeQueueUrl(next.url);
      if (!normalized || visited.has(normalized)) continue;

      let parsed: URL;
      try {
        parsed = this.ssrfGuard.validateUrlSyntax(normalized, opts.allowLocalhostForTest);
      } catch (err) {
        cp.failedCount += 1;
        cp.errorSamples.push({ url: normalized, error: err instanceof Error ? err.message : String(err) });
        continue;
      }

      if (!this.isDomainAllowed(parsed.hostname, cp.allowedDomains)) {
        cp.skippedCount += 1;
        continue;
      }

      visited.add(normalized);
      processedInRun += 1;

      const robots = opts.respectRobotsTxt
        ? await this.getRobots(parsed.origin, opts.allowLocalhostForTest)
        : { rules: [], crawlDelayMs: 0, sitemaps: [], fetchedAt: Date.now() };

      if (opts.respectRobotsTxt && !this.isPathAllowed(robots, parsed.pathname)) {
        cp.skippedCount += 1;
        await this.persistProgress(cp, visited);
        continue;
      }

      // Enqueue sitemap URLs on first contact if discovered
      for (const smUrl of robots.sitemaps.slice(0, 2)) {
        if (!visited.has(smUrl)) {
          visited.add(smUrl);
          try {
            const smRes = await this.ssrfGuard.safeFetchText(smUrl, {
              timeoutMs: 4000,
              maxBytes: 512 * 1024,
              allowLocalhostForTest: opts.allowLocalhostForTest
            });
            for (const u of this.extractUrlsFromSitemapXml(smRes.bodyText).slice(0, 50)) {
              const norm = this.normalizeQueueUrl(u);
              if (norm && !visited.has(norm) && !cp.queue.some((q) => q.url === norm)) {
                cp.queue.push({ url: norm, depth: Math.min(cp.maxDepth, next.depth + 1) });
                cp.discoveredCount += 1;
              }
            }
          } catch {
            // Skip invalid sitemap cleanly
          }
        }
      }

      const effectiveDelay = Math.max(cp.perDomainDelayMs, robots.crawlDelayMs);
      await this.throttleDomain(parsed.hostname, effectiveDelay);

      try {
        const res = await this.ssrfGuard.safeFetchText(normalized, {
          timeoutMs: 6000,
          maxBytes: 1024 * 1024,
          allowLocalhostForTest: opts.allowLocalhostForTest
        });
        if (res.status >= 400) {
          cp.failedCount += 1;
          cp.errorSamples.push({ url: normalized, error: `HTTP ${res.status}` });
          await this.persistProgress(cp, visited);
          continue;
        }

        const doc = this.extractor.extractFromHtml(res.finalUrl, res.bodyText, res.byteLength);
        const canonicalCheck = sanitizeAndCanonicalizeUrl(doc.canonicalUrl, opts.allowLocalhostForTest);
        const canonicalUrl = canonicalCheck.valid ? canonicalCheck.canonicalUrl : res.finalUrl;

        const contentHash = createHash('sha256')
          .update(`${doc.title}\n${doc.textContent}`)
          .digest('hex');

        const dupHashDoc = await this.repo.findAtlasDocumentByContentHash(contentHash);
        if (dupHashDoc && dupHashDoc.canonicalUrl !== canonicalUrl) {
          cp.duplicateCount += 1;
          await this.persistProgress(cp, visited);
          continue;
        }

        const domain = new URL(canonicalUrl).hostname.toLowerCase();
        const auth = computeExplainableAuthority({
          url: canonicalUrl,
          domain,
          title: doc.title,
          headingsCount: doc.headings.length,
          contentLength: doc.textContent.length
        });

        const indexDoc: AtlasIndexDocument = {
          id: createHash('sha1').update(canonicalUrl).digest('hex').slice(0, 20),
          url: res.finalUrl,
          canonicalUrl,
          title: doc.title,
          mainContent: doc.textContent,
          snippet: doc.excerpt.slice(0, 320),
          headings: doc.headings,
          language: doc.language || 'en',
          sourceDomain: domain,
          contentType: canonicalUrl.includes('/docs') || doc.headings.length >= 4 ? 'docs' : 'web',
          contentHash,
          authorityScore: auth.score,
          authorityMethod: auth.method,
          publishedAt: doc.publishedAt,
          crawledAt: Date.now(),
          indexVersion: 'v1',
          embedding: computeLocalEmbedding(`${doc.title} ${doc.headings.join(' ')} ${doc.textContent.slice(0, 2000)}`)
        };

        const outcome = await this.repo.upsertAtlasIndexDocument(indexDoc);
        if (outcome.inserted) cp.indexedCount += 1;
        else if (outcome.updated) cp.updatedCount += 1;
        else cp.skippedCount += 1;

        // Enqueue outbound links if within maxDepth
        if (next.depth < cp.maxDepth) {
          const discoveredLinks = this.extractLinksAndSitemapsFromHtml(res.bodyText, res.finalUrl);
          for (const link of discoveredLinks.slice(0, 30)) {
            try {
              const linkUrl = new URL(link);
              const clean = this.normalizeQueueUrl(link);
              if (
                clean &&
                !visited.has(clean) &&
                this.isDomainAllowed(linkUrl.hostname, cp.allowedDomains) &&
                !cp.queue.some((q) => q.url === clean)
              ) {
                cp.queue.push({ url: clean, depth: next.depth + 1 });
                cp.discoveredCount += 1;
              }
            } catch {
              // ignore
            }
          }
        }
      } catch (err) {
        cp.failedCount += 1;
        cp.errorSamples.push({
          url: normalized,
          error: err instanceof Error ? err.message : String(err)
        });
      }

      await this.persistProgress(cp, visited);
    }

    if (cp.queue.length === 0 || visited.size >= cp.maxPages) {
      cp.status = 'completed';
      cp.completedAt = Date.now();
    } else {
      cp.status = 'paused';
    }
    await this.persistProgress(cp, visited);
    return cp;
  }

  private async persistProgress(cp: CrawlCheckpoint, visited: Set<string>): Promise<void> {
    cp.visitedUrls = Array.from(visited);
    cp.updatedAt = Date.now();
    cp.errorSamples = cp.errorSamples.slice(-20);
    await this.repo.saveCrawlCheckpoint({ ...cp });
  }

  private normalizeQueueUrl(raw: string): string | null {
    try {
      const u = new URL(raw);
      u.hash = '';
      return u.toString();
    } catch {
      return null;
    }
  }
}

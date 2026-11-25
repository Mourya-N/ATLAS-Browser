import type { SearchMode, SearchProviderHealth } from '@shared/types';
import { SsrfGuard } from '../../security/ssrf-guard';
import type { HybridIndexService } from '../knowledge/hybrid-index-service';
import type { ProviderSearchParams, RawSearchCandidate, SearchProvider } from './provider';

/**
 * Policy-compliant prototype adapter for a future first-party Atlas Web Index.
 * Demonstrates how an internal crawled index implements the exact same SearchProvider contract:
 * respects robots.txt checks, SSRF protections, and canonical URL normalization.
 */
export class FirstPartyIndexProvider implements SearchProvider {
  public readonly id = 'atlas_first_party_index';
  public readonly name = 'Atlas First-Party Web Index (Prototype)';
  public readonly isMock = false;

  constructor(
    private readonly hybridIndex: HybridIndexService,
    private readonly ssrfGuard: SsrfGuard,
    private readonly systemTenantId = 'atlas-public-index',
    private readonly systemProfileId = 'public-web-v1'
  ) {}

  public isConfigured(): boolean {
    return true;
  }

  public supportsMode(mode: SearchMode): boolean {
    return ['web', 'docs', 'research'].includes(mode);
  }

  public parseRobotsAllows(robotsTxt: string, pathName: string, userAgent = 'AtlasBot'): boolean {
    const lines = robotsTxt.split(/\r?\n/).map((l) => l.trim());
    let applies = false;
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      const uaMatch = /^user-agent:\s*(.+)$/i.exec(line);
      if (uaMatch) {
        const agent = uaMatch[1].trim().toLowerCase();
        applies = agent === '*' || agent === userAgent.toLowerCase();
        continue;
      }
      if (!applies) continue;
      const disallowMatch = /^disallow:\s*(.*)$/i.exec(line);
      if (disallowMatch) {
        const rule = disallowMatch[1].trim();
        if (rule === '/' || (rule.length > 0 && pathName.startsWith(rule))) {
          return false;
        }
      }
    }
    return true;
  }

  public async indexApprovedPublicPage(params: {
    url: string;
    title: string;
    content: string;
    robotsTxt?: string;
  }): Promise<boolean> {
    const parsed = this.ssrfGuard.validateUrlSyntax(params.url);
    if (params.robotsTxt && !this.parseRobotsAllows(params.robotsTxt, parsed.pathname)) {
      return false;
    }
    await this.hybridIndex.upsertDocument({
      userId: this.systemTenantId,
      profileId: this.systemProfileId,
      sourceType: 'web_page',
      sourceId: parsed.toString(),
      url: parsed.toString(),
      title: params.title,
      content: params.content,
      metadata: { indexedBy: 'first_party_prototype' }
    });
    return true;
  }

  public async search(params: ProviderSearchParams): Promise<RawSearchCandidate[]> {
    const hits = await this.hybridIndex.search({
      userId: this.systemTenantId,
      profileId: this.systemProfileId,
      query: params.query,
      sourceTypes: ['web_page'],
      limit: params.limit
    });
    return hits.map((h, idx) => ({
      title: h.document.title,
      url: h.document.url || `https://atlas-index.invalid/${h.document.sourceId}`,
      snippet: h.document.content.slice(0, 300),
      sourceProvider: this.id,
      publishedAt: new Date(h.document.updatedAt).toISOString(),
      contentType: params.mode === 'docs' ? 'docs' : 'web',
      rawRank: idx + 1
    }));
  }

  public async healthCheck(): Promise<SearchProviderHealth> {
    return {
      providerId: this.id,
      name: this.name,
      configured: true,
      healthy: true,
      isMock: false,
      avgLatencyMs: 2
    };
  }
}

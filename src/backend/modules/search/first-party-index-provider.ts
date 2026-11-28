import type {
  LavrayIndexDocument,
  LavrayIndexStats,
  SearchMode,
  SearchProviderHealth
} from '@shared/types';
import { computeLocalEmbedding } from '@shared/text-utils';
import type { CloudRepository } from '../../db/repository';
import type { ProviderSearchParams, RawSearchCandidate, SearchProvider } from './provider';

/**
 * First-party LAVRAY Search Index Provider backed by persistent storage
 * (PostgreSQL tsvector GIN + embeddings in Cloud, or InMemory store in tests).
 */
export class FirstPartyIndexProvider implements SearchProvider {
  public readonly id = 'lavray_first_party_index';
  public readonly name = 'LAVRAY First-Party Web Index';
  public readonly isMock = false;
  private avgLatencyMs = 0;

  constructor(private readonly repo: CloudRepository) {}

  public isConfigured(): boolean {
    return true;
  }

  public supportsMode(mode: SearchMode): boolean {
    return ['web', 'docs', 'research', 'news'].includes(mode);
  }

  public async upsertDocument(doc: LavrayIndexDocument): Promise<{ inserted: boolean; updated: boolean }> {
    return this.repo.upsertLavrayIndexDocument(doc);
  }

  public async removeDocument(canonicalUrl: string): Promise<boolean> {
    return this.repo.removeLavrayIndexDocument(canonicalUrl);
  }

  public async getStats(): Promise<LavrayIndexStats> {
    return this.repo.getLavrayIndexStats();
  }

  public async search(params: ProviderSearchParams): Promise<RawSearchCandidate[]> {
    const started = Date.now();
    const queryEmbedding = computeLocalEmbedding(params.query);
    const hits = await this.repo.searchLavrayIndex({
      query: params.query,
      queryEmbedding,
      domains: params.filters?.domains,
      limit: params.limit
    });
    this.avgLatencyMs = Date.now() - started;

    return hits.map((h, idx) => ({
      title: h.document.title,
      url: h.document.canonicalUrl,
      snippet: h.document.snippet,
      sourceProvider: this.id,
      publishedAt: h.document.publishedAt ?? null,
      contentType: h.document.contentType,
      language: h.document.language,
      rawRank: idx + 1
    }));
  }

  public async healthCheck(): Promise<SearchProviderHealth> {
    return {
      providerId: this.id,
      name: this.name,
      configured: true,
      healthy: await this.repo.ping(),
      isMock: false,
      avgLatencyMs: this.avgLatencyMs
    };
  }
}

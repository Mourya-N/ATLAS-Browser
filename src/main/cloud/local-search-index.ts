import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type {
  AtlasIndexDocument,
  AtlasIndexStats,
  CloudSearchHistoryRecord,
  CrawlCheckpoint,
  CrawlSeedConfig,
  SearchMode
} from '@shared/types';
import { computeLocalEmbedding, cosineSimilarity } from '@main/memory/memory-service';
import { AtlasCrawler, computeExplainableAuthority } from '../../backend/modules/crawler/atlas-crawler';
import { SsrfGuard } from '../../backend/security/ssrf-guard';
import { ResearchExtractorService } from '../../backend/modules/research/research-extractor';
import type { CloudRepository } from '../../backend/db/repository';
import type { RawSearchCandidate } from '../../backend/modules/search/provider';
import { randomUUID } from 'node:crypto';

/**
 * Local desktop SQLite FTS5 + Embedding Search Index & Crawler Service.
 * Ensures Atlas can crawl permitted seed URLs, update/remove documents,
 * query its own FTS5 index, and manage search history strictly offline.
 */
export class LocalSearchIndexService {
  private readonly ssrfGuard = new SsrfGuard();
  private readonly extractor = new ResearchExtractorService(this.ssrfGuard);

  constructor(private readonly db: Database.Database) {}

  public upsertDocument(doc: AtlasIndexDocument): { inserted: boolean; updated: boolean } {
    const existing = this.db
      .prepare('SELECT content_hash FROM atlas_index_documents WHERE canonical_url = ?')
      .get(doc.canonicalUrl) as { content_hash: string } | undefined;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO atlas_index_documents
            (id, url, canonical_url, title, main_content, snippet, headings_json, language, source_domain, content_type, content_hash, authority_score, authority_method, published_at, crawled_at, index_version, embedding_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(canonical_url) DO UPDATE SET
            url = excluded.url, title = excluded.title, main_content = excluded.main_content,
            snippet = excluded.snippet, headings_json = excluded.headings_json, language = excluded.language,
            content_type = excluded.content_type, content_hash = excluded.content_hash,
            authority_score = excluded.authority_score, authority_method = excluded.authority_method,
            published_at = excluded.published_at, crawled_at = excluded.crawled_at,
            index_version = excluded.index_version, embedding_json = excluded.embedding_json`
        )
        .run(
          doc.id,
          doc.url,
          doc.canonicalUrl,
          doc.title,
          doc.mainContent,
          doc.snippet,
          JSON.stringify(doc.headings),
          doc.language,
          doc.sourceDomain,
          doc.contentType,
          doc.contentHash,
          doc.authorityScore,
          doc.authorityMethod,
          doc.publishedAt ?? null,
          doc.crawledAt,
          doc.indexVersion,
          JSON.stringify(doc.embedding)
        );

      this.db.prepare('DELETE FROM atlas_index_fts WHERE canonical_url = ?').run(doc.canonicalUrl);
      this.db
        .prepare('INSERT INTO atlas_index_fts (canonical_url, title, main_content, headings) VALUES (?, ?, ?, ?)')
        .run(doc.canonicalUrl, doc.title, doc.mainContent, doc.headings.join(' '));
    });
    tx();

    if (!existing) return { inserted: true, updated: false };
    return { inserted: false, updated: existing.content_hash !== doc.contentHash };
  }

  public removeDocument(canonicalUrl: string): boolean {
    let deleted = false;
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM atlas_index_fts WHERE canonical_url = ?').run(canonicalUrl);
      const info = this.db
        .prepare('DELETE FROM atlas_index_documents WHERE canonical_url = ?')
        .run(canonicalUrl);
      deleted = info.changes > 0;
    });
    tx();
    return deleted;
  }

  public searchLocalIndex(query: string, limit = 10): RawSearchCandidate[] {
    const cleanTokens = query
      .replace(/[^\w\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (cleanTokens.length === 0) return [];

    const ftsQuery = cleanTokens.map((t) => `"${t}"*`).join(' OR ');
    const queryVec = computeLocalEmbedding(query);

    const rows = this.db
      .prepare(
        `SELECT d.*, bm25(atlas_index_fts) AS fts_score
         FROM atlas_index_fts f
         JOIN atlas_index_documents d ON d.canonical_url = f.canonical_url
         WHERE atlas_index_fts MATCH ?
         ORDER BY fts_score ASC
         LIMIT ?`
      )
      .all(ftsQuery, Math.min(30, limit * 2)) as Array<Record<string, any>>;

    const scored = rows.map((r, idx) => {
      let embedding: number[] = [];
      try {
        embedding = JSON.parse(String(r.embedding_json || '[]')) as number[];
      } catch {
        embedding = [];
      }
      const sem = cosineSimilarity(queryVec, embedding);
      return {
        candidate: {
          title: String(r.title),
          url: String(r.canonical_url),
          snippet: String(r.snippet),
          sourceProvider: 'atlas_first_party_index',
          publishedAt: r.published_at ? String(r.published_at) : null,
          contentType: (r.content_type as 'web' | 'news' | 'docs') || 'web',
          language: String(r.language || 'en'),
          rawRank: idx + 1
        } satisfies RawSearchCandidate,
        score: sem + 1 / (1 + Math.abs(Number(r.fts_score || 0)))
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.candidate);
  }

  public getStats(): AtlasIndexStats {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS total, COUNT(DISTINCT source_domain) AS domains, MAX(crawled_at) AS latest FROM atlas_index_documents'
      )
      .get() as { total: number; domains: number; latest: number | null };
    const total = Number(row?.total ?? 0);
    const domains = Number(row?.domains ?? 0);
    const limitedCoverage = total < 50;
    return {
      totalDocuments: total,
      uniqueDomains: domains,
      latestCrawlAt: row?.latest ?? null,
      indexVersion: 'v1-sqlite-fts5',
      limitedCoverage,
      notice: limitedCoverage
        ? `Local Atlas Index contains ${total} document(s) across ${domains} domain(s) (controlled seed scope).`
        : `Local Atlas Index serving ${total} documents across ${domains} domains.`
    };
  }

  public recordSearchHistory(query: string, mode: SearchMode, resultCount: number, isPrivate = false): void {
    if (isPrivate) return;
    this.db
      .prepare('INSERT INTO local_search_history (id, query, mode, result_count, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), query.slice(0, 500), mode, resultCount, Date.now());
  }

  public listSearchHistory(limit = 30): CloudSearchHistoryRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM local_search_history ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: String(r.id),
      userId: 'local',
      profileId: 'default',
      query: String(r.query),
      mode: r.mode as SearchMode,
      resultCount: Number(r.result_count),
      createdAt: Number(r.created_at)
    }));
  }

  public clearSearchHistory(): void {
    this.db.prepare('DELETE FROM local_search_history').run();
  }

  public async crawlSeeds(config: CrawlSeedConfig): Promise<CrawlCheckpoint> {
    const self = this;
    // Lightweight adapter wrapping SQLite persistence to satisfy AtlasCrawler's CloudRepository slice
    const sqliteRepoShim = {
      upsertAtlasIndexDocument: async (doc: AtlasIndexDocument) => self.upsertDocument(doc),
      findAtlasDocumentByContentHash: async (hash: string) => {
        const r = self.db
          .prepare('SELECT canonical_url FROM atlas_index_documents WHERE content_hash = ? LIMIT 1')
          .get(hash) as { canonical_url: string } | undefined;
        if (!r) return null;
        return {
          id: '',
          url: r.canonical_url,
          canonicalUrl: r.canonical_url,
          title: '',
          mainContent: '',
          snippet: '',
          headings: [],
          language: 'en',
          sourceDomain: '',
          contentType: 'web',
          contentHash: hash,
          authorityScore: 0.5,
          authorityMethod: 'domain_tier_v1',
          crawledAt: Date.now(),
          indexVersion: 'v1',
          embedding: []
        };
      },
      saveCrawlCheckpoint: async (cp: CrawlCheckpoint) => {
        self.db
          .prepare(
            `INSERT INTO crawl_checkpoints (id, status, state_json, started_at, updated_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET status = excluded.status, state_json = excluded.state_json, updated_at = excluded.updated_at, completed_at = excluded.completed_at`
          )
          .run(cp.id, cp.status, JSON.stringify(cp), cp.startedAt, cp.updatedAt, cp.completedAt ?? null);
      },
      getCrawlCheckpoint: async (id: string) => {
        const row = self.db
          .prepare('SELECT state_json FROM crawl_checkpoints WHERE id = ?')
          .get(id) as { state_json: string } | undefined;
        return row ? (JSON.parse(row.state_json) as CrawlCheckpoint) : null;
      }
    } as unknown as CloudRepository;

    const crawler = new AtlasCrawler(sqliteRepoShim, this.ssrfGuard, this.extractor);
    return crawler.startCrawl(config);
  }

  public indexRawPageForLocalCache(url: string, title: string, textContent: string): void {
    const auth = computeExplainableAuthority({
      url,
      domain: (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return 'local';
        }
      })(),
      title,
      headingsCount: 1,
      contentLength: textContent.length
    });
    const hash = createHash('sha256').update(`${title}\n${textContent}`).digest('hex');
    this.upsertDocument({
      id: createHash('sha1').update(url).digest('hex').slice(0, 20),
      url,
      canonicalUrl: url,
      title,
      mainContent: textContent.slice(0, 20_000),
      snippet: textContent.slice(0, 300),
      headings: [],
      language: 'en',
      sourceDomain: new URL(url).hostname,
      contentType: 'web',
      contentHash: hash,
      authorityScore: auth.score,
      authorityMethod: auth.method,
      crawledAt: Date.now(),
      indexVersion: 'v1',
      embedding: computeLocalEmbedding(`${title} ${textContent.slice(0, 2000)}`)
    });
  }
}

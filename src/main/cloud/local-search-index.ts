import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type {
  LavrayIndexDocument,
  LavrayIndexStats,
  CloudSearchHistoryRecord,
  CrawlCheckpoint,
  CrawlSeedConfig,
  SearchMode
} from '@shared/types';
import { computeLocalEmbedding, cosineSimilarity } from '@main/memory/memory-service';
import { LavrayCrawler, computeExplainableAuthority } from '../../backend/modules/crawler/lavray-crawler';
import { SsrfGuard } from '../../backend/security/ssrf-guard';
import { ResearchExtractorService } from '../../backend/modules/research/research-extractor';
import type { CloudRepository } from '../../backend/db/repository';
import type { RawSearchCandidate } from '../../backend/modules/search/provider';
import { randomUUID } from 'node:crypto';

/**
 * Local desktop SQLite FTS5 + Embedding Search Index & Crawler Service.
 * Ensures LAVRAY can crawl permitted seed URLs, update/remove documents,
 * query its own FTS5 index, and manage search history strictly offline.
 */
export class LocalSearchIndexService {
  private readonly ssrfGuard = new SsrfGuard();
  private readonly extractor = new ResearchExtractorService(this.ssrfGuard);

  constructor(private readonly db: Database.Database) {}

  public upsertDocument(doc: LavrayIndexDocument): { inserted: boolean; updated: boolean } {
    const existing = this.db
      .prepare('SELECT content_hash FROM lavray_index_documents WHERE canonical_url = ?')
      .get(doc.canonicalUrl) as { content_hash: string } | undefined;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO lavray_index_documents
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

      this.db.prepare('DELETE FROM lavray_index_fts WHERE canonical_url = ?').run(doc.canonicalUrl);
      this.db
        .prepare('INSERT INTO lavray_index_fts (canonical_url, title, main_content, headings) VALUES (?, ?, ?, ?)')
        .run(doc.canonicalUrl, doc.title, doc.mainContent, doc.headings.join(' '));
    });
    tx();

    if (!existing) return { inserted: true, updated: false };
    return { inserted: false, updated: existing.content_hash !== doc.contentHash };
  }

  public removeDocument(canonicalUrl: string): boolean {
    let deleted = false;
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM lavray_index_fts WHERE canonical_url = ?').run(canonicalUrl);
      const info = this.db
        .prepare('DELETE FROM lavray_index_documents WHERE canonical_url = ?')
        .run(canonicalUrl);
      deleted = info.changes > 0;
    });
    tx();
    return deleted;
  }

  public searchLocalIndex(query: string, limit = 10, domains?: string[]): RawSearchCandidate[] {
    const cleanTokens = Array.from(
      new Set(
        query
          .replace(/[^\w\s]/g, ' ')
          .trim()
          .split(/\s+/)
          .filter((t) => t.length >= 2)
      )
    ).slice(0, 10);
    if (cleanTokens.length === 0) return [];

    const quotedTokens = cleanTokens.map((t) => `"${t.replace(/"/g, '')}"*`);
    const andFtsQuery = quotedTokens.join(' AND ');
    const orFtsQuery = quotedTokens.join(' OR ');
    const queryVec = computeLocalEmbedding(query);

    const runFts = (ftsExpr: string, maxRows: number): Array<Record<string, any>> => {
      try {
        return this.db
          .prepare(
            `SELECT d.*, bm25(lavray_index_fts, 0.5, 6.0, 1.5, 3.0) AS fts_score
             FROM lavray_index_fts f
             JOIN lavray_index_documents d ON d.canonical_url = f.canonical_url
             WHERE lavray_index_fts MATCH ?
             ORDER BY fts_score ASC
             LIMIT ?`
          )
          .all(ftsExpr, maxRows) as Array<Record<string, any>>;
      } catch {
        return [];
      }
    };

    const maxFetch = Math.min(40, limit * 3);
    const andRows = cleanTokens.length > 1 ? runFts(andFtsQuery, maxFetch) : [];
    const seenUrls = new Set(andRows.map((r) => String(r.canonical_url)));
    const rows = [...andRows];

    if (rows.length < limit) {
      const orRows = runFts(orFtsQuery, maxFetch);
      for (const r of orRows) {
        const u = String(r.canonical_url);
        if (!seenUrls.has(u)) {
          seenUrls.add(u);
          rows.push(r);
        }
      }
    }

    const domainFilterSet = domains?.map((d) => d.toLowerCase()).filter(Boolean) ?? [];
    const filteredRows =
      domainFilterSet.length > 0
        ? rows.filter((r) => {
            const dom = String(r.source_domain || '').toLowerCase();
            return domainFilterSet.some((f) => dom === f || dom.endsWith(`.${f}`));
          })
        : rows;

    const scored = filteredRows.map((r, idx) => {
      let embedding: number[] = [];
      try {
        embedding = JSON.parse(String(r.embedding_json || '[]')) as number[];
      } catch {
        embedding = [];
      }
      const sem = cosineSimilarity(queryVec, embedding);
      const bm25Norm = 1 / (1 + Math.abs(Number(r.fts_score || 0)));
      return {
        candidate: {
          title: String(r.title),
          url: String(r.canonical_url),
          snippet: String(r.snippet),
          sourceProvider: 'lavray_first_party_index',
          publishedAt: r.published_at ? String(r.published_at) : null,
          contentType: (r.content_type as 'web' | 'news' | 'docs') || 'web',
          language: String(r.language || 'en'),
          rawRank: idx + 1
        } satisfies RawSearchCandidate,
        score: bm25Norm * 0.72 + sem * 0.28
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.candidate);
  }

  public getStats(): LavrayIndexStats {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS total, COUNT(DISTINCT source_domain) AS domains, MAX(crawled_at) AS latest FROM lavray_index_documents'
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
        ? `Local LAVRAY Index contains ${total} document(s) across ${domains} domain(s) (controlled seed scope).`
        : `Local LAVRAY Index serving ${total} documents across ${domains} domains.`
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
    // Lightweight adapter wrapping SQLite persistence to satisfy LavrayCrawler's CloudRepository slice
    const sqliteRepoShim = {
      upsertLavrayIndexDocument: async (doc: LavrayIndexDocument) => self.upsertDocument(doc),
      findLavrayDocumentByContentHash: async (hash: string) => {
        const r = self.db
          .prepare('SELECT canonical_url FROM lavray_index_documents WHERE content_hash = ? LIMIT 1')
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

    const crawler = new LavrayCrawler(sqliteRepoShim, this.ssrfGuard, this.extractor);
    return crawler.startCrawl(config);
  }

  public indexRawPageForLocalCache(url: string, title: string, textContent: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
      return;
    }
    const cleanText = textContent.replace(/\s+/g, ' ').trim();
    const cleanTitle = (title || host).replace(/\s+/g, ' ').trim();
    if (cleanText.length < 100) return;

    const auth = computeExplainableAuthority({
      url,
      domain: host,
      title: cleanTitle,
      headingsCount: 1,
      contentLength: cleanText.length
    });
    const hash = createHash('sha256').update(`${cleanTitle}\n${cleanText}`).digest('hex');
    this.upsertDocument({
      id: createHash('sha1').update(url).digest('hex').slice(0, 20),
      url,
      canonicalUrl: url,
      title: cleanTitle.slice(0, 240),
      mainContent: cleanText.slice(0, 20_000),
      snippet: cleanText.slice(0, 320),
      headings: [],
      language: 'en',
      sourceDomain: host,
      contentType: 'web',
      contentHash: hash,
      authorityScore: auth.score,
      authorityMethod: auth.method,
      crawledAt: Date.now(),
      indexVersion: 'v1',
      embedding: computeLocalEmbedding(`${cleanTitle} ${cleanText.slice(0, 2000)}`)
    });
  }
}

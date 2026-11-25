import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type {
  CloudBackgroundJob,
  CloudBookmarkRecord,
  CloudConsentSettings,
  CloudDevice,
  CloudNoteRecord,
  CloudProfile,
  CloudSearchHistoryRecord,
  HybridIndexDocument,
  HybridSearchHit,
  MemoryItem,
  ResearchReport
} from '@shared/types';
import { cosineSimilarity } from '@main/memory/memory-service';
import type {
  CloudAuditEventRecord,
  CloudRepository,
  SavedSourceRecord,
  StoredRefreshToken,
  StoredUserRecord
} from './repository';

export async function runPostgresMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  if (!fs.existsSync(migrationsDir)) return;
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at BIGINT NOT NULL
      );
    `);

    const appliedRes = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRes.rows.map((r) => Number(r.version)));

    for (const file of files) {
      const match = /^(\d+)_/.exec(file);
      const version = match ? Number(match[1]) : 0;
      if (applied.has(version)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING',
          [version, file, Date.now()]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

export class PostgresCloudRepository implements CloudRepository {
  public readonly mode = 'postgres' as const;

  constructor(private readonly pool: Pool) {}

  public async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async createUserWithProfile(params: {
    user: StoredUserRecord;
    profile: CloudProfile;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          params.user.id,
          params.user.email.toLowerCase(),
          params.user.passwordHash,
          params.user.displayName,
          params.user.createdAt,
          params.user.updatedAt
        ]
      );
      await client.query(
        `INSERT INTO profiles (id, user_id, name, settings_json, consent_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          params.profile.id,
          params.profile.userId,
          params.profile.name,
          JSON.stringify(params.profile.settings),
          JSON.stringify(params.profile.consent),
          params.profile.createdAt,
          params.profile.updatedAt
        ]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async findUserByEmail(email: string): Promise<StoredUserRecord | null> {
    const res = await this.pool.query<{
      id: string;
      email: string;
      password_hash: string;
      display_name: string;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM users WHERE email = $1 LIMIT 1', [email.toLowerCase()]);
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      displayName: row.display_name,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  public async findUserById(userId: string): Promise<StoredUserRecord | null> {
    const res = await this.pool.query<{
      id: string;
      email: string;
      password_hash: string;
      display_name: string;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      displayName: row.display_name,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  private mapProfileRow(row: {
    id: string;
    user_id: string;
    name: string;
    settings_json: Record<string, unknown>;
    consent_json: CloudConsentSettings;
    created_at: string;
    updated_at: string;
  }): CloudProfile {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      settings: row.settings_json || {},
      consent: row.consent_json,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  public async listProfiles(userId: string): Promise<CloudProfile[]> {
    const res = await this.pool.query('SELECT * FROM profiles WHERE user_id = $1 ORDER BY created_at ASC', [
      userId
    ]);
    return res.rows.map((r) => this.mapProfileRow(r));
  }

  public async getProfile(userId: string, profileId: string): Promise<CloudProfile | null> {
    const res = await this.pool.query('SELECT * FROM profiles WHERE user_id = $1 AND id = $2 LIMIT 1', [
      userId,
      profileId
    ]);
    return res.rows[0] ? this.mapProfileRow(res.rows[0]) : null;
  }

  public async createProfile(profile: CloudProfile): Promise<CloudProfile> {
    await this.pool.query(
      `INSERT INTO profiles (id, user_id, name, settings_json, consent_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        profile.id,
        profile.userId,
        profile.name,
        JSON.stringify(profile.settings),
        JSON.stringify(profile.consent),
        profile.createdAt,
        profile.updatedAt
      ]
    );
    return profile;
  }

  public async updateProfileConsent(
    userId: string,
    profileId: string,
    consent: CloudConsentSettings
  ): Promise<CloudProfile | null> {
    const now = Date.now();
    const res = await this.pool.query(
      `UPDATE profiles SET consent_json = $1::jsonb, updated_at = $2
       WHERE user_id = $3 AND id = $4 RETURNING *`,
      [JSON.stringify(consent), now, userId, profileId]
    );
    return res.rows[0] ? this.mapProfileRow(res.rows[0]) : null;
  }

  public async registerDevice(device: CloudDevice): Promise<CloudDevice> {
    await this.pool.query(
      `INSERT INTO devices (id, user_id, profile_id, device_name, platform, app_version, last_seen_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, app_version = EXCLUDED.app_version`,
      [
        device.id,
        device.userId,
        device.profileId,
        device.deviceName,
        device.platform,
        device.appVersion,
        device.lastSeenAt,
        device.createdAt
      ]
    );
    return device;
  }

  public async listDevices(userId: string): Promise<CloudDevice[]> {
    const res = await this.pool.query('SELECT * FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC', [
      userId
    ]);
    return res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      profileId: r.profile_id,
      deviceName: r.device_name,
      platform: r.platform,
      appVersion: r.app_version,
      lastSeenAt: Number(r.last_seen_at),
      createdAt: Number(r.created_at)
    }));
  }

  public async saveRefreshToken(rec: StoredRefreshToken): Promise<void> {
    await this.pool.query(
      `INSERT INTO refresh_tokens (id, user_id, profile_id, token_hash, expires_at, revoked_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [rec.id, rec.userId, rec.profileId, rec.tokenHash, rec.expiresAt, rec.revokedAt ?? null, rec.createdAt]
    );
  }

  public async findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null> {
    const res = await this.pool.query('SELECT * FROM refresh_tokens WHERE token_hash = $1 LIMIT 1', [
      tokenHash
    ]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      profileId: r.profile_id,
      tokenHash: r.token_hash,
      expiresAt: Number(r.expires_at),
      revokedAt: r.revoked_at ? Number(r.revoked_at) : null,
      createdAt: Number(r.created_at)
    };
  }

  public async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.pool.query('UPDATE refresh_tokens SET revoked_at = $1 WHERE token_hash = $2', [
      Date.now(),
      tokenHash
    ]);
  }

  public async upsertBookmark(bm: CloudBookmarkRecord): Promise<CloudBookmarkRecord> {
    await this.pool.query(
      `INSERT INTO bookmarks (id, user_id, profile_id, url, title, folder_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, title = EXCLUDED.title, folder_name = EXCLUDED.folder_name, updated_at = EXCLUDED.updated_at`,
      [bm.id, bm.userId, bm.profileId, bm.url, bm.title, bm.folderName ?? null, bm.createdAt, bm.updatedAt]
    );
    return bm;
  }

  public async listBookmarks(userId: string, profileId: string, limit = 100): Promise<CloudBookmarkRecord[]> {
    const res = await this.pool.query(
      'SELECT * FROM bookmarks WHERE user_id = $1 AND profile_id = $2 ORDER BY updated_at DESC LIMIT $3',
      [userId, profileId, limit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      profileId: r.profile_id,
      url: r.url,
      title: r.title,
      folderName: r.folder_name,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    }));
  }

  public async deleteBookmark(userId: string, profileId: string, id: string): Promise<void> {
    await this.pool.query('DELETE FROM bookmarks WHERE user_id = $1 AND profile_id = $2 AND id = $3', [
      userId,
      profileId,
      id
    ]);
  }

  public async upsertNote(note: CloudNoteRecord): Promise<CloudNoteRecord> {
    await this.pool.query(
      `INSERT INTO notes (id, user_id, profile_id, title, content, source_url, tags_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, source_url = EXCLUDED.source_url, tags_json = EXCLUDED.tags_json, updated_at = EXCLUDED.updated_at`,
      [
        note.id,
        note.userId,
        note.profileId,
        note.title,
        note.content,
        note.sourceUrl ?? null,
        JSON.stringify(note.tags),
        note.createdAt,
        note.updatedAt
      ]
    );
    return note;
  }

  public async listNotes(userId: string, profileId: string, limit = 100): Promise<CloudNoteRecord[]> {
    const res = await this.pool.query(
      'SELECT * FROM notes WHERE user_id = $1 AND profile_id = $2 ORDER BY updated_at DESC LIMIT $3',
      [userId, profileId, limit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      profileId: r.profile_id,
      title: r.title,
      content: r.content,
      sourceUrl: r.source_url,
      tags: Array.isArray(r.tags_json) ? r.tags_json : [],
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    }));
  }

  public async deleteNote(userId: string, profileId: string, id: string): Promise<void> {
    await this.pool.query('DELETE FROM notes WHERE user_id = $1 AND profile_id = $2 AND id = $3', [
      userId,
      profileId,
      id
    ]);
  }

  public async recordSearchHistory(entry: CloudSearchHistoryRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO search_history (id, user_id, profile_id, query, mode, result_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.id, entry.userId, entry.profileId, entry.query, entry.mode, entry.resultCount, entry.createdAt]
    );
  }

  public async listSearchHistory(
    userId: string,
    profileId: string,
    limit = 50
  ): Promise<CloudSearchHistoryRecord[]> {
    const res = await this.pool.query(
      'SELECT * FROM search_history WHERE user_id = $1 AND profile_id = $2 ORDER BY created_at DESC LIMIT $3',
      [userId, profileId, limit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      profileId: r.profile_id,
      query: r.query,
      mode: r.mode,
      resultCount: Number(r.result_count),
      createdAt: Number(r.created_at)
    }));
  }

  public async saveResearchReport(userId: string, profileId: string, report: ResearchReport): Promise<void> {
    await this.pool.query(
      `INSERT INTO research_reports (id, user_id, profile_id, query, summary, report_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (id) DO UPDATE SET summary = EXCLUDED.summary, report_json = EXCLUDED.report_json`,
      [report.id, userId, profileId, report.query, report.summary, JSON.stringify(report), report.createdAt]
    );
  }

  public async listResearchReports(userId: string, profileId: string, limit = 50): Promise<ResearchReport[]> {
    const res = await this.pool.query(
      'SELECT report_json FROM research_reports WHERE user_id = $1 AND profile_id = $2 ORDER BY created_at DESC LIMIT $3',
      [userId, profileId, limit]
    );
    return res.rows.map((r) => r.report_json as ResearchReport);
  }

  public async saveSource(source: SavedSourceRecord): Promise<SavedSourceRecord> {
    await this.pool.query(
      `INSERT INTO saved_sources (id, user_id, profile_id, report_id, url, title, excerpt, metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        source.id,
        source.userId,
        source.profileId,
        source.reportId ?? null,
        source.url,
        source.title,
        source.excerpt,
        JSON.stringify(source.metadata),
        source.createdAt
      ]
    );
    return source;
  }

  public async upsertMemoryItem(userId: string, profileId: string, item: MemoryItem): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory_items
        (id, user_id, profile_id, category, domain, source_url, title, content, confidence, user_approved, expires_at, embedding_version, embedding_json, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, updated_at = EXCLUDED.updated_at`,
      [
        item.id,
        userId,
        profileId,
        item.category,
        item.domain ?? null,
        item.sourceUrl ?? null,
        item.title,
        item.content,
        item.confidence,
        item.userApproved,
        item.expiresAt ?? null,
        'v1-hash64',
        JSON.stringify(item.embedding ?? []),
        item.createdAt,
        item.lastUsedAt
      ]
    );
  }

  public async listMemoryItems(userId: string, profileId: string): Promise<MemoryItem[]> {
    const res = await this.pool.query(
      'SELECT * FROM memory_items WHERE user_id = $1 AND profile_id = $2 ORDER BY updated_at DESC',
      [userId, profileId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      profileId: r.profile_id,
      category: r.category,
      domain: r.domain,
      sourceUrl: r.source_url,
      title: r.title,
      content: r.content,
      confidence: Number(r.confidence),
      source: 'cloud_sync',
      userApproved: Boolean(r.user_approved),
      useCount: 0,
      expiresAt: r.expires_at ? Number(r.expires_at) : null,
      embedding: Array.isArray(r.embedding_json) ? r.embedding_json : [],
      createdAt: Number(r.created_at),
      lastUsedAt: Number(r.updated_at)
    }));
  }

  public async upsertHybridDocument(doc: HybridIndexDocument): Promise<HybridIndexDocument> {
    await this.pool.query(
      `INSERT INTO hybrid_index_documents
        (id, user_id, profile_id, source_type, source_id, url, title, content, metadata_json, embedding_version, embedding_json, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14)
       ON CONFLICT (user_id, profile_id, source_type, source_id)
       DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, url = EXCLUDED.url, metadata_json = EXCLUDED.metadata_json,
         embedding_version = EXCLUDED.embedding_version, embedding_json = EXCLUDED.embedding_json, expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at`,
      [
        doc.id,
        doc.userId,
        doc.profileId,
        doc.sourceType,
        doc.sourceId,
        doc.url ?? null,
        doc.title,
        doc.content,
        JSON.stringify(doc.metadata),
        doc.embeddingVersion,
        JSON.stringify(doc.embedding),
        doc.expiresAt ?? null,
        doc.createdAt,
        doc.updatedAt
      ]
    );
    return doc;
  }

  public async deleteHybridDocument(
    userId: string,
    profileId: string,
    sourceType: string,
    sourceId: string
  ): Promise<void> {
    await this.pool.query(
      'DELETE FROM hybrid_index_documents WHERE user_id = $1 AND profile_id = $2 AND source_type = $3 AND source_id = $4',
      [userId, profileId, sourceType, sourceId]
    );
  }

  public async pruneExpiredHybridDocuments(nowMs = Date.now()): Promise<number> {
    const res = await this.pool.query(
      'DELETE FROM hybrid_index_documents WHERE expires_at IS NOT NULL AND expires_at <= $1',
      [nowMs]
    );
    return res.rowCount ?? 0;
  }

  public async searchHybridDocuments(params: {
    userId: string;
    profileId: string;
    query: string;
    queryEmbedding: number[];
    sourceTypes?: HybridIndexDocument['sourceType'][];
    limit?: number;
  }): Promise<HybridSearchHit[]> {
    const now = Date.now();
    const limit = params.limit ?? 10;
    const filterTypes = params.sourceTypes && params.sourceTypes.length > 0 ? params.sourceTypes : null;

    const res = await this.pool.query(
      `SELECT *, ts_rank_cd(tsv, plainto_tsquery('english', $3)) AS ts_rank
       FROM hybrid_index_documents
       WHERE user_id = $1 AND profile_id = $2
         AND (expires_at IS NULL OR expires_at > $4)
         AND ($5::text[] IS NULL OR source_type = ANY($5::text[]))
       ORDER BY ts_rank DESC, updated_at DESC
       LIMIT 100`,
      [params.userId, params.profileId, params.query, now, filterTypes]
    );

    const hits: HybridSearchHit[] = res.rows.map((r) => {
      const doc: HybridIndexDocument = {
        id: r.id,
        userId: r.user_id,
        profileId: r.profile_id,
        sourceType: r.source_type,
        sourceId: r.source_id,
        url: r.url,
        title: r.title,
        content: r.content,
        metadata: r.metadata_json || {},
        embeddingVersion: r.embedding_version,
        embedding: Array.isArray(r.embedding_json) ? r.embedding_json : [],
        expiresAt: r.expires_at ? Number(r.expires_at) : null,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at)
      };
      const keywordScore = Math.min(1, Number(r.ts_rank || 0));
      const semanticScore = cosineSimilarity(params.queryEmbedding, doc.embedding);
      const ageDays = Math.max(0, (now - doc.updatedAt) / 86_400_000);
      const recencyScore = 1 / (1 + ageDays / 30);
      const combinedScore = Number((keywordScore * 0.45 + semanticScore * 0.45 + recencyScore * 0.1).toFixed(4));
      return { document: doc, keywordScore, semanticScore, recencyScore, combinedScore };
    });

    return hits.sort((a, b) => b.combinedScore - a.combinedScore).slice(0, limit);
  }

  public async listHybridDocuments(userId: string, profileId: string, limit = 100): Promise<HybridIndexDocument[]> {
    const res = await this.pool.query(
      'SELECT * FROM hybrid_index_documents WHERE user_id = $1 AND profile_id = $2 ORDER BY updated_at DESC LIMIT $3',
      [userId, profileId, limit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      profileId: r.profile_id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      url: r.url,
      title: r.title,
      content: r.content,
      metadata: r.metadata_json || {},
      embeddingVersion: r.embedding_version,
      embedding: Array.isArray(r.embedding_json) ? r.embedding_json : [],
      expiresAt: r.expires_at ? Number(r.expires_at) : null,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    }));
  }

  public async enqueueJob(job: CloudBackgroundJob): Promise<CloudBackgroundJob> {
    await this.pool.query(
      `INSERT INTO background_jobs (id, user_id, profile_id, type, payload_json, status, attempts, max_attempts, result_json, error, run_after, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
      [
        job.id,
        job.userId,
        job.profileId,
        job.type,
        JSON.stringify(job.payload),
        job.status,
        job.attempts,
        job.maxAttempts,
        job.result ? JSON.stringify(job.result) : null,
        job.error ?? null,
        job.runAfter,
        job.createdAt,
        job.updatedAt
      ]
    );
    return job;
  }

  public async claimNextDueJob(nowMs = Date.now()): Promise<CloudBackgroundJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `SELECT * FROM background_jobs
         WHERE status = 'queued' AND run_after <= $1
         ORDER BY run_after ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [nowMs]
      );
      const r = res.rows[0];
      if (!r) {
        await client.query('COMMIT');
        return null;
      }
      const nextAttempts = Number(r.attempts) + 1;
      await client.query(
        'UPDATE background_jobs SET status = $1, attempts = $2, updated_at = $3 WHERE id = $4',
        ['running', nextAttempts, nowMs, r.id]
      );
      await client.query('COMMIT');
      return {
        id: r.id,
        userId: r.user_id,
        profileId: r.profile_id,
        type: r.type,
        payload: r.payload_json || {},
        status: 'running',
        attempts: nextAttempts,
        maxAttempts: Number(r.max_attempts),
        result: r.result_json ?? null,
        error: r.error ?? null,
        runAfter: Number(r.run_after),
        createdAt: Number(r.created_at),
        updatedAt: nowMs
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async updateJob(job: CloudBackgroundJob): Promise<void> {
    await this.pool.query(
      `UPDATE background_jobs
       SET status = $1, attempts = $2, result_json = $3::jsonb, error = $4, run_after = $5, updated_at = $6
       WHERE id = $7`,
      [
        job.status,
        job.attempts,
        job.result ? JSON.stringify(job.result) : null,
        job.error ?? null,
        job.runAfter,
        job.updatedAt,
        job.id
      ]
    );
  }

  public async getJobStats(): Promise<{
    queued: number;
    running: number;
    completed: number;
    failed: number;
    deadLetter: number;
  }> {
    const res = await this.pool.query<{ status: string; cnt: string }>(
      'SELECT status, COUNT(*)::text AS cnt FROM background_jobs GROUP BY status'
    );
    const map = new Map(res.rows.map((r) => [r.status, Number(r.cnt)]));
    return {
      queued: map.get('queued') ?? 0,
      running: map.get('running') ?? 0,
      completed: map.get('completed') ?? 0,
      failed: map.get('failed') ?? 0,
      deadLetter: map.get('dead_letter') ?? 0
    };
  }

  public async logAudit(event: CloudAuditEventRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (id, user_id, profile_id, category, action, request_id, details_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        event.id,
        event.userId ?? null,
        event.profileId ?? null,
        event.category,
        event.action,
        event.requestId ?? null,
        JSON.stringify(event.details),
        event.createdAt
      ]
    );
  }

  public async exportAllUserData(userId: string): Promise<Record<string, unknown>> {
    const user = await this.findUserById(userId);
    const profiles = await this.listProfiles(userId);
    const devices = await this.listDevices(userId);
    const bookmarks = (await this.pool.query('SELECT * FROM bookmarks WHERE user_id = $1', [userId])).rows;
    const notes = (await this.pool.query('SELECT * FROM notes WHERE user_id = $1', [userId])).rows;
    const searchHistory = (
      await this.pool.query('SELECT * FROM search_history WHERE user_id = $1', [userId])
    ).rows;
    const researchReports = (
      await this.pool.query('SELECT * FROM research_reports WHERE user_id = $1', [userId])
    ).rows;
    const memoryItems = (await this.pool.query('SELECT * FROM memory_items WHERE user_id = $1', [userId]))
      .rows;

    return {
      exportedAt: new Date().toISOString(),
      user: user
        ? { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt }
        : null,
      profiles,
      devices,
      bookmarks,
      notes,
      searchHistory,
      researchReports,
      memoryItems
    };
  }

  public async deleteUserAccount(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
}

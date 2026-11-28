import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type {
  LavrayIndexDocument,
  LavrayIndexStats,
  CloudBackgroundJob,
  CloudBookmarkRecord,
  CloudConsentSettings,
  CloudDevice,
  CloudNoteRecord,
  CloudProfile,
  CloudSearchHistoryRecord,
  CrawlCheckpoint,
  E2eeKeyEnvelope,
  HybridIndexDocument,
  HybridSearchHit,
  MemoryItem,
  ResearchReport,
  SyncEntityType,
  SyncPushItem,
  SyncPushResponse,
  SyncPullResponse,
  SyncRecordEnvelope
} from '@shared/types';
import { cosineSimilarity } from '@shared/text-utils';
import type {
  CloudAuditEventRecord,
  CloudRepository,
  SavedSourceRecord,
  StoredAccountToken,
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

  private mapUserRow(row: Record<string, any>): StoredUserRecord {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null,
      emailVerified: Boolean(row.email_verified),
      emailVerifiedAt: row.email_verified_at ? Number(row.email_verified_at) : null,
      e2eeEnabled: Boolean(row.e2ee_enabled),
      e2eeKeyVersion: Number(row.e2ee_key_version ?? 1),
      e2eeKeyEnvelope: (row.e2ee_key_envelope as E2eeKeyEnvelope | null) ?? null,
      tokenEpoch: Number(row.token_epoch ?? 1),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  public async findUserByEmail(email: string): Promise<StoredUserRecord | null> {
    const res = await this.pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email.toLowerCase()]);
    return res.rows[0] ? this.mapUserRow(res.rows[0]) : null;
  }

  public async findUserById(userId: string): Promise<StoredUserRecord | null> {
    const res = await this.pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
    return res.rows[0] ? this.mapUserRow(res.rows[0]) : null;
  }

  public async getAuthSessionState(
    userId: string,
    deviceId?: string | null
  ): Promise<{ exists: boolean; tokenEpoch: number; deviceRevoked: boolean }> {
    const res = await this.pool.query<{ token_epoch: number; revoked_at: string | null }>(
      `SELECT u.token_epoch, d.revoked_at
       FROM users u
       LEFT JOIN devices d ON d.id = $2 AND d.user_id = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [userId, deviceId ?? null]
    );
    const r = res.rows[0];
    if (!r) return { exists: false, tokenEpoch: 0, deviceRevoked: false };
    return {
      exists: true,
      tokenEpoch: Number(r.token_epoch ?? 1),
      deviceRevoked: Boolean(r.revoked_at)
    };
  }

  public async updateUserProfile(
    userId: string,
    patch: { displayName?: string; avatarUrl?: string | null }
  ): Promise<StoredUserRecord | null> {
    const now = Date.now();
    const current = await this.findUserById(userId);
    if (!current) return null;
    const res = await this.pool.query(
      `UPDATE users SET display_name = $1, avatar_url = $2, updated_at = $3 WHERE id = $4 RETURNING *`,
      [
        patch.displayName !== undefined ? patch.displayName : current.displayName,
        patch.avatarUrl !== undefined ? patch.avatarUrl : current.avatarUrl ?? null,
        now,
        userId
      ]
    );
    return res.rows[0] ? this.mapUserRow(res.rows[0]) : null;
  }

  public async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3', [
      passwordHash,
      Date.now(),
      userId
    ]);
  }

  public async markEmailVerified(userId: string, verifiedAt: number): Promise<StoredUserRecord | null> {
    const res = await this.pool.query(
      `UPDATE users SET email_verified = TRUE, email_verified_at = $1, updated_at = $1 WHERE id = $2 RETURNING *`,
      [verifiedAt, userId]
    );
    return res.rows[0] ? this.mapUserRow(res.rows[0]) : null;
  }

  public async setUserE2eeEnvelope(
    userId: string,
    params: { e2eeEnabled: boolean; e2eeKeyVersion: number; envelope: E2eeKeyEnvelope | null }
  ): Promise<StoredUserRecord | null> {
    const res = await this.pool.query(
      `UPDATE users
       SET e2ee_enabled = $1, e2ee_key_version = $2, e2ee_key_envelope = $3::jsonb, updated_at = $4
       WHERE id = $5 RETURNING *`,
      [
        params.e2eeEnabled,
        params.e2eeKeyVersion,
        params.envelope ? JSON.stringify(params.envelope) : null,
        Date.now(),
        userId
      ]
    );
    return res.rows[0] ? this.mapUserRow(res.rows[0]) : null;
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
    const res = await this.pool.query(
      `INSERT INTO devices (id, user_id, profile_id, device_name, platform, app_version, last_seen_at, revoked_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)
       ON CONFLICT (id) DO UPDATE
         SET device_name = EXCLUDED.device_name,
             app_version = EXCLUDED.app_version,
             last_seen_at = EXCLUDED.last_seen_at,
             revoked_at = NULL
       RETURNING *`,
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
    const r = res.rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      profileId: r.profile_id,
      deviceName: r.device_name,
      platform: r.platform,
      appVersion: r.app_version,
      lastSeenAt: Number(r.last_seen_at),
      revokedAt: r.revoked_at ? Number(r.revoked_at) : null,
      createdAt: Number(r.created_at)
    };
  }

  public async getDevice(userId: string, deviceId: string): Promise<CloudDevice | null> {
    const res = await this.pool.query('SELECT * FROM devices WHERE user_id = $1 AND id = $2 LIMIT 1', [
      userId,
      deviceId
    ]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      profileId: r.profile_id,
      deviceName: r.device_name,
      platform: r.platform,
      appVersion: r.app_version,
      lastSeenAt: Number(r.last_seen_at),
      revokedAt: r.revoked_at ? Number(r.revoked_at) : null,
      createdAt: Number(r.created_at)
    };
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
      revokedAt: r.revoked_at ? Number(r.revoked_at) : null,
      createdAt: Number(r.created_at)
    }));
  }

  public async revokeDevice(userId: string, deviceId: string, revokedAt: number): Promise<CloudDevice | null> {
    const res = await this.pool.query(
      'UPDATE devices SET revoked_at = $1 WHERE user_id = $2 AND id = $3 RETURNING *',
      [revokedAt, userId, deviceId]
    );
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = $1 WHERE user_id = $2 AND device_id = $3 AND revoked_at IS NULL',
      [revokedAt, userId, deviceId]
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      profileId: r.profile_id,
      deviceName: r.device_name,
      platform: r.platform,
      appVersion: r.app_version,
      lastSeenAt: Number(r.last_seen_at),
      revokedAt: r.revoked_at ? Number(r.revoked_at) : null,
      createdAt: Number(r.created_at)
    };
  }

  public async saveRefreshToken(rec: StoredRefreshToken): Promise<void> {
    await this.pool.query(
      `INSERT INTO refresh_tokens (id, user_id, profile_id, device_id, token_hash, expires_at, revoked_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        rec.id,
        rec.userId,
        rec.profileId,
        rec.deviceId ?? null,
        rec.tokenHash,
        rec.expiresAt,
        rec.revokedAt ?? null,
        rec.createdAt
      ]
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
      deviceId: r.device_id ?? null,
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

  public async revokeAllRefreshTokensForUser(userId: string, exceptDeviceId?: string): Promise<void> {
    const now = Date.now();
    if (exceptDeviceId) {
      await this.pool.query(
        'UPDATE refresh_tokens SET revoked_at = $1 WHERE user_id = $2 AND (device_id IS NULL OR device_id <> $3) AND revoked_at IS NULL',
        [now, userId, exceptDeviceId]
      );
    } else {
      await this.pool.query(
        'UPDATE refresh_tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL',
        [now, userId]
      );
    }
  }

  public async incrementTokenEpoch(userId: string): Promise<number> {
    const res = await this.pool.query<{ token_epoch: number }>(
      'UPDATE users SET token_epoch = COALESCE(token_epoch, 1) + 1, updated_at = $1 WHERE id = $2 RETURNING token_epoch',
      [Date.now(), userId]
    );
    return Number(res.rows[0]?.token_epoch ?? 1);
  }

  public async saveAccountToken(rec: StoredAccountToken): Promise<void> {
    await this.pool.query(
      `INSERT INTO account_tokens (id, user_id, purpose, token_hash, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [rec.id, rec.userId, rec.purpose, rec.tokenHash, rec.expiresAt, rec.usedAt ?? null, rec.createdAt]
    );
  }

  public async consumeAccountToken(
    tokenHash: string,
    purpose: 'email_verify' | 'password_reset',
    usedAt: number
  ): Promise<StoredAccountToken | null> {
    const res = await this.pool.query(
      `UPDATE account_tokens
       SET used_at = $1
       WHERE token_hash = $2
         AND purpose = $3
         AND used_at IS NULL
         AND expires_at > $1
       RETURNING *`,
      [usedAt, tokenHash, purpose]
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      purpose: r.purpose,
      tokenHash: r.token_hash,
      expiresAt: Number(r.expires_at),
      usedAt: r.used_at ? Number(r.used_at) : null,
      createdAt: Number(r.created_at)
    };
  }

  public async pushSyncRecords(params: {
    userId: string;
    profileId: string;
    items: SyncPushItem[];
  }): Promise<SyncPushResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1 || \':\' || $2))', [
        params.userId,
        params.profileId
      ]);
      const maxRes = await client.query<{ max_v: string | null }>(
        'SELECT MAX(version)::text AS max_v FROM sync_records WHERE user_id = $1 AND profile_id = $2',
        [params.userId, params.profileId]
      );
      let currentVersion = Number(maxRes.rows[0]?.max_v ?? 0);
      const applied: SyncRecordEnvelope[] = [];
      const conflicts: SyncPushResponse['conflicts'] = [];

      for (const item of params.items) {
        const dupRes = await client.query(
          'SELECT * FROM sync_records WHERE user_id = $1 AND profile_id = $2 AND client_change_id = $3 LIMIT 1',
          [params.userId, params.profileId, item.clientChangeId]
        );
        if (dupRes.rows[0]) {
          const r = dupRes.rows[0];
          if (
            r.id !== item.id ||
            r.entity_type !== item.entityType ||
            JSON.stringify(r.payload_json) !== JSON.stringify(item.payload)
          ) {
            throw new Error(`Idempotency conflict: clientChangeId "${item.clientChangeId}" reused with different payload`);
          }
          applied.push({
            id: r.id,
            entityType: r.entity_type,
            version: Number(r.version),
            updatedAt: Number(r.updated_at),
            deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
            clientChangeId: r.client_change_id,
            encrypted: Boolean(r.encrypted),
            payload: r.payload_json
          });
          continue;
        }

        const existingRes = await client.query(
          'SELECT * FROM sync_records WHERE user_id = $1 AND profile_id = $2 AND entity_type = $3 AND id = $4 LIMIT 1',
          [params.userId, params.profileId, item.entityType, item.id]
        );
        const existing = existingRes.rows[0];
        if (existing && Number(existing.version) > item.baseVersion) {
          conflicts.push({
            clientItem: item,
            serverItem: {
              id: existing.id,
              entityType: existing.entity_type,
              version: Number(existing.version),
              updatedAt: Number(existing.updated_at),
              deletedAt: existing.deleted_at ? Number(existing.deleted_at) : null,
              clientChangeId: existing.client_change_id,
              encrypted: Boolean(existing.encrypted),
              payload: existing.payload_json
            }
          });
          continue;
        }

        currentVersion += 1;
        await client.query(
          `INSERT INTO sync_records (id, user_id, profile_id, entity_type, version, updated_at, deleted_at, client_change_id, encrypted, payload_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
           ON CONFLICT (user_id, profile_id, entity_type, id) DO UPDATE
             SET version = EXCLUDED.version,
                 updated_at = EXCLUDED.updated_at,
                 deleted_at = EXCLUDED.deleted_at,
                 client_change_id = EXCLUDED.client_change_id,
                 encrypted = EXCLUDED.encrypted,
                 payload_json = EXCLUDED.payload_json`,
          [
            item.id,
            params.userId,
            params.profileId,
            item.entityType,
            currentVersion,
            item.updatedAt,
            item.deletedAt ?? null,
            item.clientChangeId,
            item.encrypted,
            JSON.stringify(item.payload)
          ]
        );
        applied.push({
          id: item.id,
          entityType: item.entityType,
          version: currentVersion,
          updatedAt: item.updatedAt,
          deletedAt: item.deletedAt ?? null,
          clientChangeId: item.clientChangeId,
          encrypted: item.encrypted,
          payload: item.payload
        });
      }

      await client.query('COMMIT');
      return { applied, conflicts, serverVersion: currentVersion };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async pullSyncRecords(params: {
    userId: string;
    profileId: string;
    sinceVersion: number;
    limit: number;
    entityTypes?: SyncEntityType[];
  }): Promise<SyncPullResponse> {
    const maxRes = await this.pool.query<{ max_v: string | null }>(
      'SELECT MAX(version)::text AS max_v FROM sync_records WHERE user_id = $1 AND profile_id = $2',
      [params.userId, params.profileId]
    );
    const serverVersion = Number(maxRes.rows[0]?.max_v ?? 0);

    const values: unknown[] = [params.userId, params.profileId, params.sinceVersion, params.limit + 1];
    let filterSql = '';
    if (params.entityTypes && params.entityTypes.length > 0) {
      values.push(params.entityTypes);
      filterSql = ` AND entity_type = ANY($5)`;
    }

    const res = await this.pool.query(
      `SELECT * FROM sync_records
       WHERE user_id = $1 AND profile_id = $2 AND version > $3${filterSql}
       ORDER BY version ASC LIMIT $4`,
      values
    );
    const hasMore = res.rows.length > params.limit;
    const rows = res.rows.slice(0, params.limit);
    const nextCursor = rows.length > 0 ? Number(rows[rows.length - 1].version) : params.sinceVersion;
    return {
      items: rows.map((r) => ({
        id: r.id,
        entityType: r.entity_type,
        version: Number(r.version),
        updatedAt: Number(r.updated_at),
        deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
        clientChangeId: r.client_change_id,
        encrypted: Boolean(r.encrypted),
        payload: r.payload_json
      })),
      serverVersion,
      hasMore,
      nextCursor
    };
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

  public async clearSearchHistory(userId: string, profileId: string): Promise<void> {
    await this.pool.query('DELETE FROM search_history WHERE user_id = $1 AND profile_id = $2', [
      userId,
      profileId
    ]);
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
    const syncRecords = (await this.pool.query('SELECT * FROM sync_records WHERE user_id = $1', [userId]))
      .rows;

    return {
      exportedAt: new Date().toISOString(),
      user: user
        ? {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl ?? null,
            emailVerified: Boolean(user.emailVerified),
            e2eeEnabled: Boolean(user.e2eeEnabled),
            createdAt: user.createdAt
          }
        : null,
      profiles,
      devices,
      bookmarks,
      notes,
      searchHistory,
      researchReports,
      memoryItems,
      syncRecords
    };
  }

  public async deleteUserAccount(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }

  private mapLavrayDocRow(r: Record<string, any>): LavrayIndexDocument {
    return {
      id: r.id,
      url: r.url,
      canonicalUrl: r.canonical_url,
      title: r.title,
      mainContent: r.main_content,
      snippet: r.snippet,
      headings: Array.isArray(r.headings_json) ? r.headings_json : [],
      language: r.language,
      sourceDomain: r.source_domain,
      contentType: r.content_type,
      contentHash: r.content_hash,
      authorityScore: Number(r.authority_score),
      authorityMethod: r.authority_method,
      publishedAt: r.published_at ?? null,
      crawledAt: Number(r.crawled_at),
      indexVersion: r.index_version,
      embedding: Array.isArray(r.embedding_json) ? r.embedding_json : []
    };
  }

  public async upsertLavrayIndexDocument(
    doc: LavrayIndexDocument
  ): Promise<{ inserted: boolean; updated: boolean }> {
    const existing = await this.getLavrayIndexDocument(doc.canonicalUrl);
    await this.pool.query(
      `INSERT INTO lavray_index_documents
        (id, url, canonical_url, title, main_content, snippet, headings_json, language, source_domain, content_type, content_hash, authority_score, authority_method, published_at, crawled_at, index_version, embedding_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
       ON CONFLICT (canonical_url) DO UPDATE SET
         url = EXCLUDED.url, title = EXCLUDED.title, main_content = EXCLUDED.main_content, snippet = EXCLUDED.snippet,
         headings_json = EXCLUDED.headings_json, language = EXCLUDED.language, content_type = EXCLUDED.content_type,
         content_hash = EXCLUDED.content_hash, authority_score = EXCLUDED.authority_score, authority_method = EXCLUDED.authority_method,
         published_at = EXCLUDED.published_at, crawled_at = EXCLUDED.crawled_at, index_version = EXCLUDED.index_version,
         embedding_json = EXCLUDED.embedding_json`,
      [
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
      ]
    );
    if (!existing) return { inserted: true, updated: false };
    return { inserted: false, updated: existing.contentHash !== doc.contentHash };
  }

  public async removeLavrayIndexDocument(canonicalUrl: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM lavray_index_documents WHERE canonical_url = $1', [
      canonicalUrl
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  public async getLavrayIndexDocument(canonicalUrl: string): Promise<LavrayIndexDocument | null> {
    const res = await this.pool.query(
      'SELECT * FROM lavray_index_documents WHERE canonical_url = $1 LIMIT 1',
      [canonicalUrl]
    );
    return res.rows[0] ? this.mapLavrayDocRow(res.rows[0]) : null;
  }

  public async findLavrayDocumentByContentHash(contentHash: string): Promise<LavrayIndexDocument | null> {
    const res = await this.pool.query(
      'SELECT * FROM lavray_index_documents WHERE content_hash = $1 LIMIT 1',
      [contentHash]
    );
    return res.rows[0] ? this.mapLavrayDocRow(res.rows[0]) : null;
  }

  public async searchLavrayIndex(params: {
    query: string;
    queryEmbedding: number[];
    domains?: string[];
    limit?: number;
  }): Promise<Array<{ document: LavrayIndexDocument; lexicalScore: number; semanticScore: number }>> {
    const domains = params.domains && params.domains.length > 0 ? params.domains.map((d) => d.toLowerCase()) : null;
    const res = await this.pool.query(
      `WITH q AS (
         SELECT
           plainto_tsquery('english', $1) AS and_q,
           NULLIF(regexp_replace(plainto_tsquery('english', $1)::text, ' & ', ' | ', 'g'), '')::tsquery AS or_q
       )
       SELECT
         d.*,
         COALESCE(d.tsv @@ q.and_q, FALSE) AS fts_exact,
         COALESCE(d.tsv @@ q.or_q, FALSE) AS fts_any,
         CASE WHEN d.tsv @@ q.and_q THEN COALESCE(ts_rank(d.tsv, q.and_q), 0) ELSE 0 END AS and_rank,
         CASE WHEN d.tsv @@ q.or_q THEN COALESCE(ts_rank(d.tsv, q.or_q), 0) ELSE 0 END AS or_rank
       FROM lavray_index_documents d
       CROSS JOIN q
       WHERE ($2::text[] IS NULL OR d.source_domain = ANY($2::text[]))
       ORDER BY and_rank DESC, or_rank DESC, d.crawled_at DESC
       LIMIT 100`,
      [params.query, domains]
    );

    return res.rows
      .map((r) => {
        const doc = this.mapLavrayDocRow(r);
        const ftsExact = Boolean(r.fts_exact);
        const ftsAny = Boolean(r.fts_any);
        const lexicalScore = Math.min(1, Math.max(Number(r.and_rank || 0), Number(r.or_rank || 0) * 0.65));
        const semanticScore = cosineSimilarity(params.queryEmbedding, doc.embedding);
        return { document: doc, lexicalScore, semanticScore, ftsMatched: ftsExact || ftsAny };
      })
      .filter((x) => x.ftsMatched || x.lexicalScore > 0.02 || x.semanticScore > 0.45)
      .sort((a, b) => (b.lexicalScore * 0.6 + b.semanticScore * 0.4) - (a.lexicalScore * 0.6 + a.semanticScore * 0.4))
      .slice(0, params.limit ?? 20)
      .map(({ document, lexicalScore, semanticScore }) => ({ document, lexicalScore, semanticScore }));
  }

  public async getLavrayIndexStats(): Promise<LavrayIndexStats> {
    const res = await this.pool.query<{
      total: string;
      domains: string;
      latest: string | null;
    }>('SELECT COUNT(*)::text AS total, COUNT(DISTINCT source_domain)::text AS domains, MAX(crawled_at)::text AS latest FROM lavray_index_documents');
    const row = res.rows[0];
    const total = Number(row?.total ?? 0);
    const uniqueDomains = Number(row?.domains ?? 0);
    const latestCrawlAt = row?.latest ? Number(row.latest) : null;
    const limitedCoverage = total < 50;
    return {
      totalDocuments: total,
      uniqueDomains,
      latestCrawlAt,
      indexVersion: 'v1',
      limitedCoverage,
      notice: limitedCoverage
        ? `LAVRAY Index currently contains ${total} crawled document(s) across ${uniqueDomains} domain(s) (controlled seed scope).`
        : `LAVRAY Index serving ${total} documents across ${uniqueDomains} domains.`
    };
  }

  public async saveCrawlCheckpoint(cp: CrawlCheckpoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO crawl_checkpoints (id, status, state_json, started_at, updated_at, completed_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, state_json = EXCLUDED.state_json, updated_at = EXCLUDED.updated_at, completed_at = EXCLUDED.completed_at`,
      [cp.id, cp.status, JSON.stringify(cp), cp.startedAt, cp.updatedAt, cp.completedAt ?? null]
    );
  }

  public async getCrawlCheckpoint(id: string): Promise<CrawlCheckpoint | null> {
    const res = await this.pool.query('SELECT state_json FROM crawl_checkpoints WHERE id = $1 LIMIT 1', [
      id
    ]);
    return res.rows[0] ? (res.rows[0].state_json as CrawlCheckpoint) : null;
  }

  public async listCrawlCheckpoints(limit = 20): Promise<CrawlCheckpoint[]> {
    const res = await this.pool.query(
      'SELECT state_json FROM crawl_checkpoints ORDER BY updated_at DESC LIMIT $1',
      [limit]
    );
    return res.rows.map((r) => r.state_json as CrawlCheckpoint);
  }
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PostgresCloudRepository, runPostgresMigrations } from '../../src/backend/db/postgres-repository';
import { DEFAULT_CLOUD_CONSENT } from '../../src/shared/types';
import { hashPassword, hashToken } from '../../src/backend/security/auth-crypto';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const describePg = DATABASE_URL ? describe : describe.skip;

describePg('PostgreSQL Real Migrations, Advisory-Lock Sync Concurrency & Atomic Token Consumption', () => {
  let pool: Pool;
  let repo: PostgresCloudRepository;
  const userId = randomUUID();
  const profileId = randomUUID();
  const deviceId = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
    const migrationsDir = path.resolve(process.cwd(), 'src/backend/db/migrations');
    await runPostgresMigrations(pool, migrationsDir);
    // Re-running migrations must be idempotent
    await runPostgresMigrations(pool, migrationsDir);
    repo = new PostgresCloudRepository(pool);
  });

  afterAll(async () => {
    await repo.deleteUserAccount(userId).catch(() => undefined);
    await repo.close();
  });

  it('creates user/profile/device, enforces atomic token consumption, and serializes concurrent sync pushes', async () => {
    const now = Date.now();
    await repo.createUserWithProfile({
      user: {
        id: userId,
        email: `pg-test-${userId}@lavray.test`,
        passwordHash: await hashPassword('StrongPassword123!'),
        displayName: 'PG Test',
        tokenEpoch: 1,
        createdAt: now,
        updatedAt: now
      },
      profile: {
        id: profileId,
        userId,
        name: 'Default',
        settings: {},
        consent: { ...DEFAULT_CLOUD_CONSENT, syncBookmarks: true },
        createdAt: now,
        updatedAt: now
      }
    });

    await repo.registerDevice({
      id: deviceId,
      userId,
      profileId,
      deviceName: 'PG Runner',
      platform: 'linux',
      appVersion: '1.0.0',
      lastSeenAt: now,
      revokedAt: null,
      createdAt: now
    });

    // Single-query auth state check
    const authState = await repo.getAuthSessionState(userId, deviceId);
    expect(authState).toEqual({ exists: true, tokenEpoch: 1, deviceRevoked: false });

    // Atomic single-use token consumption under concurrent race
    const tokenHash = hashToken(`pg-tok-${randomUUID()}`);
    await repo.saveAccountToken({
      id: randomUUID(),
      userId,
      purpose: 'email_verify',
      tokenHash,
      expiresAt: now + 60_000,
      createdAt: now
    });
    const [c1, c2] = await Promise.all([
      repo.consumeAccountToken(tokenHash, 'email_verify', now + 1),
      repo.consumeAccountToken(tokenHash, 'email_verify', now + 2)
    ]);
    expect([Boolean(c1), Boolean(c2)].filter(Boolean).length).toBe(1);

    // Concurrent sync pushes serialized via pg_advisory_xact_lock -> strictly monotonic versions 1..5
    const pushes = await Promise.all(
      [1, 2, 3, 4, 5].map((idx) =>
        repo.pushSyncRecords({
          userId,
          profileId,
          items: [
            {
              id: `bm-pg-${idx}`,
              entityType: 'bookmark',
              baseVersion: 0,
              updatedAt: now + idx,
              clientChangeId: `pg-chg-${idx}`,
              encrypted: false,
              payload: { url: `https://example.com/${idx}`, title: `Item ${idx}` }
            }
          ]
        })
      )
    );
    const versions = pushes.map((p) => p.applied[0].version).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2, 3, 4, 5]);
  });
});

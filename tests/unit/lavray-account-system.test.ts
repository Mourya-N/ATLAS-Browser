import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startCloudServer } from '../../src/backend/api/server';
import { loadBackendConfig } from '../../src/backend/config';
import {
  decryptSyncPayload,
  encryptSyncPayload,
  generateMasterKeyB64,
  generateRecoveryKey,
  unwrapMasterKeyWithRecoveryKey,
  wrapMasterKeyWithRecoveryKey
} from '../../src/main/cloud/e2ee-crypto';
import type {
  CloudAuthSession,
  CloudDevice,
  E2eeKeyEnvelope,
  EncryptedPayloadEnvelope,
  SyncPullResponse,
  SyncPushResponse
} from '../../src/shared/types';

describe('LAVRAY Account System, E2EE, Device Revocation & Versioned Sync', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const config = {
      ...loadBackendConfig(),
      port: 0,
      host: '127.0.0.1',
      nodeEnv: 'test' as const,
      jwtSecret: 'test-jwt-secret-lavray-account-system-32chars',
      rateLimitPerMinute: 1000,
      searchRateLimitPerMinute: 1000
    };
    const started = await startCloudServer({ config });
    baseUrl = `http://127.0.0.1:${started.port}`;
    closeServer = started.stop;
  });

  afterAll(async () => {
    await closeServer();
  });

  it('supports registration, email verification, profile update, forgot/reset password, and session revocation', async () => {
    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@lavray.test',
        password: 'Password123!',
        displayName: 'Alice',
        deviceId: 'dev-alice-1',
        deviceName: 'MacBook Pro'
      })
    });
    expect(regRes.status).toBe(201);
    const reg = (await regRes.json()) as CloudAuthSession;
    expect(reg.user.email).toBe('alice@lavray.test');
    expect(reg.verificationRequired).toBe(true);
    expect(reg.devVerificationToken).toBeTruthy();

    // Verify email
    const verifyRes = await fetch(`${baseUrl}/api/v1/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: reg.devVerificationToken })
    });
    expect(verifyRes.status).toBe(200);
    const verifiedBody = (await verifyRes.json()) as { verified: boolean; user: { emailVerified: boolean } };
    expect(verifiedBody.verified).toBe(true);
    expect(verifiedBody.user.emailVerified).toBe(true);

    // Update profile
    const profRes = await fetch(`${baseUrl}/api/v1/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reg.accessToken}`
      },
      body: JSON.stringify({ displayName: 'Alice Lavray' })
    });
    expect(profRes.status).toBe(200);
    const profBody = (await profRes.json()) as { user: { displayName: string } };
    expect(profBody.user.displayName).toBe('Alice Lavray');

    // Forgot & reset password revokes existing refresh tokens
    const forgotRes = await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@lavray.test' })
    });
    const forgot = (await forgotRes.json()) as { accepted: boolean; devResetToken?: string };
    expect(forgot.accepted).toBe(true);
    expect(forgot.devResetToken).toBeTruthy();

    const resetRes = await fetch(`${baseUrl}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: forgot.devResetToken, newPassword: 'NewPassword456!' })
    });
    expect(resetRes.status).toBe(200);

    // Old refresh token must now fail
    const oldRefreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: reg.refreshToken })
    });
    expect(oldRefreshRes.status).toBe(401);

    // Login with new password succeeds
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@lavray.test',
        password: 'NewPassword456!',
        deviceId: 'dev-alice-1',
        deviceName: 'MacBook Pro'
      })
    });
    expect(loginRes.status).toBe(200);
  });

  it('enforces device revocation and blocks revoked device refresh tokens', async () => {
    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'devices@lavray.test',
        password: 'Password123!',
        deviceId: 'dev-1',
        deviceName: 'Desktop 1'
      })
    });
    const dev1 = (await regRes.json()) as CloudAuthSession;

    const dev2Res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'devices@lavray.test',
        password: 'Password123!',
        deviceId: 'dev-2',
        deviceName: 'Laptop 2'
      })
    });
    const dev2 = (await dev2Res.json()) as CloudAuthSession;

    const listRes = await fetch(`${baseUrl}/api/v1/devices`, {
      headers: { Authorization: `Bearer ${dev1.accessToken}` }
    });
    const { devices } = (await listRes.json()) as { devices: CloudDevice[] };
    expect(devices.length).toBe(2);
    expect(devices.find((d) => d.id === 'dev-1')?.isCurrent).toBe(true);

    // Revoke dev-2 from dev-1
    const revokeRes = await fetch(`${baseUrl}/api/v1/devices/dev-2`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${dev1.accessToken}` }
    });
    expect(revokeRes.status).toBe(200);

    // dev-2 refresh token must be rejected
    const refreshDev2 = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: dev2.refreshToken })
    });
    expect(refreshDev2.status).toBe(401);
  });

  it('supports versioned sync, idempotency, conflict detection, tombstones, pagination, E2EE, and cross-account isolation', async () => {
    const userARes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sync-a@lavray.test', password: 'Password123!', deviceId: 'dev-a' })
    });
    const userA = (await userARes.json()) as CloudAuthSession;

    const userBRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sync-b@lavray.test', password: 'Password123!', deviceId: 'dev-b' })
    });
    const userB = (await userBRes.json()) as CloudAuthSession;

    // Pushing without consent fails with 403
    const deniedRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.accessToken}`
      },
      body: JSON.stringify({
        items: [
          {
            id: 'conv-1',
            entityType: 'haya_conversation',
            baseVersion: 0,
            updatedAt: 1000,
            clientChangeId: 'chg-denied',
            encrypted: false,
            payload: { title: 'Secret' }
          }
        ]
      })
    });
    expect(deniedRes.status).toBe(403);

    // Enable bookmarks + HAYA conversation sync consent
    await fetch(`${baseUrl}/api/v1/profile/consent`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.accessToken}`
      },
      body: JSON.stringify({ syncBookmarks: true, syncHayaConversations: true, e2eeEnabled: true })
    });

    // Setup E2EE key & recovery envelope
    const masterKeyB64 = generateMasterKeyB64();
    const recoveryKey = generateRecoveryKey();
    const keyEnvelope: E2eeKeyEnvelope = wrapMasterKeyWithRecoveryKey(masterKeyB64, recoveryKey, 1);

    const e2eePut = await fetch(`${baseUrl}/api/v1/account/e2ee`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.accessToken}`
      },
      body: JSON.stringify({ e2eeEnabled: true, e2eeKeyVersion: 1, envelope: keyEnvelope })
    });
    expect(e2eePut.status).toBe(200);

    // Encrypt HAYA conversation client-side
    const encryptedHaya = encryptSyncPayload(
      { title: 'My Private HAYA Research', messages: [{ role: 'user', content: 'top secret query' }] },
      masterKeyB64,
      1,
      'lavray:sync:haya_conversation:conv-1'
    );
    expect(JSON.stringify(encryptedHaya)).not.toContain('top secret query');

    // Push bookmark + encrypted HAYA conversation + extra bookmarks for pagination
    const pushRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.accessToken}`
      },
      body: JSON.stringify({
        items: [
          {
            id: 'bm-1',
            entityType: 'bookmark',
            baseVersion: 0,
            updatedAt: 1000,
            clientChangeId: 'chg-bm-1',
            encrypted: false,
            payload: { url: 'https://lavray.dev', title: 'LAVRAY' }
          },
          {
            id: 'conv-1',
            entityType: 'haya_conversation',
            baseVersion: 0,
            updatedAt: 1001,
            clientChangeId: 'chg-conv-1',
            encrypted: true,
            payload: encryptedHaya as unknown as Record<string, unknown>
          },
          {
            id: 'bm-2',
            entityType: 'bookmark',
            baseVersion: 0,
            updatedAt: 1002,
            clientChangeId: 'chg-bm-2',
            encrypted: false,
            payload: { url: 'https://example.com', title: 'Example' }
          }
        ]
      })
    });
    const pushBody = (await pushRes.json()) as SyncPushResponse;
    expect(pushBody.applied.length).toBe(3);
    expect(pushBody.conflicts.length).toBe(0);

    // Idempotent duplicate clientChangeId returns same version
    const dupRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.accessToken}`
      },
      body: JSON.stringify({
        items: [
          {
            id: 'bm-1',
            entityType: 'bookmark',
            baseVersion: 0,
            updatedAt: 1000,
            clientChangeId: 'chg-bm-1',
            encrypted: false,
            payload: { url: 'https://lavray.dev', title: 'LAVRAY' }
          }
        ]
      })
    });
    const dupBody = (await dupRes.json()) as SyncPushResponse;
    expect(dupBody.applied[0].version).toBe(pushBody.applied[0].version);

    // Stale baseVersion triggers conflict
    const conflictRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.accessToken}`
      },
      body: JSON.stringify({
        items: [
          {
            id: 'bm-1',
            entityType: 'bookmark',
            baseVersion: 0,
            updatedAt: 1500,
            clientChangeId: 'chg-bm-1-stale',
            encrypted: false,
            payload: { url: 'https://lavray.dev', title: 'Stale Edit' }
          }
        ]
      })
    });
    const conflictBody = (await conflictRes.json()) as SyncPushResponse;
    expect(conflictBody.conflicts.length).toBe(1);

    // Tombstone deletion
    const delRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userA.accessToken}`
      },
      body: JSON.stringify({
        items: [
          {
            id: 'bm-2',
            entityType: 'bookmark',
            baseVersion: pushBody.applied[2].version,
            updatedAt: 2000,
            deletedAt: 2000,
            clientChangeId: 'chg-bm-2-del',
            encrypted: false,
            payload: { deleted: true }
          }
        ]
      })
    });
    expect(delRes.status).toBe(200);

    // Paginated pull (limit=2)
    const pull1Res = await fetch(`${baseUrl}/api/v1/sync/pull?sinceVersion=0&limit=2`, {
      headers: { Authorization: `Bearer ${userA.accessToken}` }
    });
    const pull1 = (await pull1Res.json()) as SyncPullResponse;
    expect(pull1.items.length).toBe(2);
    expect(pull1.hasMore).toBe(true);

    const pull2Res = await fetch(`${baseUrl}/api/v1/sync/pull?sinceVersion=${pull1.nextCursor}&limit=2`, {
      headers: { Authorization: `Bearer ${userA.accessToken}` }
    });
    const pull2 = (await pull2Res.json()) as SyncPullResponse;
    expect(pull2.items.length).toBe(1);
    expect(pull2.items[0].deletedAt).toBe(2000);

    // New device unwraps E2EE key with Recovery Key & decrypts HAYA conversation
    const e2eeGet = await fetch(`${baseUrl}/api/v1/account/e2ee`, {
      headers: { Authorization: `Bearer ${userA.accessToken}` }
    });
    const { envelope } = (await e2eeGet.json()) as { envelope: E2eeKeyEnvelope };
    const unwrapped = unwrapMasterKeyWithRecoveryKey(envelope, recoveryKey);
    expect(unwrapped).toBe(masterKeyB64);

    // Wrong recovery key throws
    expect(() => unwrapMasterKeyWithRecoveryKey(envelope, 'WRONG-KEY-0000')).toThrow();

    const encRecord = pull1.items.find((i) => i.id === 'conv-1')!;
    const decrypted = decryptSyncPayload(
      encRecord.payload as EncryptedPayloadEnvelope,
      unwrapped,
      'lavray:sync:haya_conversation:conv-1'
    );
    expect(decrypted.title).toBe('My Private HAYA Research');

    // Cross-account isolation: User B sees 0 records
    const pullBRes = await fetch(`${baseUrl}/api/v1/sync/pull?sinceVersion=0&limit=50`, {
      headers: { Authorization: `Bearer ${userB.accessToken}` }
    });
    const pullB = (await pullBRes.json()) as SyncPullResponse;
    expect(pullB.items.length).toBe(0);

    // Export & delete User A
    const exportRes = await fetch(`${baseUrl}/api/v1/account/export`, {
      headers: { Authorization: `Bearer ${userA.accessToken}` }
    });
    const exported = (await exportRes.json()) as { syncRecords: unknown[] };
    expect(exported.syncRecords.length).toBeGreaterThan(0);

    const deleteAccountRes = await fetch(`${baseUrl}/api/v1/account`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userA.accessToken}` }
    });
    expect(deleteAccountRes.status).toBe(200);

    const afterDeleteLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sync-a@lavray.test', password: 'Password123!' })
    });
    expect(afterDeleteLogin.status).toBe(401);
  });
});

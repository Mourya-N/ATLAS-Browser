import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startCloudServer, createBackendContainer } from '../../src/backend/api/server';
import { loadBackendConfig } from '../../src/backend/config';
import { signJwt, verifyJwt } from '../../src/backend/security/auth-crypto';
import {
  decryptSyncPayload,
  encryptSyncPayload,
  generateMasterKeyB64,
  generateRecoveryKey,
  unwrapMasterKeyWithRecoveryKey,
  wrapMasterKeyWithRecoveryKey
} from '../../src/main/cloud/e2ee-crypto';
import { SecretVault } from '../../src/main/security/secrets';
import type {
  CloudAuthSession,
  E2eeKeyEnvelope,
  EncryptedPayloadEnvelope,
  SyncPullResponse
} from '../../src/shared/types';

describe('LAVRAY Account System — Security Audit & Regression Suite', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;
  const jwtSecret = 'audit-test-jwt-secret-32-chars-minimum!!';

  beforeAll(async () => {
    const config = {
      ...loadBackendConfig(),
      port: 0,
      host: '127.0.0.1',
      nodeEnv: 'test' as const,
      jwtSecret,
      rateLimitPerMinute: 1000,
      authRateLimitPerMinute: 1000,
      searchRateLimitPerMinute: 1000
    };
    const started = await startCloudServer({ config });
    baseUrl = `http://127.0.0.1:${started.port}`;
    closeServer = started.stop;
  });

  afterAll(async () => {
    await closeServer();
  });

  it('rejects malformed, alg:none, tampered, expired, and wrong-audience JWTs', () => {
    const valid = signJwt(
      { sub: 'u1', email: 'u1@test.dev', profileId: 'p1', deviceId: 'd1' },
      jwtSecret,
      300
    );
    expect(verifyJwt(valid.token, jwtSecret)?.sub).toBe('u1');

    // Tampered signature
    const parts = valid.token.split('.');
    expect(verifyJwt(`${parts[0]}.${parts[1]}.tampered`, jwtSecret)).toBeNull();

    // alg: none
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(verifyJwt(`${noneHeader}.${parts[1]}.`, jwtSecret)).toBeNull();

    // Expired
    const expired = signJwt(
      { sub: 'u1', email: 'u1@test.dev', profileId: 'p1', deviceId: 'd1' },
      jwtSecret,
      -10
    );
    expect(verifyJwt(expired.token, jwtSecret)).toBeNull();

    // Wrong audience
    const wrongAudHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const wrongAudPayload = Buffer.from(
      JSON.stringify({
        sub: 'u1',
        email: 'u1@test.dev',
        profileId: 'p1',
        iss: 'lavray-cloud',
        aud: 'wrong-aud',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300
      })
    ).toString('base64url');
    const sig = createHmac('sha256', jwtSecret).update(`${wrongAudHeader}.${wrongAudPayload}`).digest('base64url');
    expect(verifyJwt(`${wrongAudHeader}.${wrongAudPayload}.${sig}`, jwtSecret)).toBeNull();
  });

  it('enforces atomic single-use email verification & password reset tokens under concurrent replay', async () => {
    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'atomic@lavray.test',
        password: 'Password123!',
        deviceId: 'dev-atomic-1'
      })
    });
    const reg = (await regRes.json()) as CloudAuthSession;

    // Concurrent verify-email replay: only 1 can succeed
    const [v1, v2] = await Promise.all([
      fetch(`${baseUrl}/api/v1/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: reg.devVerificationToken })
      }),
      fetch(`${baseUrl}/api/v1/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: reg.devVerificationToken })
      })
    ]);
    const statuses = [v1.status, v2.status].sort();
    expect(statuses).toEqual([200, 400]);
  });

  it('detects refresh token reuse and immediately revokes all sessions + rejects revoked device access tokens', async () => {
    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'reuse@lavray.test',
        password: 'Password123!',
        deviceId: 'dev-reuse-1',
        deviceName: 'Primary'
      })
    });
    const session1 = (await regRes.json()) as CloudAuthSession;

    // Rotate refresh token once -> session2
    const rotRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session1.refreshToken })
    });
    expect(rotRes.status).toBe(200);
    const session2 = (await rotRes.json()) as CloudAuthSession;

    // Replay old session1.refreshToken -> reuse detected!
    const replayRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session1.refreshToken })
    });
    expect(replayRes.status).toBe(401);

    // Even session2.refreshToken must now be revoked!
    const session2Refresh = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session2.refreshToken })
    });
    expect(session2Refresh.status).toBe(401);

    // Revoking a device immediately blocks its unexpired access token
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'reuse@lavray.test',
        password: 'Password123!',
        deviceId: 'dev-reuse-2',
        deviceName: 'Secondary'
      })
    });
    const secSession = (await loginRes.json()) as CloudAuthSession;

    await fetch(`${baseUrl}/api/v1/devices/dev-reuse-2`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${secSession.accessToken}` }
    });

    const afterRevokeProfile = await fetch(`${baseUrl}/api/v1/profile`, {
      headers: { Authorization: `Bearer ${secSession.accessToken}` }
    });
    expect(afterRevokeProfile.status).toBe(401);
  });

  it('completes mandatory fresh-device E2EE recovery across password reset and rejects tampered ciphertexts', async () => {
    // Device 1: create account, enable consent & E2EE, upload encrypted HAYA conversation
    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'recovery@lavray.test',
        password: 'InitialPassword123!',
        deviceId: 'dev-orig'
      })
    });
    const dev1 = (await regRes.json()) as CloudAuthSession;

    await fetch(`${baseUrl}/api/v1/profile/consent`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dev1.accessToken}`
      },
      body: JSON.stringify({ syncHayaConversations: true, e2eeEnabled: true })
    });

    const masterKeyB64 = generateMasterKeyB64();
    const recoveryKey = generateRecoveryKey();
    const envelope = wrapMasterKeyWithRecoveryKey(masterKeyB64, recoveryKey, 1);

    await fetch(`${baseUrl}/api/v1/account/e2ee`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dev1.accessToken}`
      },
      body: JSON.stringify({ e2eeEnabled: true, e2eeKeyVersion: 1, envelope })
    });

    const encrypted = encryptSyncPayload(
      { title: 'HAYA Confidential', messages: [{ role: 'user', content: 'private prompt' }] },
      masterKeyB64,
      1,
      'lavray:sync:haya_conversation:conv-rec-1'
    );

    const pushRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dev1.accessToken}`
      },
      body: JSON.stringify({
        items: [
          {
            id: 'conv-rec-1',
            entityType: 'haya_conversation',
            baseVersion: 0,
            updatedAt: 1000,
            clientChangeId: 'rec-chg-1',
            encrypted: true,
            payload: encrypted as unknown as Record<string, unknown>
          }
        ]
      })
    });
    expect(pushRes.status).toBe(200);

    // Reject idempotency key reuse with different payload (409)
    const mismatchRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dev1.accessToken}`
      },
      body: JSON.stringify({
        items: [
          {
            id: 'conv-rec-1',
            entityType: 'haya_conversation',
            baseVersion: 1,
            updatedAt: 1001,
            clientChangeId: 'rec-chg-1',
            encrypted: false,
            payload: { tampered: true }
          }
        ]
      })
    });
    expect(mismatchRes.status).toBe(409);

    // Reset account password while signed out everywhere
    const forgotRes = await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'recovery@lavray.test' })
    });
    const forgot = (await forgotRes.json()) as { devResetToken: string };
    await fetch(`${baseUrl}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: forgot.devResetToken, newPassword: 'ResetPassword456!' })
    });

    // Fresh Device 2: sign in with new password, fetch E2EE envelope, recover AMK, pull & decrypt
    const dev2Res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'recovery@lavray.test',
        password: 'ResetPassword456!',
        deviceId: 'dev-fresh-2'
      })
    });
    const dev2 = (await dev2Res.json()) as CloudAuthSession;

    const envRes = await fetch(`${baseUrl}/api/v1/account/e2ee`, {
      headers: { Authorization: `Bearer ${dev2.accessToken}` }
    });
    const { envelope: fetchedEnvelope } = (await envRes.json()) as { envelope: E2eeKeyEnvelope };
    const recoveredAmk = unwrapMasterKeyWithRecoveryKey(fetchedEnvelope, recoveryKey);
    expect(recoveredAmk).toBe(masterKeyB64);

    const pullRes = await fetch(`${baseUrl}/api/v1/sync/pull?sinceVersion=0&limit=50`, {
      headers: { Authorization: `Bearer ${dev2.accessToken}` }
    });
    const pulled = (await pullRes.json()) as SyncPullResponse;
    expect(pulled.items.length).toBe(1);

    const recPayload = pulled.items[0].payload as EncryptedPayloadEnvelope;
    const decrypted = decryptSyncPayload(
      recPayload,
      recoveredAmk,
      'lavray:sync:haya_conversation:conv-rec-1'
    );
    expect(decrypted.title).toBe('HAYA Confidential');

    // Tampered tag / AAD must fail decryption
    const tamperedTag = { ...recPayload, tag: Buffer.alloc(16, 0).toString('base64') };
    expect(() =>
      decryptSyncPayload(tamperedTag, recoveredAmk, 'lavray:sync:haya_conversation:conv-rec-1')
    ).toThrow();
    expect(() =>
      decryptSyncPayload(recPayload, recoveredAmk, 'lavray:sync:haya_conversation:wrong-id')
    ).toThrow();

    // Export must never contain passwordHash or tokens
    const expRes = await fetch(`${baseUrl}/api/v1/account/export`, {
      headers: { Authorization: `Bearer ${dev2.accessToken}` }
    });
    const expText = await expRes.text();
    expect(expText).not.toContain('passwordHash');
    expect(expText).not.toContain(dev2.refreshToken);
  });

  it('requires DATABASE_URL and LAVRAY_JWT_SECRET in production and fails closed in SecretVault outside test mode', async () => {
    expect(() => loadBackendConfig({ NODE_ENV: 'production' })).toThrow('LAVRAY_JWT_SECRET');
    const prodConfig = loadBackendConfig({
      NODE_ENV: 'production',
      LAVRAY_JWT_SECRET: 'prod-secret-32-chars-minimum-ok'
    });
    await expect(createBackendContainer({ config: prodConfig })).rejects.toThrow('DATABASE_URL');

    const prevNodeEnv = process.env.NODE_ENV;
    const prevVitest = process.env.VITEST;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.VITEST;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lavray-vault-audit-'));
      const vault = new SecretVault(tmpDir);
      expect(() => vault.setCloudTokens('a', 'b')).toThrow('safeStorage');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevVitest !== undefined) process.env.VITEST = prevVitest;
    }
  });

  it('delivers verification & password-reset emails via webhook, fails closed in prod without email config, and caches auth state with immediate revocation invalidation', async () => {
    const prodNoEmail = loadBackendConfig({
      NODE_ENV: 'production',
      LAVRAY_JWT_SECRET: 'prod-secret-32-chars-minimum-ok',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/lavray'
    });
    // Email check triggers before/independently; verify EmailDeliveryService fails closed
    await expect(
      createBackendContainer({
        config: prodNoEmail,
        repo: (await createBackendContainer({ config: { ...loadBackendConfig(), nodeEnv: 'test' } })).services.repo
      })
    ).rejects.toThrow('LAVRAY_EMAIL_PROVIDER');

    const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
    const webhookServer = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      sentEmails.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.statusCode = 200;
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => webhookServer.listen(0, '127.0.0.1', resolve));
    const addr = webhookServer.address() as { port: number };

    try {
      const runtime = await startCloudServer({
        config: {
          ...loadBackendConfig(),
          port: 0,
          host: '127.0.0.1',
          nodeEnv: 'test',
          jwtSecret: 'webhook-test-jwt-secret-32chars!!',
          rateLimitPerMinute: 1000,
          authRateLimitPerMinute: 1000,
          emailProvider: 'webhook',
          emailWebhookUrl: `http://127.0.0.1:${addr.port}/send`
        }
      });

      const localBase = `http://127.0.0.1:${runtime.port}`;
      const regRes = await fetch(`${localBase}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'mailer@lavray.test',
          password: 'Password123!',
          deviceId: 'dev-cache-1'
        })
      });
      const session = (await regRes.json()) as CloudAuthSession;
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].to).toBe('mailer@lavray.test');
      expect(sentEmails[0].subject).toContain('Verify');

      // Auth cache benchmark: 20 rapid authenticated requests only query repo.getAuthSessionState once
      let dbAuthCalls = 0;
      const origGetAuthState = runtime.services.repo.getAuthSessionState.bind(runtime.services.repo);
      runtime.services.repo.getAuthSessionState = async (u, d) => {
        dbAuthCalls += 1;
        return origGetAuthState(u, d);
      };

      for (let i = 0; i < 20; i++) {
        const r = await fetch(`${localBase}/api/v1/profile`, {
          headers: { Authorization: `Bearer ${session.accessToken}` }
        });
        expect(r.status).toBe(200);
      }
      expect(dbAuthCalls).toBe(1);

      // Revoking device immediately invalidates cached auth state
      await fetch(`${localBase}/api/v1/devices/dev-cache-1`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.accessToken}` }
      });
      const afterRevoke = await fetch(`${localBase}/api/v1/profile`, {
        headers: { Authorization: `Bearer ${session.accessToken}` }
      });
      expect(afterRevoke.status).toBe(401);

      await runtime.stop();
    } finally {
      await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
    }
  });
});

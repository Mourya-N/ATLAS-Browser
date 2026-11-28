import { randomBytes, randomUUID } from 'node:crypto';
import {
  DEFAULT_CLOUD_CONSENT,
  type CloudAuthSession,
  type CloudConsentSettings,
  type CloudDevice,
  type CloudProfile,
  type CloudUser,
  type E2eeKeyEnvelope
} from '@shared/types';
import type { BackendConfig } from '../../config';
import type { CloudRepository, StoredUserRecord } from '../../db/repository';
import { EmailDeliveryService } from './email-delivery';
import {
  generateRefreshToken,
  hashPassword,
  hashToken,
  signJwt,
  verifyJwt,
  verifyPassword,
  type JwtClaims
} from '../../security/auth-crypto';

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 401
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class IdentityService {
  private readonly authStateCache = new Map<
    string,
    { exists: boolean; tokenEpoch: number; deviceRevoked: boolean; expiresAt: number }
  >();
  private readonly emailDelivery: EmailDeliveryService;

  constructor(
    private readonly repo: CloudRepository,
    private readonly config: BackendConfig,
    emailDelivery?: EmailDeliveryService
  ) {
    this.emailDelivery =
      emailDelivery ??
      new EmailDeliveryService({
        provider: config.emailProvider,
        from: config.emailFrom,
        resendApiKey: config.resendApiKey,
        webhookUrl: config.emailWebhookUrl,
        webhookBearer: config.emailWebhookBearer
      });
  }

  private invalidateAuthCacheForUser(userId: string): void {
    const prefix = `${userId}:`;
    for (const key of this.authStateCache.keys()) {
      if (key.startsWith(prefix)) {
        this.authStateCache.delete(key);
      }
    }
  }

  private toPublicUser(u: StoredUserRecord): CloudUser {
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl ?? null,
      emailVerified: Boolean(u.emailVerified),
      emailVerifiedAt: u.emailVerifiedAt ?? null,
      e2eeEnabled: Boolean(u.e2eeEnabled),
      e2eeKeyVersion: u.e2eeKeyVersion ?? 1,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    };
  }

  public async register(input: {
    email: string;
    password: string;
    displayName?: string;
    deviceId?: string;
    deviceName?: string;
    platform?: string;
    appVersion?: string;
  }): Promise<CloudAuthSession> {
    const cleanEmail = input.email.trim().toLowerCase();
    const existing = await this.repo.findUserByEmail(cleanEmail);
    if (existing) {
      throw new AuthError('Account with this email already exists', 409);
    }

    const now = Date.now();
    const userId = randomUUID();
    const profileId = randomUUID();
    const passwordHash = await hashPassword(input.password);
    const displayName = (input.displayName || cleanEmail.split('@')[0] || 'LAVRAY User').trim();

    const profile: CloudProfile = {
      id: profileId,
      userId,
      name: 'Default Profile',
      settings: {},
      consent: { ...DEFAULT_CLOUD_CONSENT },
      createdAt: now,
      updatedAt: now
    };

    const userRecord: StoredUserRecord = {
      id: userId,
      email: cleanEmail,
      passwordHash,
      displayName,
      avatarUrl: null,
      emailVerified: false,
      emailVerifiedAt: null,
      e2eeEnabled: false,
      e2eeKeyVersion: 1,
      e2eeKeyEnvelope: null,
      createdAt: now,
      updatedAt: now
    };

    await this.repo.createUserWithProfile({
      user: userRecord,
      profile
    });

    const deviceId = input.deviceId?.trim() || (input.deviceName ? randomUUID() : null);
    if (deviceId) {
      await this.repo.registerDevice({
        id: deviceId,
        userId,
        profileId,
        deviceName: input.deviceName || 'LAVRAY Desktop',
        platform: input.platform || process.platform,
        appVersion: input.appVersion || '1.0.0',
        lastSeenAt: now,
        revokedAt: null,
        createdAt: now
      });
    }

    // Issue email verification token & deliver via EmailDeliveryService
    const rawVerifyToken = randomBytes(18).toString('base64url');
    await this.repo.saveAccountToken({
      id: randomUUID(),
      userId,
      purpose: 'email_verify',
      tokenHash: hashToken(rawVerifyToken),
      expiresAt: now + 24 * 60 * 60 * 1000,
      createdAt: now
    });
    await this.emailDelivery.sendVerificationEmail({ to: cleanEmail, token: rawVerifyToken });

    await this.repo.logAudit({
      id: randomUUID(),
      userId,
      profileId,
      category: 'identity',
      action: 'user_registered',
      details: { email: cleanEmail, deviceId },
      createdAt: now
    });

    const session = await this.issueSession({
      user: this.toPublicUser(userRecord),
      profile,
      deviceId
    });
    return {
      ...session,
      verificationRequired: true,
      devVerificationToken: this.config.nodeEnv !== 'production' ? rawVerifyToken : null
    };
  }

  public async login(input: {
    email: string;
    password: string;
    deviceId?: string;
    deviceName?: string;
    platform?: string;
    appVersion?: string;
  }): Promise<CloudAuthSession> {
    const cleanEmail = input.email.trim().toLowerCase();
    const user = await this.repo.findUserByEmail(cleanEmail);
    if (!user) {
      throw new AuthError('Invalid email or password', 401);
    }
    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      throw new AuthError('Invalid email or password', 401);
    }

    const profiles = await this.repo.listProfiles(user.id);
    const profile = profiles[0];
    if (!profile) {
      throw new AuthError('No active profile found for user', 500);
    }

    const now = Date.now();
    const deviceId = input.deviceId?.trim() || (input.deviceName ? randomUUID() : null);
    if (deviceId) {
      await this.repo.registerDevice({
        id: deviceId,
        userId: user.id,
        profileId: profile.id,
        deviceName: input.deviceName || 'LAVRAY Desktop',
        platform: input.platform || process.platform,
        appVersion: input.appVersion || '1.0.0',
        lastSeenAt: now,
        revokedAt: null,
        createdAt: now
      });
    }

    await this.repo.logAudit({
      id: randomUUID(),
      userId: user.id,
      profileId: profile.id,
      category: 'identity',
      action: 'user_logged_in',
      details: { deviceId },
      createdAt: now
    });

    const session = await this.issueSession({
      user: this.toPublicUser(user),
      profile,
      deviceId
    });
    return {
      ...session,
      verificationRequired: !user.emailVerified
    };
  }

  public async refresh(rawRefreshToken: string): Promise<CloudAuthSession> {
    const tokenHash = hashToken(rawRefreshToken);
    const stored = await this.repo.findRefreshToken(tokenHash);
    if (!stored) {
      throw new AuthError('Invalid or expired refresh token', 401);
    }
    if (stored.revokedAt) {
      // Refresh token reuse detected — revoke all sessions for this user immediately
      await this.repo.revokeAllRefreshTokensForUser(stored.userId);
      await this.repo.logAudit({
        id: randomUUID(),
        userId: stored.userId,
        profileId: stored.profileId,
        category: 'security',
        action: 'refresh_token_reuse_detected',
        details: { deviceId: stored.deviceId ?? null },
        createdAt: Date.now()
      });
      throw new AuthError('Refresh token reuse detected; all sessions revoked', 401);
    }
    if (stored.expiresAt <= Date.now()) {
      throw new AuthError('Invalid or expired refresh token', 401);
    }

    if (stored.deviceId) {
      const device = await this.repo.getDevice(stored.userId, stored.deviceId);
      if (device && device.revokedAt) {
        await this.repo.revokeRefreshToken(tokenHash);
        throw new AuthError('Device session has been revoked', 401);
      }
    }

    const user = await this.repo.findUserById(stored.userId);
    const profile = user ? await this.repo.getProfile(user.id, stored.profileId) : null;
    if (!user || !profile) {
      throw new AuthError('Session user or profile no longer exists', 401);
    }

    // Rotate refresh token on each use
    await this.repo.revokeRefreshToken(tokenHash);
    return this.issueSession({
      user: this.toPublicUser(user),
      profile,
      deviceId: stored.deviceId ?? null
    });
  }

  public async logout(rawRefreshToken?: string): Promise<void> {
    if (rawRefreshToken) {
      await this.repo.revokeRefreshToken(hashToken(rawRefreshToken));
    }
  }

  public verifyAccessToken(authHeader?: string): JwtClaims | null {
    if (!authHeader) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
    if (!match) return null;
    return verifyJwt(match[1], this.config.jwtSecret);
  }

  public async getProfile(userId: string, profileId: string): Promise<CloudProfile | null> {
    return this.repo.getProfile(userId, profileId);
  }

  public async listProfiles(userId: string): Promise<CloudProfile[]> {
    return this.repo.listProfiles(userId);
  }

  public async createProfile(userId: string, name: string): Promise<CloudProfile> {
    const now = Date.now();
    return this.repo.createProfile({
      id: randomUUID(),
      userId,
      name: name.trim() || 'Profile',
      settings: {},
      consent: { ...DEFAULT_CLOUD_CONSENT },
      createdAt: now,
      updatedAt: now
    });
  }

  public async updateConsent(
    userId: string,
    profileId: string,
    patch: Partial<CloudConsentSettings>
  ): Promise<CloudProfile> {
    const current = await this.repo.getProfile(userId, profileId);
    if (!current) {
      throw new AuthError('Profile not found', 404);
    }
    const nextConsent: CloudConsentSettings = { ...current.consent, ...patch };
    const updated = await this.repo.updateProfileConsent(userId, profileId, nextConsent);
    if (!updated) throw new AuthError('Profile not found', 404);

    await this.repo.logAudit({
      id: randomUUID(),
      userId,
      profileId,
      category: 'privacy',
      action: 'consent_updated',
      details: { consent: nextConsent },
      createdAt: Date.now()
    });
    return updated;
  }

  public async registerDevice(
    userId: string,
    profileId: string,
    input: { deviceName: string; platform: string; appVersion: string }
  ): Promise<CloudDevice> {
    const now = Date.now();
    return this.repo.registerDevice({
      id: randomUUID(),
      userId,
      profileId,
      deviceName: input.deviceName,
      platform: input.platform,
      appVersion: input.appVersion,
      lastSeenAt: now,
      createdAt: now
    });
  }

  public async listDevices(userId: string, currentDeviceId?: string | null): Promise<CloudDevice[]> {
    const devices = await this.repo.listDevices(userId);
    return devices.map((d) => ({
      ...d,
      isCurrent: Boolean(currentDeviceId && d.id === currentDeviceId)
    }));
  }

  public async revokeDevice(userId: string, deviceId: string): Promise<CloudDevice> {
    const now = Date.now();
    const revoked = await this.repo.revokeDevice(userId, deviceId, now);
    if (!revoked) {
      throw new AuthError('Device not found', 404);
    }
    this.invalidateAuthCacheForUser(userId);
    await this.repo.logAudit({
      id: randomUUID(),
      userId,
      category: 'security',
      action: 'device_revoked',
      details: { deviceId },
      createdAt: now
    });
    return revoked;
  }

  public async revokeAllOtherSessions(userId: string, exceptDeviceId?: string | null): Promise<void> {
    await this.repo.revokeAllRefreshTokensForUser(userId, exceptDeviceId ?? undefined);
    this.invalidateAuthCacheForUser(userId);
    await this.repo.logAudit({
      id: randomUUID(),
      userId,
      category: 'security',
      action: 'sessions_revoked_all_other',
      details: { exceptDeviceId: exceptDeviceId ?? null },
      createdAt: Date.now()
    });
  }

  public async updateProfile(
    userId: string,
    profileId: string,
    patch: { displayName?: string; avatarUrl?: string | null }
  ): Promise<{ user: CloudUser; profile: CloudProfile }> {
    const updatedUser = await this.repo.updateUserProfile(userId, patch);
    const profile = await this.repo.getProfile(userId, profileId);
    if (!updatedUser || !profile) {
      throw new AuthError('User or profile not found', 404);
    }
    return { user: this.toPublicUser(updatedUser), profile };
  }

  public async requestEmailVerification(userId: string): Promise<{ sent: boolean; devToken?: string | null }> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new AuthError('User not found', 404);
    if (user.emailVerified) return { sent: false, devToken: null };
    const now = Date.now();
    const rawToken = randomBytes(18).toString('base64url');
    await this.repo.saveAccountToken({
      id: randomUUID(),
      userId,
      purpose: 'email_verify',
      tokenHash: hashToken(rawToken),
      expiresAt: now + 24 * 60 * 60 * 1000,
      createdAt: now
    });
    await this.emailDelivery.sendVerificationEmail({ to: user.email, token: rawToken });
    return {
      sent: true,
      devToken: this.config.nodeEnv !== 'production' ? rawToken : null
    };
  }

  public async validateActiveAccessToken(claims: JwtClaims): Promise<void> {
    const cacheKey = `${claims.sub}:${claims.deviceId ?? 'none'}`;
    const now = Date.now();
    let state = this.authStateCache.get(cacheKey);
    if (!state || state.expiresAt <= now) {
      const fresh = await this.repo.getAuthSessionState(claims.sub, claims.deviceId);
      state = { ...fresh, expiresAt: now + 5000 };
      if (this.authStateCache.size > 10_000) {
        this.authStateCache.clear();
      }
      this.authStateCache.set(cacheKey, state);
    }

    if (!state.exists) {
      throw new AuthError('Account no longer exists', 401);
    }
    if (typeof claims.epoch === 'number' && claims.epoch !== state.tokenEpoch) {
      throw new AuthError('Session has been invalidated', 401);
    }
    if (state.deviceRevoked) {
      throw new AuthError('Device session has been revoked', 401);
    }
  }

  public async verifyEmail(rawToken: string): Promise<CloudUser> {
    const now = Date.now();
    const rec = await this.repo.consumeAccountToken(hashToken(rawToken.trim()), 'email_verify', now);
    if (!rec) {
      throw new AuthError('Invalid or expired verification token', 400);
    }
    const updated = await this.repo.markEmailVerified(rec.userId, now);
    if (!updated) throw new AuthError('User not found', 404);
    await this.repo.logAudit({
      id: randomUUID(),
      userId: rec.userId,
      category: 'identity',
      action: 'email_verified',
      details: {},
      createdAt: now
    });
    return this.toPublicUser(updated);
  }

  public async requestPasswordReset(email: string): Promise<{ accepted: boolean; devResetToken?: string | null }> {
    const cleanEmail = email.trim().toLowerCase();
    const user = await this.repo.findUserByEmail(cleanEmail);
    if (!user) {
      return { accepted: true, devResetToken: null };
    }
    const now = Date.now();
    const rawToken = randomBytes(20).toString('base64url');
    await this.repo.saveAccountToken({
      id: randomUUID(),
      userId: user.id,
      purpose: 'password_reset',
      tokenHash: hashToken(rawToken),
      expiresAt: now + 60 * 60 * 1000,
      createdAt: now
    });
    await this.emailDelivery.sendPasswordResetEmail({ to: user.email, token: rawToken });
    await this.repo.logAudit({
      id: randomUUID(),
      userId: user.id,
      category: 'security',
      action: 'password_reset_requested',
      details: {},
      createdAt: now
    });
    return {
      accepted: true,
      devResetToken: this.config.nodeEnv !== 'production' ? rawToken : null
    };
  }

  public async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const now = Date.now();
    const rec = await this.repo.consumeAccountToken(hashToken(rawToken.trim()), 'password_reset', now);
    if (!rec) {
      throw new AuthError('Invalid or expired password reset token', 400);
    }
    const passwordHash = await hashPassword(newPassword);
    await this.repo.updateUserPassword(rec.userId, passwordHash);
    await this.repo.revokeAllRefreshTokensForUser(rec.userId);
    await this.repo.incrementTokenEpoch(rec.userId);
    this.invalidateAuthCacheForUser(rec.userId);
    await this.repo.logAudit({
      id: randomUUID(),
      userId: rec.userId,
      category: 'security',
      action: 'password_reset_completed',
      details: {},
      createdAt: now
    });
  }

  public async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentDeviceId?: string | null
  ): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new AuthError('User not found', 404);
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw new AuthError('Current password is incorrect', 401);
    const passwordHash = await hashPassword(newPassword);
    await this.repo.updateUserPassword(userId, passwordHash);
    await this.repo.revokeAllRefreshTokensForUser(userId, currentDeviceId ?? undefined);
    await this.repo.logAudit({
      id: randomUUID(),
      userId,
      category: 'security',
      action: 'password_changed',
      details: {},
      createdAt: Date.now()
    });
  }

  public async setE2eeEnvelope(
    userId: string,
    params: { e2eeEnabled: boolean; e2eeKeyVersion: number; envelope: E2eeKeyEnvelope | null }
  ): Promise<CloudUser> {
    const updated = await this.repo.setUserE2eeEnvelope(userId, params);
    if (!updated) throw new AuthError('User not found', 404);
    await this.repo.logAudit({
      id: randomUUID(),
      userId,
      category: 'security',
      action: 'e2ee_envelope_updated',
      details: { e2eeEnabled: params.e2eeEnabled, keyVersion: params.e2eeKeyVersion },
      createdAt: Date.now()
    });
    return this.toPublicUser(updated);
  }

  public async getE2eeEnvelope(userId: string): Promise<{
    e2eeEnabled: boolean;
    e2eeKeyVersion: number;
    envelope: E2eeKeyEnvelope | null;
  }> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new AuthError('User not found', 404);
    return {
      e2eeEnabled: Boolean(user.e2eeEnabled),
      e2eeKeyVersion: user.e2eeKeyVersion ?? 1,
      envelope: user.e2eeKeyEnvelope ?? null
    };
  }

  public async getUserAndProfile(
    userId: string,
    profileId: string
  ): Promise<{ user: CloudUser; profile: CloudProfile }> {
    const user = await this.repo.findUserById(userId);
    const profile = await this.repo.getProfile(userId, profileId);
    if (!user || !profile) throw new AuthError('User or profile not found', 404);
    return { user: this.toPublicUser(user), profile };
  }

  public async exportUserData(userId: string): Promise<Record<string, unknown>> {
    return this.repo.exportAllUserData(userId);
  }

  public async deleteAccount(userId: string): Promise<void> {
    await this.repo.deleteUserAccount(userId);
    this.invalidateAuthCacheForUser(userId);
  }

  private async issueSession(params: {
    user: CloudAuthSession['user'];
    profile: CloudProfile;
    deviceId?: string | null;
  }): Promise<CloudAuthSession> {
    const storedUser = await this.repo.findUserById(params.user.id);
    const signed = signJwt(
      {
        sub: params.user.id,
        email: params.user.email,
        profileId: params.profile.id,
        deviceId: params.deviceId ?? null,
        epoch: storedUser?.tokenEpoch ?? 1
      },
      this.config.jwtSecret,
      this.config.jwtAccessTtlSeconds
    );
    const refreshToken = generateRefreshToken();
    const now = Date.now();
    await this.repo.saveRefreshToken({
      id: randomUUID(),
      userId: params.user.id,
      profileId: params.profile.id,
      deviceId: params.deviceId ?? null,
      tokenHash: hashToken(refreshToken),
      expiresAt: now + this.config.jwtRefreshTtlSeconds * 1000,
      createdAt: now
    });

    return {
      user: params.user,
      profile: params.profile,
      deviceId: params.deviceId ?? null,
      accessToken: signed.token,
      refreshToken,
      expiresAt: signed.exp
    };
  }
}

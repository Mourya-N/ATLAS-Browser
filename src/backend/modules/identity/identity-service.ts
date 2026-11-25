import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CLOUD_CONSENT,
  type CloudAuthSession,
  type CloudConsentSettings,
  type CloudDevice,
  type CloudProfile
} from '@shared/types';
import type { BackendConfig } from '../../config';
import type { CloudRepository } from '../../db/repository';
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
  constructor(
    private readonly repo: CloudRepository,
    private readonly config: BackendConfig
  ) {}

  public async register(input: {
    email: string;
    password: string;
    displayName?: string;
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
    const displayName = (input.displayName || cleanEmail.split('@')[0] || 'Atlas User').trim();

    const profile: CloudProfile = {
      id: profileId,
      userId,
      name: 'Default Profile',
      settings: {},
      consent: { ...DEFAULT_CLOUD_CONSENT },
      createdAt: now,
      updatedAt: now
    };

    await this.repo.createUserWithProfile({
      user: {
        id: userId,
        email: cleanEmail,
        passwordHash,
        displayName,
        createdAt: now,
        updatedAt: now
      },
      profile
    });

    if (input.deviceName) {
      await this.repo.registerDevice({
        id: randomUUID(),
        userId,
        profileId,
        deviceName: input.deviceName,
        platform: input.platform || process.platform,
        appVersion: input.appVersion || '1.0.0',
        lastSeenAt: now,
        createdAt: now
      });
    }

    await this.repo.logAudit({
      id: randomUUID(),
      userId,
      profileId,
      category: 'identity',
      action: 'user_registered',
      details: { email: cleanEmail },
      createdAt: now
    });

    return this.issueSession({
      user: { id: userId, email: cleanEmail, displayName, createdAt: now, updatedAt: now },
      profile
    });
  }

  public async login(input: {
    email: string;
    password: string;
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
    if (input.deviceName) {
      await this.repo.registerDevice({
        id: randomUUID(),
        userId: user.id,
        profileId: profile.id,
        deviceName: input.deviceName,
        platform: input.platform || process.platform,
        appVersion: input.appVersion || '1.0.0',
        lastSeenAt: now,
        createdAt: now
      });
    }

    await this.repo.logAudit({
      id: randomUUID(),
      userId: user.id,
      profileId: profile.id,
      category: 'identity',
      action: 'user_logged_in',
      details: {},
      createdAt: now
    });

    return this.issueSession({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      profile
    });
  }

  public async refresh(rawRefreshToken: string): Promise<CloudAuthSession> {
    const tokenHash = hashToken(rawRefreshToken);
    const stored = await this.repo.findRefreshToken(tokenHash);
    if (!stored || stored.revokedAt || stored.expiresAt <= Date.now()) {
      throw new AuthError('Invalid or expired refresh token', 401);
    }

    const user = await this.repo.findUserById(stored.userId);
    const profile = user ? await this.repo.getProfile(user.id, stored.profileId) : null;
    if (!user || !profile) {
      throw new AuthError('Session user or profile no longer exists', 401);
    }

    // Rotate refresh token on each use
    await this.repo.revokeRefreshToken(tokenHash);
    return this.issueSession({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      profile
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

  public async listDevices(userId: string): Promise<CloudDevice[]> {
    return this.repo.listDevices(userId);
  }

  public async exportUserData(userId: string): Promise<Record<string, unknown>> {
    return this.repo.exportAllUserData(userId);
  }

  public async deleteAccount(userId: string): Promise<void> {
    await this.repo.deleteUserAccount(userId);
  }

  private async issueSession(params: {
    user: CloudAuthSession['user'];
    profile: CloudProfile;
  }): Promise<CloudAuthSession> {
    const signed = signJwt(
      {
        sub: params.user.id,
        email: params.user.email,
        profileId: params.profile.id
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
      tokenHash: hashToken(refreshToken),
      expiresAt: now + this.config.jwtRefreshTtlSeconds * 1000,
      createdAt: now
    });

    return {
      user: params.user,
      profile: params.profile,
      accessToken: signed.token,
      refreshToken,
      expiresAt: signed.exp
    };
  }
}

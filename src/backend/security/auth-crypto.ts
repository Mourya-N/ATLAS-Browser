import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual
} from 'node:crypto';

const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexDigest] = parts;
  const expected = Buffer.from(hexDigest, 'hex');
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, (err, buf) => {
      if (err) reject(err);
      else resolve(buf);
    });
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export interface JwtClaims {
  sub: string;
  email: string;
  profileId: string;
  iat: number;
  exp: number;
  iss: string;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padLen = (4 - (input.length % 4)) % 4;
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  return Buffer.from(normalized, 'base64').toString('utf8');
}

export function signJwt(
  payload: Omit<JwtClaims, 'iat' | 'exp' | 'iss'>,
  secret: string,
  ttlSeconds: number
): { token: string; exp: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + ttlSeconds;
  const fullClaims: JwtClaims = {
    ...payload,
    iss: 'lavray-cloud',
    iat: nowSec,
    exp
  };

  const headerSegment = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadSegment = base64UrlEncode(JSON.stringify(fullClaims));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const sig = createHmac('sha256', secret).update(signingInput).digest();
  return {
    token: `${signingInput}.${base64UrlEncode(sig)}`,
    exp: exp * 1000
  };
}

export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, sigSeg] = parts;
  const signingInput = `${headerSeg}.${payloadSeg}`;
  const expectedSig = base64UrlEncode(createHmac('sha256', secret).update(signingInput).digest());

  const a = Buffer.from(sigSeg, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const header = JSON.parse(base64UrlDecode(headerSeg)) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const claims = JSON.parse(base64UrlDecode(payloadSeg)) as JwtClaims;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!claims.sub || !claims.exp || claims.exp <= nowSec || claims.iss !== 'lavray-cloud') {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function generateRefreshToken(): string {
  return `lavray_rt_${randomBytes(32).toString('hex')}`;
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

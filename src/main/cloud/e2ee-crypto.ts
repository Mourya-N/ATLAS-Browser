import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import type { E2eeKeyEnvelope, EncryptedPayloadEnvelope } from '@shared/types';

const PBKDF2_ITERATIONS = 210_000;

/**
 * Generates a fresh 256-bit Account Master Key (AMK) encoded as base64.
 */
export function generateMasterKeyB64(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Generates a human-copyable recovery key (formatted in 4-char groups).
 */
export function generateRecoveryKey(): string {
  const raw = randomBytes(24).toString('hex').toUpperCase();
  return raw.match(/.{1,4}/g)?.join('-') ?? raw;
}

/**
 * Wraps the Account Master Key using a key derived from the user's Recovery Key
 * via PBKDF2-HMAC-SHA512 + AES-256-GCM. The server only ever receives this envelope.
 */
export function wrapMasterKeyWithRecoveryKey(
  masterKeyB64: string,
  recoveryKey: string,
  keyVersion = 1
): E2eeKeyEnvelope {
  const salt = randomBytes(16);
  const kek = pbkdf2Sync(recoveryKey.trim(), salt, PBKDF2_ITERATIONS, 32, 'sha512');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  cipher.setAAD(Buffer.from(`lavray:e2ee:wrap:v${keyVersion}`, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(Buffer.from(masterKeyB64, 'base64')), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    keyVersion,
    saltB64: salt.toString('base64'),
    ivB64: iv.toString('base64'),
    tagB64: tag.toString('base64'),
    ciphertextB64: encrypted.toString('base64'),
    iterations: PBKDF2_ITERATIONS,
    updatedAt: Date.now()
  };
}

/**
 * Unwraps an E2EE Account Master Key envelope using the user's Recovery Key.
 */
export function unwrapMasterKeyWithRecoveryKey(
  envelope: E2eeKeyEnvelope,
  recoveryKey: string
): string {
  const salt = Buffer.from(envelope.saltB64, 'base64');
  const kek = pbkdf2Sync(recoveryKey.trim(), salt, envelope.iterations, 32, 'sha512');
  const iv = Buffer.from(envelope.ivB64, 'base64');
  const tag = Buffer.from(envelope.tagB64, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertextB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAAD(Buffer.from(`lavray:e2ee:wrap:v${envelope.keyVersion}`, 'utf8'));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plain.length !== 32) {
    throw new Error('Invalid unwrapped E2EE master key length');
  }
  return plain.toString('base64');
}

/**
 * Encrypts a JSON-serializable sync payload with the 256-bit Account Master Key (AES-256-GCM).
 */
export function encryptSyncPayload(
  payload: Record<string, unknown>,
  masterKeyB64: string,
  keyVersion: number,
  aadContext: string
): EncryptedPayloadEnvelope {
  const key = Buffer.from(masterKeyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('Invalid E2EE master key length');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aadContext, 'utf8'));
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: 'aes-256-gcm',
    keyVersion,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

/**
 * Decrypts an EncryptedPayloadEnvelope back into its JSON object.
 */
export function decryptSyncPayload(
  envelope: EncryptedPayloadEnvelope,
  masterKeyB64: string,
  aadContext: string
): Record<string, unknown> {
  const key = Buffer.from(masterKeyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('Invalid E2EE master key length');
  }
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aadContext, 'utf8'));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as Record<string, unknown>;
}

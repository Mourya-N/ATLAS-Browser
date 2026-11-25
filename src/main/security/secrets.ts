import { safeStorage } from 'electron';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface SecretVaultData {
  geminiApiKey?: string;
  customApiKey?: string;
  mcpAuthToken?: string;
}

const REDACTION_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /sk-[0-9A-Za-z\-_]{20,}/g,
  /Bearer\s+[0-9A-Za-z\-._~+/]+=*/gi,
  /atlas_mcp_[0-9a-f]{16,}/gi
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const pattern of REDACTION_PATTERNS) {
    out = out.replace(pattern, '[REDACTED_SECRET]');
  }
  return out;
}

export function redactObjectSecrets<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactSecrets(obj) as unknown as T;
  if (Array.isArray(obj)) return obj.map((item) => redactObjectSecrets(item)) as unknown as T;
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (
        lower.includes('password') ||
        lower.includes('apikey') ||
        lower.includes('api_key') ||
        lower.includes('secret') ||
        lower.includes('token') ||
        lower.includes('authorization') ||
        lower.includes('creditcard') ||
        lower.includes('cvv')
      ) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactObjectSecrets(v);
      }
    }
    return out as T;
  }
  return obj;
}

export class SecretVault {
  private readonly vaultPath: string;
  private cache: SecretVaultData | null = null;

  constructor(userDataDir: string) {
    this.vaultPath = path.join(userDataDir, 'atlas-secrets.enc');
  }

  private isSafeStorageAvailable(): boolean {
    try {
      return typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private getMachineKey(): Buffer {
    // Only used in headless/test environments when OS safeStorage is unavailable
    const seed = `${process.env.USER || 'atlas'}:${this.vaultPath}:atlas-vault-v1`;
    return scryptSync(seed, 'atlas-salt-v1', 32);
  }

  private encryptPayload(plaintext: string): Buffer {
    if (this.isSafeStorageAvailable()) {
      const encrypted = safeStorage.encryptString(plaintext);
      return Buffer.concat([Buffer.from('SS01'), encrypted]);
    }
    const iv = randomBytes(12);
    const key = this.getMachineKey();
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from('AE01'), iv, tag, encrypted]);
  }

  private decryptPayload(raw: Buffer): string {
    const header = raw.subarray(0, 4).toString('utf8');
    if (header === 'SS01') {
      if (!this.isSafeStorageAvailable()) {
        throw new Error('safeStorage unavailable to decrypt OS-protected secret vault');
      }
      return safeStorage.decryptString(raw.subarray(4));
    }
    if (header === 'AE01') {
      const iv = raw.subarray(4, 16);
      const tag = raw.subarray(16, 32);
      const data = raw.subarray(32);
      const decipher = createDecipheriv('aes-256-gcm', this.getMachineKey(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
    throw new Error('Unknown secret vault format');
  }

  public load(): SecretVaultData {
    if (this.cache) return { ...this.cache };
    if (!fs.existsSync(this.vaultPath)) {
      this.cache = {};
      return {};
    }
    try {
      const raw = fs.readFileSync(this.vaultPath);
      const json = this.decryptPayload(raw);
      this.cache = JSON.parse(json) as SecretVaultData;
      return { ...this.cache };
    } catch {
      this.cache = {};
      return {};
    }
  }

  private save(data: SecretVaultData): void {
    const dir = path.dirname(this.vaultPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const encrypted = this.encryptPayload(JSON.stringify(data));
    fs.writeFileSync(this.vaultPath, encrypted, { mode: 0o600 });
    this.cache = { ...data };
  }

  public setGeminiApiKey(key: string): void {
    const data = this.load();
    data.geminiApiKey = key.trim();
    this.save(data);
  }

  public getGeminiApiKey(): string | undefined {
    const data = this.load();
    return data.geminiApiKey || process.env.GEMINI_API_KEY || undefined;
  }

  public clearGeminiApiKey(): void {
    const data = this.load();
    delete data.geminiApiKey;
    this.save(data);
  }

  public setCustomApiKey(key: string): void {
    const data = this.load();
    data.customApiKey = key.trim();
    this.save(data);
  }

  public getCustomApiKey(): string | undefined {
    return this.load().customApiKey;
  }

  public getOrCreateMcpToken(): string {
    const data = this.load();
    if (!data.mcpAuthToken) {
      data.mcpAuthToken = `atlas_mcp_${randomBytes(24).toString('hex')}`;
      this.save(data);
    }
    return data.mcpAuthToken;
  }

  public rotateMcpToken(): string {
    const data = this.load();
    data.mcpAuthToken = `atlas_mcp_${randomBytes(24).toString('hex')}`;
    this.save(data);
    return data.mcpAuthToken;
  }

  public getMaskedMcpToken(): string {
    const tok = this.load().mcpAuthToken;
    if (!tok) return 'Not generated';
    return `${tok.slice(0, 14)}...${tok.slice(-4)}`;
  }
}

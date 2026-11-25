const REDACTION_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /sk-[0-9A-Za-z\-_]{20,}/g,
  /Bearer\s+[0-9A-Za-z\-._~+/]+=*/gi,
  /atlas_mcp_[0-9a-f]{16,}/gi,
  /atlas_rt_[0-9a-f]{16,}/gi
];

const SENSITIVE_MEMORY_PATTERNS: RegExp[] = [
  /password\s*[:=]\s*\S+/i,
  /cvv\s*[:=]\s*\d{3,4}/i,
  /\b(?:\d[ -]*?){13,16}\b/, // credit card numbers
  /-----BEGIN\s+(RSA|OPENSSH|EC|PGP)\s+PRIVATE\s+KEY-----/i,
  /AIza[0-9A-Za-z\-_]{20,}/,
  /sk-[0-9A-Za-z\-_]{20,}/,
  /bearer\s+(?=[0-9a-z\-._~+/]*[\d._\-+/])[0-9a-z\-._~+/]{12,}=*/i,
  /atlas_mcp_[0-9a-f]{16,}/i,
  /atlas_rt_[0-9a-f]{16,}/i
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const pattern of REDACTION_PATTERNS) {
    out = out.replace(pattern, '[REDACTED_SECRET]');
  }
  return out;
}

export function containsSensitiveText(text: string): boolean {
  return SENSITIVE_MEMORY_PATTERNS.some((rx) => rx.test(text));
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

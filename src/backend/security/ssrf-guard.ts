import dns from 'node:dns/promises';
import net from 'node:net';

export class SsrfBlockedError extends Error {
  constructor(
    message: string,
    public readonly reason: string
  ) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  '169.254.169.254',
  '100.100.100.200'
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inCidr4(ip: string, base: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/%.*$/, '');
  const version = net.isIP(ip);
  if (version === 0) return true;

  if (version === 4) {
    return (
      inCidr4(ip, '0.0.0.0', 8) || // "This host"
      inCidr4(ip, '10.0.0.0', 8) || // RFC1918
      inCidr4(ip, '100.64.0.0', 10) || // Carrier-grade NAT RFC6598
      inCidr4(ip, '127.0.0.0', 8) || // Loopback
      inCidr4(ip, '169.254.0.0', 16) || // Link-local & cloud metadata
      inCidr4(ip, '172.16.0.0', 12) || // RFC1918
      inCidr4(ip, '192.0.0.0', 24) || // IETF Protocol Assignments
      inCidr4(ip, '192.0.2.0', 24) || // TEST-NET-1
      inCidr4(ip, '192.168.0.0', 16) || // RFC1918
      inCidr4(ip, '198.18.0.0', 15) || // Benchmark testing
      inCidr4(ip, '198.51.100.0', 24) || // TEST-NET-2
      inCidr4(ip, '203.0.113.0', 24) || // TEST-NET-3
      inCidr4(ip, '224.0.0.0', 4) || // Multicast
      inCidr4(ip, '240.0.0.0', 4) // Reserved / broadcast
    );
  }

  // IPv6 checks
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // ULA fc00::/7
  if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
    return true; // Link-local fe80::/10
  }
  if (ip.startsWith('ff')) return true; // Multicast
  // IPv4-mapped IPv6 e.g. ::ffff:127.0.0.1
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) {
      return isPrivateOrReservedIp(mapped);
    }
    return true;
  }
  return false;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  domainAllowlist?: string[];
  allowLocalhostForTest?: boolean;
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

export interface SafeFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  bodyText: string;
  byteLength: number;
  redirectsFollowed: number;
}

export class SsrfGuard {
  public validateUrlSyntax(rawUrl: string, allowLocalhostForTest = false): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new SsrfBlockedError('Malformed URL rejected', 'malformed_url');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new SsrfBlockedError(`Blocked URL scheme: ${parsed.protocol}`, 'disallowed_scheme');
    }

    if (parsed.username || parsed.password) {
      throw new SsrfBlockedError('URLs containing embedded credentials are blocked', 'embedded_credentials');
    }

    const host = parsed.hostname.toLowerCase();
    if (!host) {
      throw new SsrfBlockedError('URL missing hostname', 'missing_host');
    }

    if (!allowLocalhostForTest) {
      if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
        throw new SsrfBlockedError(`Blocked internal/metadata hostname: ${host}`, 'blocked_hostname');
      }
      if (net.isIP(host) && isPrivateOrReservedIp(host)) {
        throw new SsrfBlockedError(`Blocked private/reserved IP address: ${host}`, 'private_ip');
      }
    }

    return parsed;
  }

  public async validateResolvedHost(
    parsed: URL,
    opts: Pick<SafeFetchOptions, 'domainAllowlist' | 'allowLocalhostForTest' | 'dnsLookup'> = {}
  ): Promise<string[]> {
    const host = parsed.hostname.toLowerCase();

    if (opts.domainAllowlist && opts.domainAllowlist.length > 0) {
      const allowed = opts.domainAllowlist.some((d) => {
        const clean = d.toLowerCase().trim();
        return host === clean || host.endsWith(`.${clean}`);
      });
      if (!allowed) {
        throw new SsrfBlockedError(`Domain ${host} is not in allowlist`, 'domain_not_allowlisted');
      }
    }

    if (opts.allowLocalhostForTest && (host === '127.0.0.1' || host === 'localhost')) {
      return ['127.0.0.1'];
    }

    if (net.isIP(host)) {
      if (isPrivateOrReservedIp(host)) {
        throw new SsrfBlockedError(`Resolved IP ${host} is private/reserved`, 'private_ip');
      }
      return [host];
    }

    const lookupFn =
      opts.dnsLookup ??
      ((hostname: string) => dns.lookup(hostname, { all: true }));

    let records: Array<{ address: string; family: number }>;
    try {
      records = await lookupFn(host);
    } catch {
      throw new SsrfBlockedError(`DNS lookup failed for host: ${host}`, 'dns_failure');
    }

    if (!records || records.length === 0) {
      throw new SsrfBlockedError(`DNS returned no addresses for host: ${host}`, 'dns_empty');
    }

    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new SsrfBlockedError(
          `DNS resolution for ${host} returned restricted IP ${rec.address}`,
          'dns_rebinding_or_private_ip'
        );
      }
    }

    return records.map((r) => r.address);
  }

  public async safeFetchText(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
    const timeoutMs = opts.timeoutMs ?? 8000;
    const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
    const maxRedirects = opts.maxRedirects ?? 3;

    let currentUrl = rawUrl;
    let redirectsFollowed = 0;

    while (true) {
      const parsed = this.validateUrlSyntax(currentUrl, opts.allowLocalhostForTest);
      await this.validateResolvedHost(parsed, opts);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('Fetch timeout exceeded')), timeoutMs);

      let response: Response;
      try {
        response = await fetch(parsed.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'AtlasBrowserResearchFetcher/1.0 (+https://atlasbrowser.local)',
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
            // Prevent unexpected compressed bomb encodings unless Node handles standard gzip safely; read loop caps bytes
            'Accept-Encoding': 'gzip, deflate'
          }
        });
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new SsrfBlockedError('Redirect response missing Location header', 'invalid_redirect');
        }
        redirectsFollowed += 1;
        if (redirectsFollowed > maxRedirects) {
          throw new SsrfBlockedError(`Too many redirects (> ${maxRedirects})`, 'too_many_redirects');
        }
        currentUrl = new URL(location, parsed).toString();
        continue;
      }

      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader && Number(contentLengthHeader) > maxBytes) {
        throw new SsrfBlockedError(
          `Response Content-Length ${contentLengthHeader} exceeds max ${maxBytes} bytes`,
          'response_too_large'
        );
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
              await reader.cancel();
              throw new SsrfBlockedError(
                `Streamed body exceeded limit of ${maxBytes} bytes`,
                'response_too_large'
              );
            }
            chunks.push(value);
          }
        }
      }

      const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const bodyText = merged.toString('utf8');

      return {
        url: rawUrl,
        finalUrl: parsed.toString(),
        status: response.status,
        contentType,
        bodyText,
        byteLength: totalBytes,
        redirectsFollowed
      };
    }
  }
}

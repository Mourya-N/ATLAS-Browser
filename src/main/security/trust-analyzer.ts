export type TrustLevel = 'trusted' | 'caution' | 'warning';

export interface TrustSignal {
  id: string;
  severity: 'info' | 'caution' | 'warning';
  title: string;
  detail: string;
}

export interface PageTrustReport {
  url: string;
  hostname: string;
  level: TrustLevel;
  signals: TrustSignal[];
  checkedAt: number;
  deterministicOnly: true;
}

const KNOWN_BRANDS = [
  'google',
  'microsoft',
  'apple',
  'amazon',
  'paypal',
  'github',
  'cloudflare',
  'openai',
  'anthropic',
  'chase',
  'bankofamerica',
  'wellsfargo'
];

const LOOKALIKE_CHAR_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  rn: 'm',
  vv: 'w'
};

function normalizeHomoglyphs(input: string): string {
  let out = input.toLowerCase();
  for (const [k, v] of Object.entries(LOOKALIKE_CHAR_MAP)) {
    out = out.split(k).join(v);
  }
  return out;
}

/**
 * Deterministic scam, phishing, and trust signal analyzer.
 * Uses only deterministic URL/DOM heuristics (never relies on AI as sole security decision-maker
 * and never auto-blocks legitimate sites).
 */
export function analyzePageTrust(
  rawUrl: string,
  pageSignals?: {
    hasPasswordField?: boolean;
    hasExternalFormAction?: boolean;
    externalFormHost?: string;
    unexpectedDownloadAttempt?: boolean;
    permissionRequests?: string[];
  }
): PageTrustReport {
  const signals: TrustSignal[] = [];
  let hostname = '';

  if (!rawUrl || rawUrl === 'about:blank' || rawUrl.startsWith('file://')) {
    return {
      url: rawUrl,
      hostname: 'local',
      level: 'trusted',
      signals: [
        {
          id: 'local-context',
          severity: 'info',
          title: 'Local / Internal Page',
          detail: 'Page is not served from a remote origin.'
        }
      ],
      checkedAt: Date.now(),
      deterministicOnly: true
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return {
      url: rawUrl,
      hostname: '',
      level: 'caution',
      signals: [
        {
          id: 'invalid-url',
          severity: 'caution',
          title: 'Malformed URL',
          detail: 'Could not parse URL structure.'
        }
      ],
      checkedAt: Date.now(),
      deterministicOnly: true
    };
  }

  // 1. Transport security
  if (parsed.protocol === 'http:' && hostname !== '127.0.0.1' && hostname !== 'localhost') {
    signals.push({
      id: 'insecure-http',
      severity: pageSignals?.hasPasswordField ? 'warning' : 'caution',
      title: pageSignals?.hasPasswordField ? 'Password Form on Unencrypted HTTP' : 'Unencrypted Connection (HTTP)',
      detail: pageSignals?.hasPasswordField
        ? 'This page contains a password input over plain HTTP. Credentials could be intercepted.'
        : 'Traffic to this site is not encrypted with HTTPS.'
    });
  }

  // 2. Punycode / IDN homograph check
  if (hostname.includes('xn--')) {
    signals.push({
      id: 'punycode-domain',
      severity: 'caution',
      title: 'Internationalized (Punycode) Domain',
      detail: `Hostname "${hostname}" uses xn-- punycode encoding, which can be used in homograph lookalike attacks.`
    });
  }

  // 3. URL userinfo (@) deception check
  if (parsed.username || parsed.password) {
    signals.push({
      id: 'userinfo-in-url',
      severity: 'warning',
      title: 'Deceptive @ Credentials in URL',
      detail: 'URL contains embedded username/password before @, a common phishing pattern to disguise the true host.'
    });
  }

  // 4. Raw IP address host (non-localhost)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) && hostname !== '127.0.0.1') {
    signals.push({
      id: 'ip-literal-host',
      severity: 'caution',
      title: 'Direct IP Address Hostname',
      detail: `Site is hosted on raw IP ${hostname} instead of a verifiable domain name.`
    });
  }

  // 5. Lookalike / typosquatting brand check
  const parts = hostname.split('.');
  const sld = parts.length >= 2 ? parts[parts.length - 2] : hostname;
  const normalizedSld = normalizeHomoglyphs(sld);
  for (const brand of KNOWN_BRANDS) {
    const isExactLegit = sld === brand;
    if (!isExactLegit && (normalizedSld === brand || (sld.includes(brand) && parts.length > 3))) {
      signals.push({
        id: 'lookalike-brand',
        severity: 'warning',
        title: `Possible Lookalike Domain (${brand})`,
        detail: `Hostname "${hostname}" resembles "${brand}" without being the primary brand domain.`
      });
      break;
    }
  }

  // 6. Excessive subdomains
  if (parts.length >= 5) {
    signals.push({
      id: 'deep-subdomain',
      severity: 'caution',
      title: 'Unusually Deep Subdomain Chain',
      detail: `Hostname has ${parts.length} labels, which is sometimes used to hide the true registrable domain.`
    });
  }

  // 7. Cross-origin credential form action
  if (pageSignals?.hasPasswordField && pageSignals.hasExternalFormAction && pageSignals.externalFormHost) {
    signals.push({
      id: 'external-form-action',
      severity: 'warning',
      title: 'Credential Form Submits to Different Domain',
      detail: `Password form submits to "${pageSignals.externalFormHost}" instead of "${hostname}".`
    });
  }

  if (pageSignals?.unexpectedDownloadAttempt) {
    signals.push({
      id: 'unexpected-download',
      severity: 'caution',
      title: 'Unexpected Download Prompt',
      detail: 'Page triggered an automatic or unexpected file download.'
    });
  }

  if (pageSignals?.permissionRequests && pageSignals.permissionRequests.length > 0) {
    signals.push({
      id: 'permission-requests',
      severity: 'info',
      title: 'Sensitive Permission Requests',
      detail: `Page requested: ${pageSignals.permissionRequests.join(', ')}.`
    });
  }

  let level: TrustLevel = 'trusted';
  if (signals.some((s) => s.severity === 'warning')) {
    level = 'warning';
  } else if (signals.some((s) => s.severity === 'caution')) {
    level = 'caution';
  }

  if (signals.length === 0) {
    signals.push({
      id: 'https-clean',
      severity: 'info',
      title: 'No Suspicious Signals Detected',
      detail: 'HTTPS transport active and no deterministic phishing or lookalike indicators found.'
    });
  }

  return {
    url: rawUrl,
    hostname,
    level,
    signals,
    checkedAt: Date.now(),
    deterministicOnly: true
  };
}

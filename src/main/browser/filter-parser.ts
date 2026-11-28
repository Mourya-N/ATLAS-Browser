/**
 * Safe Adblock Plus / EasyList / EasyPrivacy / Hosts filter list parser.
 * Parses network blocking/exception rules and cosmetic hiding rules without
 * executing any downloaded content or building catastrophic regexes.
 */

export type FilterResourceType =
  | 'script'
  | 'image'
  | 'stylesheet'
  | 'xmlhttprequest'
  | 'subdocument'
  | 'media'
  | 'font'
  | 'ping'
  | 'websocket'
  | 'other';

export interface ParsedNetworkRule {
  raw: string;
  isException: boolean;
  /** Domain anchor from `||example.com^` or `||example.com/path` if present */
  domainAnchor: string | null;
  /** Longest static >=4-char alphanumeric token in pattern for inverted indexing */
  indexToken: string | null;
  /** Safe literal/wildcard matcher if pattern has path/query parts */
  urlRegex: RegExp | null;
  thirdParty: boolean | null;
  includeTypes: Set<FilterResourceType> | null;
  excludeTypes: Set<FilterResourceType> | null;
  includeDomains: string[] | null;
  excludeDomains: string[] | null;
  important: boolean;
  isPopup?: boolean;
}

export interface ParsedCosmeticRule {
  raw: string;
  isException: boolean;
  domains: string[];
  excludedDomains: string[];
  selector: string;
}

export interface SkippedRuleBreakdown {
  regex: number;
  extendedCosmetic: number;
  unsupportedModifier: number;
  invalidCss: number;
  tooLong: number;
  other: number;
}

export interface ParsedFilterList {
  networkRules: ParsedNetworkRule[];
  cosmeticRules: ParsedCosmeticRule[];
  skippedCount: number;
  skippedByReason: SkippedRuleBreakdown;
}

const VALID_RESOURCE_TYPES = new Set<string>([
  'script',
  'image',
  'stylesheet',
  'xmlhttprequest',
  'xhr',
  'subdocument',
  'media',
  'font',
  'ping',
  'websocket',
  'other'
]);

const MAX_LINE_LENGTH = 1024;

function normalizeResourceType(token: string): FilterResourceType | null {
  if (token === 'xhr') return 'xmlhttprequest';
  if (VALID_RESOURCE_TYPES.has(token)) return token as FilterResourceType;
  return null;
}

export function mapElectronResourceType(electronType: string): FilterResourceType {
  switch (electronType) {
    case 'script':
      return 'script';
    case 'image':
      return 'image';
    case 'stylesheet':
      return 'stylesheet';
    case 'xhr':
      return 'xmlhttprequest';
    case 'subFrame':
      return 'subdocument';
    case 'media':
      return 'media';
    case 'font':
      return 'font';
    case 'ping':
      return 'ping';
    case 'webSocket':
      return 'websocket';
    default:
      return 'other';
  }
}

export function isSafeCssSelector(selector: string): boolean {
  const s = selector.trim();
  if (!s || s.length > 300) return false;
  // Disallow braces, angle brackets, JS URIs, CSS expressions, @-rules
  if (/[{}<>]/.test(s)) return false;
  const lower = s.toLowerCase();
  if (
    lower.includes('javascript:') ||
    lower.includes('expression(') ||
    lower.includes('@import') ||
    lower.includes('url(')
  ) {
    return false;
  }
  return true;
}

const IGNORED_INDEX_TOKENS = new Set([
  'http', 'https', 'www', 'com', 'net', 'org', 'php', 'asp', 'htm', 'html', 'gif', 'png', 'jpg', 'css', 'json'
]);

function extractIndexToken(patternBody: string): string | null {
  // Any literal static alphanumeric run in the pattern (outside wildcard `*`) must appear in a matching URL
  const cleaned = patternBody.replace(/^\|\|?/, '').replace(/\|$/, '');
  const parts4 = (cleaned.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((t) => !IGNORED_INDEX_TOKENS.has(t));
  if (parts4.length > 0) {
    let best = parts4[0];
    for (let i = 1; i < parts4.length; i++) {
      if (parts4[i].length > best.length) best = parts4[i];
    }
    return best;
  }
  const parts3 = (cleaned.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !IGNORED_INDEX_TOKENS.has(t));
  return parts3.length > 0 ? parts3[0] : null;
}

function escapeRegexLiteral(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePatternToRegex(pattern: string): RegExp | null {
  if (!pattern || pattern.length > 400) return null;
  // Skip raw /regex/ rules to prevent ReDoS from untrusted filter lists
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    return null;
  }

  let body = pattern;
  let prefix = '';
  let suffix = '';

  if (body.startsWith('||')) {
    body = body.slice(2);
    prefix = '^https?:\\/\\/([^/]+\\.)?';
  } else if (body.startsWith('|')) {
    body = body.slice(1);
    prefix = '^';
  }

  if (body.endsWith('|')) {
    body = body.slice(0, -1);
    suffix = '$';
  }

  let regexStr = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '*') {
      regexStr += '[^\\n]*';
    } else if (ch === '^') {
      regexStr += '(?:[/?#:&=]|$)';
    } else {
      regexStr += escapeRegexLiteral(ch);
    }
  }

  try {
    return new RegExp(prefix + regexStr + suffix, 'i');
  } catch {
    return null;
  }
}

export function parseCosmeticRuleLine(rawLine: string): ParsedCosmeticRule | null {
  const line = rawLine.trim();
  if (!line || line.length > MAX_LINE_LENGTH) return null;

  // Extended CSS / procedural cosmetic rules (`#?#`, `#$#`) are skipped safely
  if (line.includes('#?#') || line.includes('#$#') || line.includes('#@$#')) {
    return null;
  }

  let isException = false;
  let sepIndex = line.indexOf('#@#');
  let sepLen = 3;
  if (sepIndex !== -1) {
    isException = true;
  } else {
    sepIndex = line.indexOf('##');
    sepLen = 2;
  }
  if (sepIndex === -1) return null;

  const domainPart = line.slice(0, sepIndex).trim();
  const selector = line.slice(sepIndex + sepLen).trim();
  if (!isSafeCssSelector(selector)) return null;

  const domains: string[] = [];
  const excludedDomains: string[] = [];
  if (domainPart) {
    for (const rawDom of domainPart.split(',')) {
      const d = rawDom.trim().toLowerCase();
      if (!d) continue;
      if (d.startsWith('~')) {
        excludedDomains.push(d.slice(1));
      } else {
        domains.push(d);
      }
    }
  }

  return {
    raw: line,
    isException,
    domains,
    excludedDomains,
    selector
  };
}

export function parseNetworkRuleLine(rawLine: string): ParsedNetworkRule | null {
  const line = rawLine.trim();
  if (!line || line.length > MAX_LINE_LENGTH) return null;
  if (line.startsWith('!') || line.startsWith('[') || (line.startsWith('#') && !line.startsWith('##') && !line.startsWith('#@#'))) return null;
  if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) return null;
  // Skip raw /regex/ rules before splitting options on `$` to prevent ReDoS
  if (/^\/.*\/[gimsuy]*$/.test(line) && line.length > 2) return null;

  // Support hosts-file lines: "0.0.0.0 ad.example.com" or "127.0.0.1 tracker.net"
  const hostsMatch = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9.-]+\.[a-z]{2,})(?:\s+#.*)?$/i);
  if (hostsMatch) {
    const dom = hostsMatch[1].toLowerCase();
    if (dom === 'localhost' || dom === 'localhost.localdomain') return null;
    return {
      raw: line,
      isException: false,
      domainAnchor: dom,
      indexToken: null,
      urlRegex: null,
      thirdParty: null,
      includeTypes: null,
      excludeTypes: null,
      includeDomains: null,
      excludeDomains: null,
      important: false
    };
  }

  let body = line;
  let isException = false;
  if (body.startsWith('@@')) {
    isException = true;
    body = body.slice(2);
  }

  // Split options after `$` (ignoring `$` inside regexes, which we skip anyway)
  let optionsPart = '';
  const dollarIdx = body.lastIndexOf('$');
  if (dollarIdx !== -1) {
    optionsPart = body.slice(dollarIdx + 1).trim();
    body = body.slice(0, dollarIdx).trim();
  }

  if (!body) return null;

  let thirdParty: boolean | null = null;
  let includeTypes: Set<FilterResourceType> | null = null;
  let excludeTypes: Set<FilterResourceType> | null = null;
  let includeDomains: string[] | null = null;
  let excludeDomains: string[] | null = null;
  let important = false;
  let isPopup = false;

  if (optionsPart) {
    for (const rawOpt of optionsPart.split(',')) {
      const opt = rawOpt.trim().toLowerCase();
      if (!opt) continue;
      if (opt === 'third-party' || opt === '3p') {
        thirdParty = true;
      } else if (opt === '~third-party' || opt === '~3p' || opt === 'first-party' || opt === '1p') {
        thirdParty = false;
      } else if (opt === 'important') {
        important = true;
      } else if (opt === 'popup') {
        isPopup = true;
      } else if (opt === 'match-case') {
        // Safe no-op option
      } else if (opt.startsWith('domain=') || opt.startsWith('from=')) {
        const rawList = opt.startsWith('domain=') ? opt.slice(7) : opt.slice(5);
        // Skip wildcard TLD domain lists like `from=dutchycorp.*` that we do not pattern-match
        if (rawList.includes('*')) return null;
        const domList = rawList.split('|').map((d) => d.trim()).filter(Boolean);
        for (const d of domList) {
          if (d.startsWith('~')) {
            excludeDomains ??= [];
            excludeDomains.push(d.slice(1));
          } else {
            includeDomains ??= [];
            includeDomains.push(d);
          }
        }
      } else if (opt.startsWith('~')) {
        const mapped = normalizeResourceType(opt.slice(1));
        if (mapped) {
          excludeTypes ??= new Set();
          excludeTypes.add(mapped);
        } else {
          return null;
        }
      } else {
        const mapped = normalizeResourceType(opt);
        if (mapped) {
          includeTypes ??= new Set();
          includeTypes.add(mapped);
        } else {
          // Strict allowlist: skip rules with unsupported modifiers (redirect-rule=, removeparam=, to=, badfilter, csp=, header=, etc.)
          return null;
        }
      }
    }
  }

  // Fast-path pure domain anchor: `||example.com^` or `||example.com`
  const pureDomainMatch = body.match(/^\|\|([a-z0-9.-]+\.[a-z]{2,})\^?$/i);
  if (pureDomainMatch) {
    return {
      raw: line,
      isException,
      domainAnchor: pureDomainMatch[1].toLowerCase(),
      indexToken: null,
      urlRegex: null,
      thirdParty,
      includeTypes,
      excludeTypes,
      includeDomains,
      excludeDomains,
      important,
      isPopup
    };
  }

  // Also extract domainAnchor for `||domain.com/path...` rules so they use O(1) domain hash lookup!
  const prefixedDomainMatch = body.match(/^\|\|([a-z0-9.-]+\.[a-z]{2,})(?:[/?^|]|$)/i);
  const domainAnchor = prefixedDomainMatch ? prefixedDomainMatch[1].toLowerCase() : null;
  const indexToken = domainAnchor ? null : extractIndexToken(body);

  // Never allow unanchored bare wildcard rules (`*`, `/*`) without domain anchor, token, or site scope
  if (!domainAnchor && !indexToken && (!includeDomains || includeDomains.length === 0)) {
    return null;
  }

  const urlRegex = compilePatternToRegex(body);
  if (!urlRegex) return null;

  return {
    raw: line,
    isException,
    domainAnchor,
    indexToken,
    urlRegex,
    thirdParty,
    includeTypes,
    excludeTypes,
    includeDomains,
    excludeDomains,
    important,
    isPopup
  };
}

export function parseFilterListText(text: string, maxRules = 100_000): ParsedFilterList {
  const networkRules: ParsedNetworkRule[] = [];
  const cosmeticRules: ParsedCosmeticRule[] = [];
  let skippedCount = 0;
  const skippedByReason: SkippedRuleBreakdown = {
    regex: 0,
    extendedCosmetic: 0,
    unsupportedModifier: 0,
    invalidCss: 0,
    tooLong: 0,
    other: 0
  };

  // Strip UTF-8 BOM if present
  const cleanText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = cleanText.split(/\r?\n/);
  for (const raw of lines) {
    if (networkRules.length + cosmeticRules.length >= maxRules) break;
    const trimmed = raw.trim();
    if (
      !trimmed ||
      trimmed.startsWith('!') ||
      trimmed.startsWith('[') ||
      (trimmed.startsWith('#') && !trimmed.startsWith('##') && !trimmed.startsWith('#@#'))
    ) {
      continue;
    }

    if (trimmed.length > MAX_LINE_LENGTH) {
      skippedCount += 1;
      skippedByReason.tooLong += 1;
      continue;
    }

    if (trimmed.includes('#?#') || trimmed.includes('#$#') || trimmed.includes('#@$#')) {
      skippedCount += 1;
      skippedByReason.extendedCosmetic += 1;
      continue;
    }

    if (trimmed.includes('##') || trimmed.includes('#@#')) {
      const cos = parseCosmeticRuleLine(trimmed);
      if (cos) {
        cosmeticRules.push(cos);
      } else {
        skippedCount += 1;
        skippedByReason.invalidCss += 1;
      }
      continue;
    }

    if (/^\/.*\/[gimsuy]*$/.test(trimmed) && trimmed.length > 2) {
      skippedCount += 1;
      skippedByReason.regex += 1;
      continue;
    }

    const net = parseNetworkRuleLine(trimmed);
    if (net) {
      networkRules.push(net);
    } else {
      skippedCount += 1;
      if (/\$(?:.*)(?:popup|csp=|redirect=)/i.test(trimmed)) {
        skippedByReason.unsupportedModifier += 1;
      } else {
        skippedByReason.other += 1;
      }
    }
  }

  return { networkRules, cosmeticRules, skippedCount, skippedByReason };
}

export function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function matchesNetworkRule(
  rule: ParsedNetworkRule,
  ctx: {
    requestUrl: string;
    reqHost: string;
    firstHost: string;
    isThirdParty: boolean;
    resourceType: FilterResourceType;
    isPopupRequest?: boolean;
  }
): boolean {
  if (rule.isPopup && !ctx.isPopupRequest) {
    return false;
  }
  if (rule.thirdParty !== null && rule.thirdParty !== ctx.isThirdParty) {
    return false;
  }

  if (rule.includeTypes && !rule.includeTypes.has(ctx.resourceType)) {
    return false;
  }
  if (rule.excludeTypes && rule.excludeTypes.has(ctx.resourceType)) {
    return false;
  }

  if (rule.includeDomains && rule.includeDomains.length > 0) {
    if (!ctx.firstHost || !rule.includeDomains.some((d) => hostMatchesDomain(ctx.firstHost, d))) {
      return false;
    }
  }
  if (rule.excludeDomains && rule.excludeDomains.length > 0) {
    if (ctx.firstHost && rule.excludeDomains.some((d) => hostMatchesDomain(ctx.firstHost, d))) {
      return false;
    }
  }

  if (rule.domainAnchor && !hostMatchesDomain(ctx.reqHost, rule.domainAnchor)) {
    return false;
  }

  if (rule.urlRegex) {
    return rule.urlRegex.test(ctx.requestUrl);
  }

  return Boolean(rule.domainAnchor);
}

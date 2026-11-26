import { describe, it, expect } from 'vitest';
import { analyzePageTrust } from '@main/security/trust-analyzer';

describe('Deterministic Scam & Trust Analyzer', () => {
  it('flags lookalike domains, punycode, @ userinfo, and insecure password forms deterministically', () => {
    const lookalike = analyzePageTrust('https://paypa1.com/login');
    expect(lookalike.deterministicOnly).toBe(true);
    expect(lookalike.level).toBe('warning');
    expect(lookalike.signals.some((s) => s.id === 'lookalike-brand')).toBe(true);

    const puny = analyzePageTrust('https://xn--pple-43d.com/');
    expect(puny.level).toBe('caution');
    expect(puny.signals.some((s) => s.id === 'punycode-domain')).toBe(true);

    const httpPw = analyzePageTrust('http://login.example.org/auth', {
      hasPasswordField: true,
      hasExternalFormAction: true,
      externalFormHost: 'evil-collector.net'
    });
    expect(httpPw.level).toBe('warning');
    expect(httpPw.signals.some((s) => s.id === 'insecure-http')).toBe(true);
    expect(httpPw.signals.some((s) => s.id === 'external-form-action')).toBe(true);

    const userInfo = analyzePageTrust('https://google.com@evil.example.net/login');
    expect(userInfo.level).toBe('warning');
    expect(userInfo.signals.some((s) => s.id === 'userinfo-in-url')).toBe(true);
  });

  it('reports clean HTTPS pages as trusted without false positives', () => {
    const clean = analyzePageTrust('https://www.rfc-editor.org/rfc/rfc9309.html');
    expect(clean.level).toBe('trusted');
    expect(clean.signals[0].id).toBe('https-clean');
  });
});

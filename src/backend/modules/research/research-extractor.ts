import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { SsrfGuard } from '../../security/ssrf-guard';

export interface ExtractedWebDocument {
  url: string;
  finalUrl: string;
  title: string;
  byline: string | null;
  publishedAt: string | null;
  excerpt: string;
  textContent: string;
  headings: string[];
  canonicalUrl: string;
  language: string;
  chunks: string[];
  byteLength: number;
}

export class ResearchExtractorService {
  constructor(private readonly ssrfGuard: SsrfGuard) {}

  public extractFromHtml(url: string, html: string, byteLength = html.length): ExtractedWebDocument {
    const { document } = parseHTML(html);

    const metaDesc =
      document.querySelector('meta[name="description"]')?.getAttribute('content') ||
      document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      '';
    const publishedAt =
      document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
      document.querySelector('meta[name="date"]')?.getAttribute('content') ||
      document.querySelector('time[datetime]')?.getAttribute('datetime') ||
      null;
    const canonicalHref =
      document.querySelector('link[rel="canonical"]')?.getAttribute('href') || url;
    const lang = document.documentElement?.getAttribute('lang')?.slice(0, 8) || 'en';

    const headings: string[] = [];
    for (const h of Array.from(document.querySelectorAll('h1, h2, h3'))) {
      const txt = h.textContent?.replace(/\s+/g, ' ').trim();
      if (txt && headings.length < 25) headings.push(txt);
    }

    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    const title = (article?.title || document.title || url).replace(/\s+/g, ' ').trim();
    const rawText = (article?.textContent || document.body?.textContent || '')
      .replace(/\s+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    const chunks = this.chunkText(rawText, 700, 12);

    return {
      url,
      finalUrl: url,
      title,
      byline: article?.byline || null,
      publishedAt,
      excerpt: (article?.excerpt || metaDesc || rawText.slice(0, 240)).trim(),
      textContent: rawText.slice(0, 30_000),
      headings,
      canonicalUrl: this.safeResolveUrl(canonicalHref, url),
      language: lang.toLowerCase(),
      chunks,
      byteLength
    };
  }

  public async fetchAndExtract(
    url: string,
    opts?: {
      timeoutMs?: number;
      maxBytes?: number;
      domainAllowlist?: string[];
      allowLocalhostForTest?: boolean;
      dnsLookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
    }
  ): Promise<ExtractedWebDocument> {
    const res = await this.ssrfGuard.safeFetchText(url, opts);
    if (res.status >= 400) {
      throw new Error(`Upstream fetch returned HTTP ${res.status} for ${res.finalUrl}`);
    }
    if (!res.contentType.includes('text/') && !res.contentType.includes('html') && !res.contentType.includes('xml')) {
      const parsed = this.extractFromHtml(res.finalUrl, `<title>${res.finalUrl}</title><p>${res.bodyText.slice(0, 8000)}</p>`, res.byteLength);
      parsed.url = url;
      parsed.finalUrl = res.finalUrl;
      return parsed;
    }
    const doc = this.extractFromHtml(res.finalUrl, res.bodyText, res.byteLength);
    doc.url = url;
    doc.finalUrl = res.finalUrl;
    return doc;
  }

  public chunkText(text: string, maxChunkChars = 700, maxChunks = 16): string[] {
    if (!text) return [];
    const paragraphs = text
      .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9])/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 25);

    const chunks: string[] = [];
    let buffer = '';
    for (const p of paragraphs) {
      if ((buffer + ' ' + p).trim().length > maxChunkChars && buffer.length > 0) {
        chunks.push(buffer.trim());
        buffer = p;
        if (chunks.length >= maxChunks) break;
      } else {
        buffer = buffer ? `${buffer} ${p}` : p;
      }
    }
    if (buffer.trim() && chunks.length < maxChunks) {
      chunks.push(buffer.trim());
    }
    return chunks.slice(0, maxChunks);
  }

  private safeResolveUrl(candidate: string, base: string): string {
    try {
      return new URL(candidate, base).toString();
    } catch {
      return base;
    }
  }
}

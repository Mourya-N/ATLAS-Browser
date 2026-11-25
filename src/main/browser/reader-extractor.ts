import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { ReaderArticle } from '@shared/types';

export function extractReadableArticle(html: string, url: string): ReaderArticle | null {
  if (!html || !html.trim()) return null;
  try {
    const { document } = parseHTML(html);
    // Ensure base URL for relative links inside Readability
    if (!document.querySelector('base')) {
      const base = document.createElement('base');
      base.setAttribute('href', url);
      document.head?.appendChild(base);
    }

    const reader = new Readability(document as unknown as Document, {
      charThreshold: 120
    });
    const parsed = reader.parse();
    if (!parsed) return null;

    return {
      url,
      title: parsed.title || 'Untitled Article',
      byline: parsed.byline ?? null,
      publishedTime: parsed.publishedTime ?? null,
      siteName: parsed.siteName ?? null,
      excerpt: parsed.excerpt ?? null,
      contentHtml: parsed.content || '',
      textContent: parsed.textContent || '',
      length: parsed.length || (parsed.textContent?.length ?? 0)
    };
  } catch {
    return null;
  }
}

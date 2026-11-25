import type { OmniboxSuggestion, SearchEngineId } from '@shared/types';
import type { BrowserRepository } from '@main/db/repositories/browser-repo';

export type { OmniboxSuggestion };

export interface SearchEngineDefinition {
  id: SearchEngineId;
  name: string;
  searchUrlTemplate: string;
}

export const SEARCH_ENGINES: Record<SearchEngineId, SearchEngineDefinition> = {
  google: {
    id: 'google',
    name: 'Google',
    searchUrlTemplate: 'https://www.google.com/search?q={query}'
  },
  duckduckgo: {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    searchUrlTemplate: 'https://duckduckgo.com/?q={query}'
  },
  bing: {
    id: 'bing',
    name: 'Bing',
    searchUrlTemplate: 'https://www.bing.com/search?q={query}'
  },
  brave: {
    id: 'brave',
    name: 'Brave Search',
    searchUrlTemplate: 'https://search.brave.com/search?q={query}'
  },
  startpage: {
    id: 'startpage',
    name: 'Startpage',
    searchUrlTemplate: 'https://www.startpage.com/do/search?q={query}'
  }
};

export function resolveNavigationInput(input: string, searchEngine: SearchEngineId = 'google'): string {
  const trimmed = input.trim();
  if (!trimmed) return 'about:blank';

  if (trimmed === 'about:blank' || trimmed.startsWith('atlas://')) {
    return trimmed;
  }

  // Explicit scheme
  if (/^(https?|file|data):\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Localhost or IP address with optional port
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  // Hostname/domain heuristic (no spaces, contains dot with valid TLD >= 2 chars)
  if (!/\s/.test(trimmed) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  const engine = SEARCH_ENGINES[searchEngine] ?? SEARCH_ENGINES.google;
  return engine.searchUrlTemplate.replace('{query}', encodeURIComponent(trimmed));
}

export function getSecurityState(url: string): 'secure' | 'insecure' | 'internal' | 'unknown' {
  if (!url || url === 'about:blank' || url.startsWith('atlas://')) return 'internal';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return 'secure';
    if (parsed.protocol === 'http:') {
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return 'secure';
      }
      return 'insecure';
    }
    if (parsed.protocol === 'file:' || parsed.protocol === 'data:') return 'internal';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getOmniboxSuggestions(
  repo: BrowserRepository,
  query: string,
  searchEngine: SearchEngineId = 'google'
): OmniboxSuggestion[] {
  const q = query.trim();
  if (!q) return [];
  const results: OmniboxSuggestion[] = [];
  const seenUrls = new Set<string>();

  const { bookmarks } = repo.listBookmarks(q);
  for (const bm of bookmarks.slice(0, 4)) {
    if (!seenUrls.has(bm.url)) {
      seenUrls.add(bm.url);
      results.push({ type: 'bookmark', title: bm.title, url: bm.url, subtitle: 'Bookmark' });
    }
  }

  const history = repo.searchHistory(q, 6);
  for (const h of history) {
    if (!seenUrls.has(h.url)) {
      seenUrls.add(h.url);
      results.push({ type: 'history', title: h.title, url: h.url, subtitle: `Visited ${h.visitCount}x` });
    }
  }

  const resolved = resolveNavigationInput(q, searchEngine);
  if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
    if (!/\s/.test(q) && q.includes('.')) {
      results.unshift({ type: 'url', title: resolved, url: resolved, subtitle: 'Go to URL' });
    } else {
      const engineName = SEARCH_ENGINES[searchEngine]?.name ?? 'Search';
      results.push({ type: 'search', title: `Search ${engineName} for "${q}"`, url: resolved });
    }
  }

  return results.slice(0, 8);
}

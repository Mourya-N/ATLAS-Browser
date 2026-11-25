import type { SearchFilterOptions, SearchMode, SearchProviderHealth } from '@shared/types';

export interface RawSearchCandidate {
  title: string;
  url: string;
  snippet: string;
  sourceProvider: string;
  publishedAt?: string | null;
  contentType?: 'web' | 'news' | 'docs' | 'knowledge' | 'tab' | 'bookmark' | 'research';
  language?: string;
  favicon?: string | null;
  rawRank?: number;
}

export interface ProviderSearchParams {
  query: string;
  mode: SearchMode;
  filters?: SearchFilterOptions;
  limit: number;
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly id: string;
  readonly name: string;
  readonly isMock: boolean;
  isConfigured(): boolean;
  supportsMode(mode: SearchMode): boolean;
  search(params: ProviderSearchParams): Promise<RawSearchCandidate[]>;
  healthCheck(): Promise<SearchProviderHealth>;
}

export async function withProviderTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 5000,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Search provider timeout after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) onAbort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }
}

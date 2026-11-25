import type { ObservabilitySnapshot, SearchProviderHealth } from '@shared/cloud-types';

export class MetricsRegistry {
  private readonly startedAt = Date.now();
  private totalRequests = 0;
  private errorCount = 0;
  private readonly latenciesMs: number[] = [];

  private totalSearches = 0;
  private searchCacheHits = 0;
  private readonly searchLatenciesMs: number[] = [];
  private readonly providerErrors = new Map<string, number>();

  private aiCalls = 0;
  private aiFailedCalls = 0;
  private aiInputTokens = 0;
  private aiOutputTokens = 0;
  private aiEstimatedCostUsd = 0;

  private recordLatency(arr: number[], ms: number): void {
    arr.push(Math.max(0, ms));
    if (arr.length > 500) arr.shift();
  }

  public recordHttpRequest(durationMs: number, statusCode: number): void {
    this.totalRequests += 1;
    if (statusCode >= 500) this.errorCount += 1;
    this.recordLatency(this.latenciesMs, durationMs);
  }

  public recordSearch(durationMs: number, cacheHit: boolean): void {
    this.totalSearches += 1;
    if (cacheHit) this.searchCacheHits += 1;
    this.recordLatency(this.searchLatenciesMs, durationMs);
  }

  public recordProviderError(providerId: string): void {
    this.providerErrors.set(providerId, (this.providerErrors.get(providerId) ?? 0) + 1);
  }

  public recordAiUsage(params: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    failed?: boolean;
  }): void {
    this.aiCalls += 1;
    if (params.failed) this.aiFailedCalls += 1;
    this.aiInputTokens += Math.max(0, params.inputTokens);
    this.aiOutputTokens += Math.max(0, params.outputTokens);
    this.aiEstimatedCostUsd += Math.max(0, params.estimatedCostUsd);
  }

  private avg(arr: number[]): number {
    if (arr.length === 0) return 0;
    return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2));
  }

  private p95(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return Number(sorted[idx].toFixed(2));
  }

  public snapshot(extras: {
    service: string;
    providers: SearchProviderHealth[];
    worker: ObservabilitySnapshot['worker'];
    storage: ObservabilitySnapshot['storage'];
  }): ObservabilitySnapshot {
    const providerErrorsObj: Record<string, number> = {};
    for (const [k, v] of this.providerErrors.entries()) {
      providerErrorsObj[k] = v;
    }

    return {
      service: extras.service,
      uptimeMs: Date.now() - this.startedAt,
      totalRequests: this.totalRequests,
      errorCount: this.errorCount,
      errorRate: this.totalRequests > 0 ? Number((this.errorCount / this.totalRequests).toFixed(4)) : 0,
      avgLatencyMs: this.avg(this.latenciesMs),
      p95LatencyMs: this.p95(this.latenciesMs),
      search: {
        totalSearches: this.totalSearches,
        cacheHits: this.searchCacheHits,
        cacheHitRate:
          this.totalSearches > 0 ? Number((this.searchCacheHits / this.totalSearches).toFixed(4)) : 0,
        avgLatencyMs: this.avg(this.searchLatenciesMs),
        providerErrors: providerErrorsObj,
        providers: extras.providers
      },
      ai: {
        totalCalls: this.aiCalls,
        totalInputTokens: this.aiInputTokens,
        totalOutputTokens: this.aiOutputTokens,
        totalEstimatedCostUsd: Number(this.aiEstimatedCostUsd.toFixed(6)),
        failedCalls: this.aiFailedCalls
      },
      worker: extras.worker,
      storage: extras.storage
    };
  }

  public toPrometheusText(snap: ObservabilitySnapshot): string {
    return [
      '# HELP atlas_http_requests_total Total HTTP requests handled',
      '# TYPE atlas_http_requests_total counter',
      `atlas_http_requests_total ${snap.totalRequests}`,
      '# HELP atlas_http_errors_total Total 5xx HTTP errors',
      '# TYPE atlas_http_errors_total counter',
      `atlas_http_errors_total ${snap.errorCount}`,
      '# HELP atlas_http_latency_p95_ms 95th percentile HTTP latency in ms',
      '# TYPE atlas_http_latency_p95_ms gauge',
      `atlas_http_latency_p95_ms ${snap.p95LatencyMs}`,
      '# HELP atlas_search_total Total searches executed',
      '# TYPE atlas_search_total counter',
      `atlas_search_total ${snap.search.totalSearches}`,
      '# HELP atlas_search_cache_hits_total Search cache hits',
      '# TYPE atlas_search_cache_hits_total counter',
      `atlas_search_cache_hits_total ${snap.search.cacheHits}`,
      '# HELP atlas_ai_tokens_total AI tokens consumed',
      '# TYPE atlas_ai_tokens_total counter',
      `atlas_ai_tokens_total{type="input"} ${snap.ai.totalInputTokens}`,
      `atlas_ai_tokens_total{type="output"} ${snap.ai.totalOutputTokens}`,
      '# HELP atlas_ai_estimated_cost_usd Estimated AI cost USD',
      '# TYPE atlas_ai_estimated_cost_usd counter',
      `atlas_ai_estimated_cost_usd ${snap.ai.totalEstimatedCostUsd}`,
      '# HELP atlas_worker_queue_depth Background jobs by status',
      '# TYPE atlas_worker_queue_depth gauge',
      `atlas_worker_queue_depth{status="queued"} ${snap.worker.queued}`,
      `atlas_worker_queue_depth{status="running"} ${snap.worker.running}`,
      `atlas_worker_queue_depth{status="dead_letter"} ${snap.worker.deadLetter}`
    ].join('\n');
  }
}

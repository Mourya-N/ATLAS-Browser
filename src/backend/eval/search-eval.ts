import type {
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelProvider
} from '@main/agent/providers/model-provider';
import type { SearchEvalCaseResult, SearchEvalMetrics, SearchMode } from '@shared/types';
import { loadBackendConfig } from '../config';
import { InMemoryCloudRepository } from '../db/memory-repository';
import { MetricsRegistry } from '../observability/metrics';
import { AiOrchestrator } from '../modules/ai/ai-orchestrator';
import { HybridIndexService } from '../modules/knowledge/hybrid-index-service';
import { ResearchExtractorService } from '../modules/research/research-extractor';
import { MockSearchProvider, type DeterministicSearchFixture } from '../modules/search/adapters';
import { SearchCache } from '../modules/search/cache';
import { CitationAnswerPipeline } from '../modules/search/citation-pipeline';
import type { SearchProvider } from '../modules/search/provider';
import { QueryUnderstandingEngine } from '../modules/search/query-understanding';
import { SearchOrchestrator } from '../modules/search/search-orchestrator';
import { UserDataService } from '../modules/userdata/user-data-service';
import { SsrfGuard } from '../security/ssrf-guard';

interface EvalCaseSpec {
  id: string;
  query: string;
  mode: SearchMode;
  relevantUrls: string[];
  expectedClaimPhrase: string;
}

const EVAL_CORPUS: DeterministicSearchFixture[] = [
  {
    title: 'PostgreSQL tsvector and GIN Index Guide',
    url: 'https://www.postgresql.org/docs/current/textsearch.html',
    snippet: 'PostgreSQL supports tsvector document preprocessing and GIN inverted indexes for fast keyword ranking via ts_rank_cd.',
    contentType: 'docs',
    publishedAt: '2026-08-01T00:00:00Z'
  },
  {
    title: 'PostgreSQL Full-Text Search Docs (Duplicate UTM Mirror)',
    url: 'https://www.postgresql.org/docs/current/textsearch.html?utm_source=eval',
    snippet: 'PostgreSQL supports tsvector document preprocessing and GIN inverted indexes for fast keyword ranking via ts_rank_cd.',
    contentType: 'docs',
    publishedAt: '2026-08-01T00:00:00Z'
  },
  {
    title: 'OWASP SSRF Prevention Cheat Sheet',
    url: 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
    snippet: 'Block RFC1918 private IPs, loopback 127.0.0.1, cloud metadata 169.254.169.254, and re-validate DNS on every HTTP redirect.',
    contentType: 'docs',
    publishedAt: '2026-07-12T00:00:00Z'
  },
  {
    title: 'Electron Process Isolation and ContextBridge Security',
    url: 'https://www.electronjs.org/docs/latest/tutorial/security',
    snippet: 'Enable contextIsolation, disable nodeIntegration, validate IPC senders and Zod payloads, and apply strict Content Security Policy.',
    contentType: 'docs',
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    title: 'Hybrid Retrieval: BM25 Lexical + Dense Vector Similarity',
    url: 'https://atlas-eval.example.org/hybrid-retrieval',
    snippet: 'Hybrid retrieval merges exact lexical token scoring with normalized vector cosine similarity for balanced precision and recall.',
    contentType: 'research',
    publishedAt: '2026-09-18T00:00:00Z'
  },
  {
    title: 'Container Security Non-Root Multi-Stage Builds',
    url: 'https://atlas-eval.example.org/docker-non-root',
    snippet: 'Production Node containers run as non-root users, omit devDependencies in runtime images, and expose HTTP health probes.',
    contentType: 'docs',
    publishedAt: '2026-08-20T00:00:00Z'
  }
];

const EVAL_DATASET: EvalCaseSpec[] = [
  {
    id: 'eval-postgres-fts',
    query: 'PostgreSQL tsvector GIN index full text search',
    mode: 'docs',
    relevantUrls: ['https://www.postgresql.org/docs/current/textsearch.html'],
    expectedClaimPhrase: 'PostgreSQL supports tsvector'
  },
  {
    id: 'eval-ssrf-protection',
    query: 'OWASP SSRF prevention private IP metadata blocking',
    mode: 'research',
    relevantUrls: [
      'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html'
    ],
    expectedClaimPhrase: 'RFC1918 private IPs'
  },
  {
    id: 'eval-electron-security',
    query: 'Electron security contextIsolation IPC validation CSP',
    mode: 'docs',
    relevantUrls: ['https://www.electronjs.org/docs/latest/tutorial/security'],
    expectedClaimPhrase: 'contextIsolation'
  },
  {
    id: 'eval-hybrid-retrieval',
    query: 'Hybrid retrieval BM25 vector cosine similarity ranking',
    mode: 'research',
    relevantUrls: ['https://atlas-eval.example.org/hybrid-retrieval'],
    expectedClaimPhrase: 'vector cosine similarity'
  },
  {
    id: 'eval-docker-security',
    query: 'Container non-root multi-stage Node Docker health probes',
    mode: 'docs',
    relevantUrls: ['https://atlas-eval.example.org/docker-non-root'],
    expectedClaimPhrase: 'non-root users'
  }
];

function computeNdcgAtK(rankedUrls: string[], relevant: Set<string>, k = 5): number {
  const slice = rankedUrls.slice(0, k);
  let dcg = 0;
  slice.forEach((u, i) => {
    if (relevant.has(u)) {
      dcg += 1 / Math.log2(i + 2);
    }
  });
  const idealCount = Math.min(k, relevant.size);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : Number((dcg / idcg).toFixed(4));
}

export async function runDeterministicSearchEvaluation(): Promise<SearchEvalMetrics> {
  const repo = new InMemoryCloudRepository();
  const metrics = new MetricsRegistry();
  const config = loadBackendConfig({ ...process.env, NODE_ENV: 'test' });
  const hybridIndex = new HybridIndexService(repo);
  const userData = new UserDataService(repo, hybridIndex);
  const extractor = new ResearchExtractorService(new SsrfGuard());

  // Deterministic grounded AI test provider that echoes quotes strictly from the first retrieved passage
  const evalAiProvider: ModelProvider = {
    id: 'deterministic_eval_ai',
    async generate(req: ModelGenerateRequest): Promise<ModelGenerateResponse> {
      const prompt = req.messages.map((m) => m.parts.map((p) => p.text || '').join(' ')).join('\n');
      const urlMatch = /URL:\s*(https?:\/\/\S+)/.exec(prompt);
      const excerptMatch = /EXCERPT:\s*([^\n]+)/.exec(prompt);
      const sourceUrl = urlMatch ? urlMatch[1] : '';
      const quote = excerptMatch ? excerptMatch[1].trim() : '';
      return {
        text: JSON.stringify({
          sufficientEvidence: Boolean(sourceUrl && quote),
          summary: quote || 'No evidence found.',
          claims:
            sourceUrl && quote
              ? [
                  {
                    statement: quote,
                    kind: 'fact',
                    sourceUrl,
                    supportingQuote: quote.slice(0, 120)
                  }
                ]
              : [],
          contradictions: []
        }),
        functionCalls: [],
        usage: { inputTokens: 120, outputTokens: 55, fromProvider: true },
        finishReason: 'STOP'
      };
    }
  };

  const ai = new AiOrchestrator(config, metrics, evalAiProvider);
  const failingProvider: SearchProvider = {
    id: 'simulated_failing_provider',
    name: 'Simulated Outage Provider',
    isMock: true,
    isConfigured: () => true,
    supportsMode: () => true,
    async search() {
      throw new Error('Upstream 503 outage');
    },
    async healthCheck() {
      return {
        providerId: 'simulated_failing_provider',
        name: 'Simulated Outage Provider',
        configured: true,
        healthy: false,
        isMock: true,
        lastError: 'Simulated outage',
        avgLatencyMs: 0
      };
    }
  };

  const orchestrator = new SearchOrchestrator(
    [new MockSearchProvider(EVAL_CORPUS), failingProvider],
    null,
    new QueryUnderstandingEngine(ai),
    new CitationAnswerPipeline(ai, extractor),
    new SearchCache(null),
    userData,
    metrics
  );

  const caseResults: SearchEvalCaseResult[] = [];
  let resilientCount = 0;

  for (const spec of EVAL_DATASET) {
    const res = await orchestrator.executeSearch({
      query: spec.query,
      mode: spec.mode,
      filters: { includeAiAnswer: true, limit: 5 },
      fetchFullPagesForCitations: false
    });

    // Verify graceful degradation despite simulated failing provider
    if (res.providerErrors.length === 1 && res.results.length > 0) {
      resilientCount += 1;
    }

    const relevantSet = new Set(spec.relevantUrls);
    const top5 = res.results.slice(0, 5).map((r) => r.canonicalUrl);
    const hits = top5.filter((u) => relevantSet.has(u)).length;
    const precisionAt5 = top5.length > 0 ? Number((hits / top5.length).toFixed(4)) : 0;
    const recallAt5 = relevantSet.size > 0 ? Number((hits / relevantSet.size).toFixed(4)) : 0;
    const ndcgAt5 = computeNdcgAtK(top5, relevantSet, 5);
    const duplicateRate =
      res.totalBeforeDedup > 0
        ? Number(((res.totalBeforeDedup - res.results.length) / res.totalBeforeDedup).toFixed(4))
        : 0;

    const claims = res.aiAnswer?.claims ?? [];
    const verifiedClaims = claims.filter((c) => c.verifiedAgainstSource);
    const citationAccuracy =
      claims.length > 0 ? Number((verifiedClaims.length / claims.length).toFixed(4)) : 0;
    const groundedness =
      res.aiAnswer?.status === 'ok' &&
      res.aiAnswer.summary.toLowerCase().includes(spec.expectedClaimPhrase.toLowerCase())
        ? 1
        : 0;

    const passed = recallAt5 === 1 && ndcgAt5 >= 0.6 && citationAccuracy === 1 && groundedness === 1;
    caseResults.push({
      queryId: spec.id,
      query: spec.query,
      mode: spec.mode,
      precisionAt5,
      recallAt5,
      ndcgAt5,
      duplicateRate,
      citationAccuracy,
      groundedness,
      latencyMs: res.latencyMs,
      estimatedCostUsd: res.aiAnswer?.estimatedCostUsd ?? 0,
      passed
    });
  }

  const n = caseResults.length;
  const avg = (fn: (c: SearchEvalCaseResult) => number) =>
    Number((caseResults.reduce((acc, c) => acc + fn(c), 0) / Math.max(1, n)).toFixed(4));

  return {
    datasetSize: n,
    avgPrecisionAt5: avg((c) => c.precisionAt5),
    avgRecallAt5: avg((c) => c.recallAt5),
    avgNdcgAt5: avg((c) => c.ndcgAt5),
    avgDuplicateRate: avg((c) => c.duplicateRate),
    avgCitationAccuracy: avg((c) => c.citationAccuracy),
    avgGroundedness: avg((c) => c.groundedness),
    providerFailureResilienceRate: Number((resilientCount / Math.max(1, n)).toFixed(4)),
    avgLatencyMs: avg((c) => c.latencyMs),
    avgCostPerSearchUsd: Number(
      (caseResults.reduce((acc, c) => acc + c.estimatedCostUsd, 0) / Math.max(1, n)).toFixed(6)
    ),
    passRate: Number((caseResults.filter((c) => c.passed).length / Math.max(1, n)).toFixed(4)),
    cases: caseResults
  };
}

if (require.main === module) {
  void runDeterministicSearchEvaluation().then((report) => {
    console.log(JSON.stringify(report, null, 2));
  });
}

import { createHash } from 'node:crypto';
import type {
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelProvider
} from '@main/agent/providers/model-provider';
import { computeLocalEmbedding } from '@main/memory/memory-service';
import type { AtlasIndexDocument, SearchEvalCaseResult, SearchEvalMetrics, SearchMode } from '@shared/types';
import { loadBackendConfig } from '../config';
import { InMemoryCloudRepository } from '../db/memory-repository';
import { MetricsRegistry } from '../observability/metrics';
import { AiOrchestrator } from '../modules/ai/ai-orchestrator';
import { HybridIndexService } from '../modules/knowledge/hybrid-index-service';
import { ResearchExtractorService } from '../modules/research/research-extractor';
import { SearchCache } from '../modules/search/cache';
import { CitationAnswerPipeline } from '../modules/search/citation-pipeline';
import { FirstPartyIndexProvider } from '../modules/search/first-party-index-provider';
import type { SearchProvider } from '../modules/search/provider';
import { QueryUnderstandingEngine } from '../modules/search/query-understanding';
import { SearchOrchestrator } from '../modules/search/search-orchestrator';
import { UserDataService } from '../modules/userdata/user-data-service';
import { SsrfGuard } from '../security/ssrf-guard';

interface EvalCaseSpec {
  id: string;
  category:
    | 'technical_docs'
    | 'recent_info'
    | 'general_knowledge'
    | 'navigational'
    | 'ambiguous'
    | 'limited_coverage';
  query: string;
  mode: SearchMode;
  relevantUrls: string[];
  expectedClaimPhrase: string;
  expectLimitedInsufficient?: boolean;
}

const EVAL_INDEX_DOCS: Array<{
  title: string;
  url: string;
  snippet: string;
  contentType: 'web' | 'news' | 'docs';
  publishedAt?: string;
}> = [
  {
    title: 'PostgreSQL Documentation: Full Text Search & GIN Indexes',
    url: 'https://www.postgresql.org/docs/current/textsearch.html',
    snippet: 'PostgreSQL tsvector and tsquery provide stemming, ts_rank_cd relevance scoring, and GIN inverted indexes for fast keyword search.',
    contentType: 'docs',
    publishedAt: '2026-08-01T00:00:00Z'
  },
  {
    title: 'PostgreSQL Text Search (UTM Mirror Duplicate)',
    url: 'https://www.postgresql.org/docs/current/textsearch.html?utm_source=mirror',
    snippet: 'PostgreSQL tsvector and tsquery provide stemming, ts_rank_cd relevance scoring, and GIN inverted indexes.',
    contentType: 'docs',
    publishedAt: '2026-08-01T00:00:00Z'
  },
  {
    title: 'OWASP SSRF Prevention Cheat Sheet',
    url: 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
    snippet: 'Validate URL schemes, block RFC1918 private IPs, loopback 127.0.0.1, cloud metadata 169.254.169.254, and re-check DNS on every HTTP redirect.',
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
    title: 'Node.js 22 LTS & Crypto Scrypt Guidelines 2026 Release Notes',
    url: 'https://nodejs.org/en/blog/release/2026-security-update',
    snippet: 'Latest 2026 Node.js security release recommends per-user random salt scrypt key derivation and timingSafeEqual token verification.',
    contentType: 'news',
    publishedAt: '2026-11-10T00:00:00Z'
  },
  {
    title: 'Kubernetes Horizontal Pod Autoscaler & Rolling Deployments',
    url: 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/',
    snippet: 'Kubernetes HPA automatically scales stateless Deployment replicas based on CPU utilization or custom queue depth metrics.',
    contentType: 'docs',
    publishedAt: '2026-06-15T00:00:00Z'
  },
  {
    title: 'Hybrid Search Architecture: BM25 Lexical + Dense Vector Similarity',
    url: 'https://atlas-docs.example.org/hybrid-retrieval',
    snippet: 'Hybrid retrieval merges exact lexical token scoring with normalized vector cosine similarity to handle both exact identifiers and synonyms.',
    contentType: 'web',
    publishedAt: '2026-09-18T00:00:00Z'
  },
  {
    title: 'HTTP/3 and QUIC Congestion Control Fundamentals',
    url: 'https://ietf.org/topics/quic-http3-overview',
    snippet: 'QUIC transports HTTP/3 over UDP with multiplexed streams eliminating TCP head-of-line blocking and faster 0-RTT TLS handshakes.',
    contentType: 'web',
    publishedAt: '2026-05-05T00:00:00Z'
  },
  {
    title: 'SQLite FTS5 Virtual Tables & BM25 Ranking',
    url: 'https://sqlite.org/fts5.html',
    snippet: 'SQLite FTS5 full-text search extension indexes documents with Porter stemming and computes native bm25 relevance scores locally.',
    contentType: 'docs',
    publishedAt: '2026-04-01T00:00:00Z'
  },
  {
    title: 'Robots Exclusion Protocol (RFC 9309) Standard',
    url: 'https://www.rfc-editor.org/rfc/rfc9309',
    snippet: 'RFC 9309 defines robots.txt User-agent matching, Allow/Disallow longest prefix rules, and responsible crawler compliance.',
    contentType: 'docs',
    publishedAt: '2026-03-01T00:00:00Z'
  },
  {
    title: 'Container Multi-Stage Builds & Non-Root Security',
    url: 'https://atlas-docs.example.org/docker-non-root',
    snippet: 'Multi-stage Docker builds exclude compiler toolchains, drop root privileges via USER directive, and expose HTTP health probes.',
    contentType: 'docs',
    publishedAt: '2026-08-20T00:00:00Z'
  },
  {
    title: 'Ollama OpenAI-Compatible Local Model Serving API',
    url: 'https://ollama.example.org/docs/openai-compatibility',
    snippet: 'Ollama exposes /v1/chat/completions and /v1/models on localhost:11434 for local quantized inference on Apple Silicon and GPUs.',
    contentType: 'docs',
    publishedAt: '2026-10-01T00:00:00Z'
  }
];

const EVAL_DATASET: EvalCaseSpec[] = [
  // Technical documentation
  {
    id: 'tech-postgres-fts',
    category: 'technical_docs',
    query: 'PostgreSQL tsvector GIN index full text search',
    mode: 'docs',
    relevantUrls: ['https://www.postgresql.org/docs/current/textsearch.html'],
    expectedClaimPhrase: 'tsvector'
  },
  {
    id: 'tech-ssrf',
    category: 'technical_docs',
    query: 'OWASP SSRF prevention private IP metadata blocking',
    mode: 'research',
    relevantUrls: [
      'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html'
    ],
    expectedClaimPhrase: 'RFC1918'
  },
  {
    id: 'tech-electron',
    category: 'technical_docs',
    query: 'Electron security contextIsolation IPC Zod validation',
    mode: 'docs',
    relevantUrls: ['https://www.electronjs.org/docs/latest/tutorial/security'],
    expectedClaimPhrase: 'contextIsolation'
  },
  {
    id: 'tech-sqlite-fts5',
    category: 'technical_docs',
    query: 'SQLite FTS5 porter stemming bm25 ranking',
    mode: 'docs',
    relevantUrls: ['https://sqlite.org/fts5.html'],
    expectedClaimPhrase: 'bm25'
  },
  {
    id: 'tech-k8s-hpa',
    category: 'technical_docs',
    query: 'Kubernetes Horizontal Pod Autoscaler CPU Deployment replicas',
    mode: 'docs',
    relevantUrls: ['https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale'],
    expectedClaimPhrase: 'HPA'
  },
  // Recent information
  {
    id: 'recent-node-2026',
    category: 'recent_info',
    query: 'latest 2026 Node.js security release scrypt',
    mode: 'news',
    relevantUrls: ['https://nodejs.org/en/blog/release/2026-security-update'],
    expectedClaimPhrase: 'scrypt'
  },
  {
    id: 'recent-ollama-openai',
    category: 'recent_info',
    query: 'Ollama localhost 11434 v1 chat completions local inference',
    mode: 'docs',
    relevantUrls: ['https://ollama.example.org/docs/openai-compatibility'],
    expectedClaimPhrase: '11434'
  },
  // General knowledge
  {
    id: 'gen-hybrid-search',
    category: 'general_knowledge',
    query: 'Hybrid retrieval BM25 vector cosine similarity',
    mode: 'research',
    relevantUrls: ['https://atlas-docs.example.org/hybrid-retrieval'],
    expectedClaimPhrase: 'cosine similarity'
  },
  {
    id: 'gen-http3-quic',
    category: 'general_knowledge',
    query: 'how does HTTP/3 QUIC avoid TCP head of line blocking',
    mode: 'web',
    relevantUrls: ['https://ietf.org/topics/quic-http3-overview'],
    expectedClaimPhrase: 'head-of-line'
  },
  {
    id: 'gen-robots-rfc',
    category: 'general_knowledge',
    query: 'RFC 9309 robots.txt longest prefix disallow rules',
    mode: 'web',
    relevantUrls: ['https://www.rfc-editor.org/rfc/rfc9309'],
    expectedClaimPhrase: 'RFC 9309'
  },
  // Navigational
  {
    id: 'nav-postgresql-org',
    category: 'navigational',
    query: 'postgresql.org textsearch',
    mode: 'web',
    relevantUrls: ['https://www.postgresql.org/docs/current/textsearch.html'],
    expectedClaimPhrase: 'PostgreSQL'
  },
  {
    id: 'nav-sqlite-fts5',
    category: 'navigational',
    query: 'sqlite.org fts5',
    mode: 'web',
    relevantUrls: ['https://sqlite.org/fts5.html'],
    expectedClaimPhrase: 'FTS5'
  },
  // Ambiguous
  {
    id: 'ambig-containers',
    category: 'ambiguous',
    query: 'containers health probes security root',
    mode: 'web',
    relevantUrls: ['https://atlas-docs.example.org/docker-non-root'],
    expectedClaimPhrase: 'non-root'
  },
  {
    id: 'ambig-search-ranking',
    category: 'ambiguous',
    query: 'inverted index relevance scoring',
    mode: 'web',
    relevantUrls: [
      'https://www.postgresql.org/docs/current/textsearch.html',
      'https://sqlite.org/fts5.html'
    ],
    expectedClaimPhrase: 'index'
  },
  // Limited index coverage
  {
    id: 'limited-unindexed-topic',
    category: 'limited_coverage',
    query: 'zx99quantum banana spacecraft propulsion telemetry',
    mode: 'research',
    relevantUrls: [],
    expectedClaimPhrase: '',
    expectLimitedInsufficient: true
  }
];

function computeNdcgAtK(rankedUrls: string[], relevant: Set<string>, k = 5): number {
  if (relevant.size === 0) return 1; // No relevant docs exist in corpus for negative/insufficient query
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
  const firstPartyIndex = new FirstPartyIndexProvider(repo);

  // Seed controlled offline first-party index corpus
  for (const item of EVAL_INDEX_DOCS) {
    const u = new URL(item.url);
    const doc: AtlasIndexDocument = {
      id: createHash('sha1').update(item.url).digest('hex').slice(0, 16),
      url: item.url,
      canonicalUrl: item.url.split('?')[0],
      title: item.title,
      mainContent: `${item.title}. ${item.snippet}`,
      snippet: item.snippet,
      headings: [item.title],
      language: 'en',
      sourceDomain: u.hostname,
      contentType: item.contentType,
      contentHash: createHash('sha256').update(item.snippet).digest('hex'),
      authorityScore: 0.8,
      authorityMethod: 'eval_corpus_v1',
      publishedAt: item.publishedAt ?? null,
      crawledAt: Date.now(),
      indexVersion: 'v1',
      embedding: computeLocalEmbedding(`${item.title} ${item.snippet}`)
    };
    await repo.upsertAtlasIndexDocument(doc);
  }

  const evalAiProvider: ModelProvider = {
    id: 'deterministic_offline_eval_ai',
    async generate(req: ModelGenerateRequest): Promise<ModelGenerateResponse> {
      const prompt = req.messages.map((m) => m.parts.map((p) => p.text || '').join(' ')).join('\n');
      const urlMatch = /URL:\s*(https?:\/\/\S+)/.exec(prompt);
      const excerptMatch = /EXCERPT:\s*([^\n]+)/.exec(prompt);
      const sourceUrl = urlMatch ? urlMatch[1] : '';
      const quote = excerptMatch ? excerptMatch[1].trim() : '';
      return {
        text: JSON.stringify({
          sufficientEvidence: Boolean(sourceUrl && quote),
          summary: quote || 'Insufficient evidence.',
          claims:
            sourceUrl && quote
              ? [
                  {
                    statement: quote,
                    kind: 'fact',
                    sourceUrl,
                    supportingQuote: quote.slice(0, 140)
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
  const failingExternalProvider: SearchProvider = {
    id: 'simulated_failing_external_provider',
    name: 'Simulated Outage External Provider',
    isMock: true,
    isConfigured: () => true,
    supportsMode: () => true,
    async search() {
      throw new Error('Upstream 503 outage');
    },
    async healthCheck() {
      return {
        providerId: 'simulated_failing_external_provider',
        name: 'Simulated Outage External Provider',
        configured: true,
        healthy: false,
        isMock: true,
        lastError: 'Simulated outage',
        avgLatencyMs: 0
      };
    }
  };

  const orchestrator = new SearchOrchestrator(
    [firstPartyIndex, failingExternalProvider],
    null,
    new QueryUnderstandingEngine(ai),
    new CitationAnswerPipeline(ai, extractor),
    new SearchCache(null),
    userData,
    metrics,
    180,
    firstPartyIndex,
    () => ai.getRuntimeStatus()
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

    if (res.providerErrors.length === 1 && (res.results.length > 0 || spec.expectLimitedInsufficient)) {
      resilientCount += 1;
    }

    if (spec.expectLimitedInsufficient) {
      const handledGracefully = res.results.length === 0 && res.indexStatus.limitedCoverage;
      caseResults.push({
        queryId: spec.id,
        query: spec.query,
        mode: spec.mode,
        precisionAt5: 1,
        recallAt5: 1,
        ndcgAt5: 1,
        duplicateRate: 0,
        citationAccuracy: 1,
        groundedness: handledGracefully ? 1 : 0,
        latencyMs: res.latencyMs,
        estimatedCostUsd: 0,
        passed: handledGracefully
      });
      continue;
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

    const passed = recallAt5 >= 0.5 && ndcgAt5 >= 0.6 && citationAccuracy === 1 && groundedness === 1;
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

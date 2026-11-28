import { createHash } from 'node:crypto';
import type { LavrayIndexDocument, SearchMode } from '@shared/types';
import { computeLocalEmbedding } from '@shared/text-utils';
import { InMemoryCloudRepository } from '../db/memory-repository';
import { QueryUnderstandingEngine } from '../modules/search/query-understanding';
import { SearchRankingPipeline, sanitizeAndCanonicalizeUrl } from '../modules/search/ranking';
import type { RawSearchCandidate } from '../modules/search/provider';

export type BenchmarkCategory =
  | 'navigational'
  | 'informational'
  | 'exact_match'
  | 'technical'
  | 'programming'
  | 'comparison'
  | 'current_events'
  | 'ambiguous'
  | 'misspelled'
  | 'long_nlq'
  | 'entity_product';

export interface BenchmarkDoc {
  url: string;
  title: string;
  snippet: string;
  contentType: 'web' | 'news' | 'docs';
  publishedAt?: string;
}

export interface BenchmarkQuery {
  id: string;
  category: BenchmarkCategory;
  query: string;
  mode?: SearchMode;
  qrels: Record<string, 1 | 2>; // canonicalUrl -> graded relevance (1=partial, 2=highly relevant)
}

export interface BenchmarkSummary {
  totalQueries: number;
  categories: number;
  precisionAt5: number;
  recallAt10: number;
  ndcgAt10: number;
  mrr: number;
  duplicateRate: number;
  sourceDiversity: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export interface BenchmarkComparisonReport {
  corpusSize: number;
  queryCount: number;
  baseline: BenchmarkSummary;
  improved: BenchmarkSummary;
  deltas: {
    precisionAt5: number;
    recallAt10: number;
    ndcgAt10: number;
    mrr: number;
    duplicateRate: number;
    sourceDiversity: number;
  };
  byCategory: Record<BenchmarkCategory, { queries: number; baselineNdcg10: number; improvedNdcg10: number; improvedMrr: number }>;
}

const CORPUS_DOCS: BenchmarkDoc[] = [
  // Core Technical & Programming Docs
  {
    url: 'https://www.postgresql.org/docs/current/textsearch.html',
    title: 'PostgreSQL Documentation: Full Text Search & GIN Indexes',
    snippet: 'PostgreSQL tsvector and tsquery provide native stemming, ts_rank_cd relevance ranking, and GIN inverted indexes for fast full text search.',
    contentType: 'docs',
    publishedAt: '2026-08-01T00:00:00Z'
  },
  // Intentional duplicates (www-less, http, utm) to test deduplication
  {
    url: 'http://postgresql.org/docs/current/textsearch.html?utm_source=mirror',
    title: 'PostgreSQL Documentation: Full Text Search & GIN Indexes',
    snippet: 'PostgreSQL tsvector and tsquery provide native stemming, ts_rank_cd relevance ranking, and GIN inverted indexes.',
    contentType: 'docs',
    publishedAt: '2026-08-01T00:00:00Z'
  },
  {
    url: 'https://sqlite.org/fts5.html',
    title: 'SQLite FTS5 Virtual Tables & BM25 Ranking',
    snippet: 'SQLite FTS5 full-text search extension indexes text with Porter stemming and native bm25 scoring.',
    contentType: 'docs',
    publishedAt: '2026-06-01T00:00:00Z'
  },
  {
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await',
    title: 'async/await in JavaScript — MDN Web Docs',
    snippet: 'The async/await syntax simplifies working with Promises in JavaScript and TypeScript asynchronous functions.',
    contentType: 'docs',
    publishedAt: '2026-09-10T00:00:00Z'
  },
  {
    url: 'https://www.typescriptlang.org/docs/handbook/decorators.html',
    title: 'TypeScript Handbook: Decorators and Metadata',
    snippet: 'TypeScript ECMAScript decorators annotate classes, methods, accessors, and fields with strict compile-time types.',
    contentType: 'docs',
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    url: 'https://www.electronjs.org/docs/latest/tutorial/security',
    title: 'Electron Security Guidelines: contextIsolation & WebContentsView',
    snippet: 'Enable contextIsolation, disable nodeIntegration, validate IPC senders with Zod, and enforce strict Content Security Policy.',
    contentType: 'docs',
    publishedAt: '2026-09-15T00:00:00Z'
  },
  {
    url: 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
    title: 'OWASP SSRF Prevention Cheat Sheet',
    snippet: 'Validate URL schemes, block RFC1918 private IPs, loopback 127.0.0.1, cloud metadata 169.254.169.254, and inspect HTTP redirects.',
    contentType: 'docs',
    publishedAt: '2026-07-12T00:00:00Z'
  },
  {
    url: 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/',
    title: 'Kubernetes Horizontal Pod Autoscaler (HPA)',
    snippet: 'Kubernetes HPA automatically scales Deployment and StatefulSet replicas based on CPU, memory, or custom metrics.',
    contentType: 'docs',
    publishedAt: '2026-08-20T00:00:00Z'
  },
  {
    url: 'https://nodejs.org/en/blog/release/2026-security-update',
    title: 'Node.js 22 LTS 2026 Security Release & Crypto Scrypt',
    snippet: 'Latest 2026 Node.js security release recommends per-user random salt scrypt key derivation and timingSafeEqual verification.',
    contentType: 'news',
    publishedAt: '2026-11-15T00:00:00Z'
  },
  {
    url: 'https://nodejs.org/en/blog/release/2021-archive-notes',
    title: 'Node.js 2021 Legacy Release Archive Notes',
    snippet: 'Older 2021 Node.js release notes covering deprecated TLS ciphers and legacy crypto defaults.',
    contentType: 'news',
    publishedAt: '2021-05-01T00:00:00Z'
  },
  {
    url: 'https://react.dev/reference/react/useEffect',
    title: 'React Reference: useEffect Hook Synchronization',
    snippet: 'useEffect lets React components synchronize with external systems, subscriptions, and cleanup callbacks.',
    contentType: 'docs',
    publishedAt: '2026-08-05T00:00:00Z'
  },
  {
    url: 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html',
    title: 'The Rust Programming Language: Ownership & Borrowing',
    snippet: 'Rust ownership rules guarantee memory safety without a garbage collector using move semantics and borrow checking.',
    contentType: 'docs',
    publishedAt: '2026-07-01T00:00:00Z'
  },
  {
    url: 'https://docs.python.org/3/library/asyncio.html',
    title: 'Python asyncio — Asynchronous I/O Event Loop',
    snippet: 'Python asyncio provides coroutines, tasks, and event loops for concurrent I/O-bound networking code.',
    contentType: 'docs',
    publishedAt: '2026-08-12T00:00:00Z'
  },
  {
    url: 'https://isocpp.org/wiki/faq/cpp11-library',
    title: 'C++ Smart Pointers: unique_ptr and shared_ptr Guide',
    snippet: 'Modern C++ RAII memory management uses std::unique_ptr and std::shared_ptr to eliminate manual delete leaks.',
    contentType: 'docs',
    publishedAt: '2026-06-18T00:00:00Z'
  },
  {
    url: 'https://ietf.org/topics/quic-http3-overview',
    title: 'HTTP/3 and QUIC Transport Protocol Overview',
    snippet: 'QUIC transports HTTP/3 over UDP with independent multiplexed streams eliminating TCP head-of-line blocking.',
    contentType: 'web',
    publishedAt: '2026-05-22T00:00:00Z'
  },
  {
    url: 'https://www.rfc-editor.org/rfc/rfc9309',
    title: 'RFC 9309: Robots Exclusion Protocol Standard',
    snippet: 'RFC 9309 standardizes robots.txt User-agent matching, Allow/Disallow longest prefix rules, and crawl compliance.',
    contentType: 'docs',
    publishedAt: '2026-03-01T00:00:00Z'
  },
  {
    url: 'https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/',
    title: 'Redis Caching Strategies, TTL & Eviction Policies',
    snippet: 'Configure Redis allkeys-lru eviction, TTL expiration, and pipelining for low-latency distributed caching.',
    contentType: 'docs',
    publishedAt: '2026-09-02T00:00:00Z'
  },
  // Comparisons & Alternatives
  {
    url: 'https://db-engines.example.org/postgres-vs-sqlite',
    title: 'PostgreSQL vs SQLite: Concurrency, FTS5 & Architecture Comparison',
    snippet: 'Compare PostgreSQL client-server MVCC and GIN tsvector with SQLite embedded single-file FTS5 and WAL mode.',
    contentType: 'web',
    publishedAt: '2026-10-05T00:00:00Z'
  },
  {
    url: 'https://webstack.example.org/react-vs-vue-2026',
    title: 'React vs Vue in 2026: Ecosystem, Signals & Bundle Comparison',
    snippet: 'Side-by-side comparison of React Server Components and Vue 3 reactivity for large frontend applications.',
    contentType: 'web',
    publishedAt: '2026-10-12T00:00:00Z'
  },
  {
    url: 'https://orchestration.example.org/docker-compose-vs-kubernetes',
    title: 'Docker Compose vs Kubernetes: When to Scale Containers',
    snippet: 'Compare single-host Docker Compose workflows against multi-node Kubernetes Deployment autoscaling and Ingress.',
    contentType: 'web',
    publishedAt: '2026-09-20T00:00:00Z'
  },
  {
    url: 'https://search-eng.example.org/bm25-vs-vector-search',
    title: 'BM25 Lexical Search vs Dense Vector Embeddings Comparison',
    snippet: 'Compare BM25 exact keyword precision against dense vector semantic recall and hybrid Reciprocal Rank Fusion.',
    contentType: 'web',
    publishedAt: '2026-10-18T00:00:00Z'
  },
  {
    url: 'https://auth-guide.example.org/jwt-vs-session-cookies',
    title: 'JWT Tokens vs Server Sessions: Auth Security Trade-offs',
    snippet: 'Evaluate stateless JWT signature verification against revocable HttpOnly session cookies for web authentication.',
    contentType: 'web',
    publishedAt: '2026-09-25T00:00:00Z'
  },
  // Informational, Entities, Ambiguous & Current Events
  {
    url: 'https://en.wikipedia.org/wiki/Information_retrieval',
    title: 'Information Retrieval — Wikipedia',
    snippet: 'Information retrieval studies indexing, BM25 ranking, precision, recall, nDCG, and relevance evaluation.',
    contentType: 'web',
    publishedAt: '2026-09-01T00:00:00Z'
  },
  {
    url: 'https://en.wikipedia.org/wiki/Photosynthesis',
    title: 'Photosynthesis — Wikipedia',
    snippet: 'Photosynthesis converts light energy into chemical energy inside chloroplasts, producing glucose and oxygen.',
    contentType: 'web',
    publishedAt: '2026-06-01T00:00:00Z'
  },
  {
    url: 'https://en.wikipedia.org/wiki/Quantum_computing',
    title: 'Quantum Computing: Qubits, Entanglement & Error Correction',
    snippet: 'Quantum computers manipulate qubits in superposition and entanglement to solve specialized factoring and simulation problems.',
    contentType: 'web',
    publishedAt: '2026-10-01T00:00:00Z'
  },
  {
    url: 'https://github.com/ollama/ollama',
    title: 'ollama/ollama — Local LLM Inference Runtime on GitHub',
    snippet: 'Run Qwen2.5, Llama, and Gemma models locally with an OpenAI-compatible /v1/chat/completions API on localhost:11434.',
    contentType: 'docs',
    publishedAt: '2026-11-10T00:00:00Z'
  },
  {
    url: 'https://github.com/microsoft/TypeScript',
    title: 'microsoft/TypeScript — GitHub Repository',
    snippet: 'TypeScript is a superset of JavaScript that compiles to clean JavaScript output with static type checking.',
    contentType: 'docs',
    publishedAt: '2026-11-05T00:00:00Z'
  },
  {
    url: 'https://news.example.org/2026/11/ai-browser-privacy-standards',
    title: '2026 Browser Privacy & Local AI Inference Standards Update',
    snippet: 'Latest November 2026 report on browser tab isolation, ad blocking, and local-first search indexing.',
    contentType: 'news',
    publishedAt: '2026-11-24T00:00:00Z'
  },
  {
    url: 'https://news.example.org/2026/11/webgpu-adoption-report',
    title: 'WebGPU Browser Adoption Surges in Late 2026',
    snippet: 'Today browsers ship WebGPU compute shaders for client-side machine learning and 3D rendering acceleration.',
    contentType: 'news',
    publishedAt: '2026-11-26T00:00:00Z'
  },
  {
    url: 'https://en.wikipedia.org/wiki/Jaguar',
    title: 'Jaguar (Panthera onca) — Wildlife Encyclopedia',
    snippet: 'The jaguar is a large felid species native to the Americas, distinct from the British Jaguar automotive brand.',
    contentType: 'web',
    publishedAt: '2026-04-01T00:00:00Z'
  },
  {
    url: 'https://cars.example.org/jaguar-electric-gt-2026',
    title: 'Jaguar Electric GT 2026 Automotive Review',
    snippet: 'Test drive and battery range specifications for the 2026 Jaguar electric luxury grand tourer.',
    contentType: 'web',
    publishedAt: '2026-11-12T00:00:00Z'
  },
  {
    url: 'https://en.wikipedia.org/wiki/Mercury_(planet)',
    title: 'Mercury (Planet) — Solar System Astronomy',
    snippet: 'Mercury is the smallest and innermost planet in the Solar System, orbiting the Sun in 88 Earth days.',
    contentType: 'web',
    publishedAt: '2026-05-10T00:00:00Z'
  },
  {
    url: 'https://chemistry.example.org/mercury-element-properties',
    title: 'Mercury (Hg) Chemical Element Properties & Safety',
    snippet: 'Elemental mercury (atomic number 80) is a liquid metal at room temperature with toxic vapor hazards.',
    contentType: 'web',
    publishedAt: '2026-05-15T00:00:00Z'
  },
  // Error code & exact-phrase targets
  {
    url: 'https://httpstatuses.example.org/429-too-many-requests',
    title: 'HTTP 429 Too Many Requests — Retry-After & Rate Limiting',
    snippet: 'HTTP status code 429 indicates rate limit exceeded; clients should honor Retry-After headers with exponential backoff.',
    contentType: 'docs',
    publishedAt: '2026-07-20T00:00:00Z'
  },
  {
    url: 'https://errors.example.org/econnrefused-127-0-0-1',
    title: 'Troubleshooting ECONNREFUSED 127.0.0.1 Connection Errors',
    snippet: 'ECONNREFUSED occurs when no service listens on the target port; verify server binding and firewall rules.',
    contentType: 'docs',
    publishedAt: '2026-08-09T00:00:00Z'
  },
  // Adversarial SEO Spam / Boilerplate Traps (should be filtered or heavily demoted)
  {
    url: 'https://buy-cheap-best-free-postgres-seo-farm.example.com/a/b/c/d/e/f/g/h/spam',
    title: 'PostgreSQL SQLite TypeScript Kubernetes Electron Free Download Buy Cheap',
    snippet: 'postgresql postgresql postgresql tsvector tsvector buy cheap online click here to claim free download',
    contentType: 'web',
    publishedAt: '2026-11-27T00:00:00Z'
  },
  {
    url: 'https://broken-portal.example.com/error',
    title: '404 Not Found — Access Denied',
    snippet: 'Just a moment... Enable JavaScript and cookies to continue.',
    contentType: 'web',
    publishedAt: '2026-11-27T00:00:00Z'
  }
];

function build110BenchmarkQueries(): BenchmarkQuery[] {
  const queries: BenchmarkQuery[] = [];
  const add = (category: BenchmarkCategory, query: string, mode: SearchMode | undefined, qrels: Record<string, 1 | 2>) => {
    queries.push({ id: `${category}-${queries.length + 1}`, category, query, mode, qrels });
  };

  // 1. Navigational (10)
  add('navigational', 'postgresql.org textsearch', 'web', { 'https://www.postgresql.org/docs/current/textsearch.html': 2 });
  add('navigational', 'sqlite fts5', 'web', { 'https://sqlite.org/fts5.html': 2 });
  add('navigational', 'electron security docs', 'web', { 'https://www.electronjs.org/docs/latest/tutorial/security': 2 });
  add('navigational', 'github ollama', 'web', { 'https://github.com/ollama/ollama': 2 });
  add('navigational', 'github typescript', 'web', { 'https://github.com/microsoft/TypeScript': 2 });
  add('navigational', 'owasp ssrf cheat sheet', 'web', { 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html': 2 });
  add('navigational', 'rfc 9309', 'web', { 'https://www.rfc-editor.org/rfc/rfc9309': 2 });
  add('navigational', 'react useEffect reference', 'web', { 'https://react.dev/reference/react/useEffect': 2 });
  add('navigational', 'python asyncio docs', 'web', { 'https://docs.python.org/3/library/asyncio.html': 2 });
  add('navigational', 'typescript decorators handbook', 'web', { 'https://www.typescriptlang.org/docs/handbook/decorators.html': 2 });

  // 2. Informational (10)
  add('informational', 'how does photosynthesis work in chloroplasts', 'web', { 'https://en.wikipedia.org/wiki/Photosynthesis': 2 });
  add('informational', 'what is quantum computing and entanglement', 'web', { 'https://en.wikipedia.org/wiki/Quantum_computing': 2 });
  add('informational', 'how does information retrieval measure ndcg', 'web', { 'https://en.wikipedia.org/wiki/Information_retrieval': 2, 'https://search-eng.example.org/bm25-vs-vector-search': 1 });
  add('informational', 'how does HTTP/3 QUIC eliminate head of line blocking', 'web', { 'https://ietf.org/topics/quic-http3-overview': 2 });
  add('informational', 'how does rust ownership prevent memory leaks', 'web', { 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html': 2 });
  add('informational', 'why use robots.txt allow disallow rules', 'web', { 'https://www.rfc-editor.org/rfc/rfc9309': 2 });
  add('informational', 'how does redis eviction policy allkeys-lru work', 'web', { 'https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/': 2 });
  add('informational', 'what causes toxic mercury vapor hazards', 'web', { 'https://chemistry.example.org/mercury-element-properties': 2 });
  add('informational', 'how long does planet mercury take to orbit the sun', 'web', { 'https://en.wikipedia.org/wiki/Mercury_(planet)': 2 });
  add('informational', 'how does kubernetes horizontal pod autoscaler scale replicas', 'web', { 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/': 2 });

  // 3. Exact-match (10)
  add('exact_match', '"GIN inverted indexes"', 'web', { 'https://www.postgresql.org/docs/current/textsearch.html': 2 });
  add('exact_match', '"contextIsolation"', 'docs', { 'https://www.electronjs.org/docs/latest/tutorial/security': 2 });
  add('exact_match', '"RFC1918 private IPs"', 'docs', { 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html': 2 });
  add('exact_match', '"timingSafeEqual"', 'docs', { 'https://nodejs.org/en/blog/release/2026-security-update': 2 });
  add('exact_match', '"ECONNREFUSED"', 'docs', { 'https://errors.example.org/econnrefused-127-0-0-1': 2 });
  add('exact_match', '"429 Too Many Requests"', 'docs', { 'https://httpstatuses.example.org/429-too-many-requests': 2 });
  add('exact_match', '"unique_ptr" "shared_ptr" c++', 'docs', { 'https://isocpp.org/wiki/faq/cpp11-library': 2 });
  add('exact_match', '"Reciprocal Rank Fusion"', 'web', { 'https://search-eng.example.org/bm25-vs-vector-search': 2 });
  add('exact_match', '"Porter stemming"', 'docs', { 'https://sqlite.org/fts5.html': 2 });
  add('exact_match', '"head-of-line blocking"', 'web', { 'https://ietf.org/topics/quic-http3-overview': 2 });

  // 4. Technical (10)
  add('technical', 'ssrf protection metadata 169.254.169.254 redirect check', 'docs', { 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html': 2 });
  add('technical', 'postgresql tsvector tsquery ts_rank_cd', 'docs', { 'https://www.postgresql.org/docs/current/textsearch.html': 2 });
  add('technical', 'sqlite fts5 virtual table bm25', 'docs', { 'https://sqlite.org/fts5.html': 2 });
  add('technical', 'kubernetes hpa cpu memory custom metrics', 'docs', { 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/': 2 });
  add('technical', 'redis ttl distributed caching memory optimization', 'docs', { 'https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/': 2 });
  add('technical', 'http 429 retry-after exponential backoff', 'docs', { 'https://httpstatuses.example.org/429-too-many-requests': 2 });
  add('technical', 'quic udp multiplexed streams tls 0-rtt', 'web', { 'https://ietf.org/topics/quic-http3-overview': 2 });
  add('technical', 'robots.txt user-agent longest prefix rfc 9309', 'docs', { 'https://www.rfc-editor.org/rfc/rfc9309': 2 });
  add('technical', 'ollama localhost 11434 chat completions', 'docs', { 'https://github.com/ollama/ollama': 2 });
  add('technical', 'electron ipc zod validation csp webcontentsview', 'docs', { 'https://www.electronjs.org/docs/latest/tutorial/security': 2 });

  // 5. Programming (10)
  add('programming', 'async/await promises javascript', 'docs', { 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await': 2 });
  add('programming', 'typescript class method decorators metadata', 'docs', { 'https://www.typescriptlang.org/docs/handbook/decorators.html': 2 });
  add('programming', 'react useEffect cleanup callback external system', 'docs', { 'https://react.dev/reference/react/useEffect': 2 });
  add('programming', 'rust move semantics borrow checker memory safety', 'docs', { 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html': 2 });
  add('programming', 'python asyncio coroutines event loop concurrent', 'docs', { 'https://docs.python.org/3/library/asyncio.html': 2 });
  add('programming', 'c++ raii smart pointers std::unique_ptr', 'docs', { 'https://isocpp.org/wiki/faq/cpp11-library': 2 });
  add('programming', 'node.js scrypt random salt key derivation', 'docs', { 'https://nodejs.org/en/blog/release/2026-security-update': 2 });
  add('programming', 'econnrefused 127.0.0.1 port firewall', 'docs', { 'https://errors.example.org/econnrefused-127-0-0-1': 2 });
  add('programming', 'typescript compiler superset javascript', 'docs', { 'https://github.com/microsoft/TypeScript': 2, 'https://www.typescriptlang.org/docs/handbook/decorators.html': 1 });
  add('programming', 'electron disable nodeIntegration contextIsolation', 'docs', { 'https://www.electronjs.org/docs/latest/tutorial/security': 2 });

  // 6. Comparison (10)
  add('comparison', 'postgresql vs sqlite fts5', 'research', { 'https://db-engines.example.org/postgres-vs-sqlite': 2, 'https://www.postgresql.org/docs/current/textsearch.html': 1, 'https://sqlite.org/fts5.html': 1 });
  add('comparison', 'react vs vue 2026', 'research', { 'https://webstack.example.org/react-vs-vue-2026': 2 });
  add('comparison', 'docker compose vs kubernetes', 'research', { 'https://orchestration.example.org/docker-compose-vs-kubernetes': 2, 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/': 1 });
  add('comparison', 'bm25 vs vector embeddings search', 'research', { 'https://search-eng.example.org/bm25-vs-vector-search': 2 });
  add('comparison', 'jwt vs session cookies security', 'research', { 'https://auth-guide.example.org/jwt-vs-session-cookies': 2 });
  add('comparison', 'difference between postgresql mvcc and sqlite wal', 'research', { 'https://db-engines.example.org/postgres-vs-sqlite': 2 });
  add('comparison', 'pros and cons of stateless jwt vs httponly sessions', 'research', { 'https://auth-guide.example.org/jwt-vs-session-cookies': 2 });
  add('comparison', 'compare keyword precision and semantic recall', 'research', { 'https://search-eng.example.org/bm25-vs-vector-search': 2 });
  add('comparison', 'react server components vs vue 3 reactivity', 'research', { 'https://webstack.example.org/react-vs-vue-2026': 2 });
  add('comparison', 'single-host compose alternatives to kubernetes', 'research', { 'https://orchestration.example.org/docker-compose-vs-kubernetes': 2 });

  // 7. Current events (10)
  add('current_events', 'latest 2026 node.js security release', 'news', { 'https://nodejs.org/en/blog/release/2026-security-update': 2 });
  add('current_events', 'latest browser privacy local ai standards 2026', 'news', { 'https://news.example.org/2026/11/ai-browser-privacy-standards': 2 });
  add('current_events', 'webgpu browser adoption today 2026', 'news', { 'https://news.example.org/2026/11/webgpu-adoption-report': 2 });
  add('current_events', '2026 jaguar electric gt review', 'news', { 'https://cars.example.org/jaguar-electric-gt-2026': 2 });
  add('current_events', 'recent 2026 react vs vue ecosystem update', 'news', { 'https://webstack.example.org/react-vs-vue-2026': 2 });
  add('current_events', 'latest ollama local inference runtime release', 'news', { 'https://github.com/ollama/ollama': 2 });
  add('current_events', 'november 2026 webgpu compute shaders news', 'news', { 'https://news.example.org/2026/11/webgpu-adoption-report': 2 });
  add('current_events', 'recent browser tab isolation privacy report 2026', 'news', { 'https://news.example.org/2026/11/ai-browser-privacy-standards': 2 });
  add('current_events', '2026 typescript github repository updates', 'news', { 'https://github.com/microsoft/TypeScript': 2 });
  add('current_events', 'node.js security release notes scrypt 2026', 'news', { 'https://nodejs.org/en/blog/release/2026-security-update': 2 });

  // 8. Ambiguous (10)
  add('ambiguous', 'jaguar animal habitat americas', 'web', { 'https://en.wikipedia.org/wiki/Jaguar': 2 });
  add('ambiguous', 'jaguar electric car range', 'web', { 'https://cars.example.org/jaguar-electric-gt-2026': 2 });
  add('ambiguous', 'mercury planet orbit sun', 'web', { 'https://en.wikipedia.org/wiki/Mercury_(planet)': 2 });
  add('ambiguous', 'mercury liquid metal element', 'web', { 'https://chemistry.example.org/mercury-element-properties': 2 });
  add('ambiguous', 'search ranking precision recall', 'web', { 'https://en.wikipedia.org/wiki/Information_retrieval': 2, 'https://search-eng.example.org/bm25-vs-vector-search': 1 });
  add('ambiguous', 'local model api localhost', 'web', { 'https://github.com/ollama/ollama': 2 });
  add('ambiguous', 'browser security policy', 'web', { 'https://www.electronjs.org/docs/latest/tutorial/security': 2, 'https://news.example.org/2026/11/ai-browser-privacy-standards': 1 });
  add('ambiguous', 'auth session cookie', 'web', { 'https://auth-guide.example.org/jwt-vs-session-cookies': 2 });
  add('ambiguous', 'containers autoscaling', 'web', { 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/': 2, 'https://orchestration.example.org/docker-compose-vs-kubernetes': 1 });
  add('ambiguous', 'rate limit retry', 'web', { 'https://httpstatuses.example.org/429-too-many-requests': 2 });

  // 9. Misspelled (10)
  add('misspelled', 'postgreql tsvector full text search', 'web', { 'https://www.postgresql.org/docs/current/textsearch.html': 2 });
  add('misspelled', 'kubernets horizontal pod autoscaler', 'web', { 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/': 2 });
  add('misspelled', 'electorn contextIsolation security', 'web', { 'https://www.electronjs.org/docs/latest/tutorial/security': 2 });
  add('misspelled', 'typscript decorators handbook', 'web', { 'https://www.typescriptlang.org/docs/handbook/decorators.html': 2 });
  add('misspelled', 'javscript async await promises', 'web', { 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await': 2 });
  add('misspelled', 'authentiction jwt session cookies', 'web', { 'https://auth-guide.example.org/jwt-vs-session-cookies': 2 });
  add('misspelled', 'pyhton asyncio event loop', 'web', { 'https://docs.python.org/3/library/asyncio.html': 2 });
  add('misspelled', 'documetation robots.txt rfc 9309', 'web', { 'https://www.rfc-editor.org/rfc/rfc9309': 2 });
  add('misspelled', 'quantm computing qubits entanglement', 'web', { 'https://en.wikipedia.org/wiki/Quantum_computing': 2 });
  add('misspelled', 'contaners docker compose scaling', 'web', { 'https://orchestration.example.org/docker-compose-vs-kubernetes': 2 });

  // 10. Long natural-language questions (10)
  add('long_nlq', 'how can I prevent server side request forgery when validating redirects and metadata ips', 'web', { 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html': 2 });
  add('long_nlq', 'why does http 3 over quic avoid tcp head of line blocking during packet loss', 'web', { 'https://ietf.org/topics/quic-http3-overview': 2 });
  add('long_nlq', 'what is the best way to optimize memory and eviction ttl policies in redis cache', 'web', { 'https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/memory-optimization/': 2 });
  add('long_nlq', 'how do I fix connection refused errors on localhost 127.0.0.1 when starting a server', 'web', { 'https://errors.example.org/econnrefused-127-0-0-1': 2 });
  add('long_nlq', 'should a desktop browser use sqlite fts5 locally or postgresql full text search in cloud', 'web', { 'https://db-engines.example.org/postgres-vs-sqlite': 2, 'https://sqlite.org/fts5.html': 1, 'https://www.postgresql.org/docs/current/textsearch.html': 1 });
  add('long_nlq', 'how does rust achieve memory safety without needing a garbage collector at runtime', 'web', { 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html': 2 });
  add('long_nlq', 'what security settings should be enabled for webcontentsview isolation in electron apps', 'web', { 'https://www.electronjs.org/docs/latest/tutorial/security': 2 });
  add('long_nlq', 'how should an api client handle 429 rate limits using retry after headers', 'web', { 'https://httpstatuses.example.org/429-too-many-requests': 2 });
  add('long_nlq', 'how do bm25 keyword retrieval and dense vector similarity work together in hybrid search', 'web', { 'https://search-eng.example.org/bm25-vs-vector-search': 2 });
  add('long_nlq', 'what are the trade offs between stateless jwt tokens and revocable session cookies', 'web', { 'https://auth-guide.example.org/jwt-vs-session-cookies': 2 });

  // 11. Entity & Product searches (10)
  add('entity_product', 'Ollama local LLM runtime', 'web', { 'https://github.com/ollama/ollama': 2 });
  add('entity_product', 'PostgreSQL GIN index', 'web', { 'https://www.postgresql.org/docs/current/textsearch.html': 2 });
  add('entity_product', 'SQLite FTS5 extension', 'web', { 'https://sqlite.org/fts5.html': 2 });
  add('entity_product', 'Kubernetes HPA', 'web', { 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/': 2 });
  add('entity_product', 'WebGPU compute shaders', 'web', { 'https://news.example.org/2026/11/webgpu-adoption-report': 2 });
  add('entity_product', 'Jaguar Electric GT', 'web', { 'https://cars.example.org/jaguar-electric-gt-2026': 2 });
  add('entity_product', 'OWASP SSRF Cheat Sheet', 'web', { 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html': 2 });
  add('entity_product', 'MDN Web Docs async await', 'web', { 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await': 2 });
  add('entity_product', 'Node.js 22 LTS scrypt', 'web', { 'https://nodejs.org/en/blog/release/2026-security-update': 2 });
  add('entity_product', 'Microsoft TypeScript GitHub', 'web', { 'https://github.com/microsoft/TypeScript': 2 });

  return queries;
}

export const BENCHMARK_QUERIES_110 = build110BenchmarkQueries();

function computeGradedNdcgAtK(rankedUrls: string[], qrels: Record<string, 1 | 2>, k = 10): number {
  const slice = rankedUrls.slice(0, k);
  let dcg = 0;
  slice.forEach((u, i) => {
    const rel = qrels[u] ?? 0;
    if (rel > 0) {
      dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
    }
  });
  const idealRels = Object.values(qrels).sort((a, b) => b - a).slice(0, k);
  let idcg = 0;
  idealRels.forEach((rel, i) => {
    idcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  });
  return idcg === 0 ? 0 : Number((dcg / idcg).toFixed(4));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(3));
}

/**
 * Legacy pre-upgrade baseline algorithm (reproduces the Phase-1 audit flaws):
 * - Naive binary word match without typo correction, exact-phrase, BM25, or spam filtering
 * - No www/http canonical deduplication
 * - No Stage-2 coverage/proximity reranking
 */
function runBaselineEngine(query: string, docs: BenchmarkDoc[]): { urls: string[]; rawCount: number; dedupedCount: number } {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const scored = docs
    .map((d) => {
      const hay = `${d.title} ${d.snippet}`.toLowerCase();
      const titleLower = d.title.toLowerCase();
      let hits = 0;
      let titleHits = 0;
      for (const t of tokens) {
        if (hay.includes(t)) hits += 1;
        if (titleLower.includes(t)) titleHits += 1;
      }
      const lex = tokens.length > 0 ? (hits / tokens.length) * 0.65 + (titleHits / tokens.length) * 0.35 : 0;
      const cleanUrl = d.url.split('?')[0];
      return { url: cleanUrl, domain: new URL(d.url).hostname, score: lex };
    })
    .filter((r) => r.score > 0.1)
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of scored) {
    if (!seen.has(s.url)) {
      seen.add(s.url);
      deduped.push(s.url);
    }
  }
  return { urls: deduped.slice(0, 10), rawCount: scored.length, dedupedCount: deduped.length };
}

function evaluateRun(
  queries: BenchmarkQuery[],
  runner: (q: BenchmarkQuery) => Promise<{ urls: string[]; duplicateRate: number; latencyMs: number }>
): Promise<{ summary: BenchmarkSummary; perCat: Record<BenchmarkCategory, { ndcg10: number; mrr: number }> }> {
  return (async () => {
    let p5Sum = 0;
    let r10Sum = 0;
    let ndcg10Sum = 0;
    let mrrSum = 0;
    let dupSum = 0;
    let divSum = 0;
    const latencies: number[] = [];
    const catMap = new Map<BenchmarkCategory, { count: number; ndcgSum: number; mrrSum: number }>();

    for (const q of queries) {
      const res = await runner(q);
      latencies.push(res.latencyMs);

      const relEntries = Object.entries(q.qrels);
      const relSet = new Set(relEntries.map(([u]) => sanitizeAndCanonicalizeUrl(u).canonicalUrl));
      const canonicalQrels: Record<string, 1 | 2> = {};
      for (const [u, grade] of relEntries) {
        canonicalQrels[sanitizeAndCanonicalizeUrl(u).canonicalUrl] = grade;
      }

      const top5 = res.urls.slice(0, 5);
      const top10 = res.urls.slice(0, 10);

      const hits5 = top5.filter((u) => relSet.has(u)).length;
      const hits10 = top10.filter((u) => relSet.has(u)).length;
      p5Sum += top5.length > 0 ? hits5 / top5.length : 0;
      r10Sum += relSet.size > 0 ? hits10 / relSet.size : 0;

      const ndcg = computeGradedNdcgAtK(top10, canonicalQrels, 10);
      ndcg10Sum += ndcg;

      const firstRelIdx = top10.findIndex((u) => relSet.has(u));
      const mrr = firstRelIdx >= 0 ? 1 / (firstRelIdx + 1) : 0;
      mrrSum += mrr;

      dupSum += res.duplicateRate;

      const uniqueHosts = new Set(
        top10.map((u) => {
          try {
            return new URL(u).hostname.replace(/^www\./, '');
          } catch {
            return u;
          }
        })
      );
      divSum += top10.length > 0 ? uniqueHosts.size / top10.length : 0;

      const prev = catMap.get(q.category) ?? { count: 0, ndcgSum: 0, mrrSum: 0 };
      prev.count += 1;
      prev.ndcgSum += ndcg;
      prev.mrrSum += mrr;
      catMap.set(q.category, prev);
    }

    const n = Math.max(1, queries.length);
    const sortedLat = [...latencies].sort((a, b) => a - b);
    const perCat = {} as Record<BenchmarkCategory, { ndcg10: number; mrr: number }>;
    for (const [cat, stats] of catMap.entries()) {
      perCat[cat] = {
        ndcg10: Number((stats.ndcgSum / stats.count).toFixed(4)),
        mrr: Number((stats.mrrSum / stats.count).toFixed(4))
      };
    }

    return {
      summary: {
        totalQueries: queries.length,
        categories: catMap.size,
        precisionAt5: Number((p5Sum / n).toFixed(4)),
        recallAt10: Number((r10Sum / n).toFixed(4)),
        ndcgAt10: Number((ndcg10Sum / n).toFixed(4)),
        mrr: Number((mrrSum / n).toFixed(4)),
        duplicateRate: Number((dupSum / n).toFixed(4)),
        sourceDiversity: Number((divSum / n).toFixed(4)),
        avgLatencyMs: Number((latencies.reduce((a, b) => a + b, 0) / n).toFixed(3)),
        p50LatencyMs: percentile(sortedLat, 50),
        p95LatencyMs: percentile(sortedLat, 95)
      },
      perCat
    };
  })();
}

export async function runComprehensiveSearchBenchmark(): Promise<BenchmarkComparisonReport> {
  const repo = new InMemoryCloudRepository();
  const qu = new QueryUnderstandingEngine();
  const ranking = new SearchRankingPipeline();

  for (const item of CORPUS_DOCS) {
    const check = sanitizeAndCanonicalizeUrl(item.url);
    const doc: LavrayIndexDocument = {
      id: createHash('sha1').update(item.url).digest('hex').slice(0, 16),
      url: item.url,
      canonicalUrl: item.url, // Preserve exact raw URL in repo so candidate pool tests dedup pipeline fairly
      title: item.title,
      mainContent: `${item.title}. ${item.snippet}`,
      snippet: item.snippet,
      headings: [item.title],
      language: 'en',
      sourceDomain: check.domain,
      contentType: item.contentType,
      contentHash: createHash('sha256').update(`${item.url}:${item.snippet}`).digest('hex'),
      authorityScore: 0.75,
      authorityMethod: 'benchmark_v1',
      publishedAt: item.publishedAt ?? null,
      crawledAt: Date.now(),
      indexVersion: 'v1',
      embedding: computeLocalEmbedding(`${item.title} ${item.snippet}`)
    };
    await repo.upsertLavrayIndexDocument(doc);
  }

  const baselineEval = await evaluateRun(BENCHMARK_QUERIES_110, async (q) => {
    const t0 = performance.now();
    const res = runBaselineEngine(q.query, CORPUS_DOCS);
    const duplicateRate = res.rawCount > 0 ? Math.max(0, (res.rawCount - res.dedupedCount) / res.rawCount) : 0;
    return { urls: res.urls, duplicateRate, latencyMs: performance.now() - t0 };
  });

  const improvedEval = await evaluateRun(BENCHMARK_QUERIES_110, async (q) => {
    const t0 = performance.now();
    const understanding = qu.analyzeDeterministic(q.query, q.mode);
    const retrievalQuery = understanding.normalizedQuery || q.query;
    const hits = await repo.searchLavrayIndex({
      query: retrievalQuery,
      queryEmbedding: computeLocalEmbedding(retrievalQuery),
      limit: 25
    });
    const rawCandidates: RawSearchCandidate[] = hits.map((h, idx) => ({
      title: h.document.title,
      url: h.document.url,
      snippet: h.document.snippet,
      sourceProvider: 'lavray_first_party_index',
      publishedAt: h.document.publishedAt ?? null,
      contentType: h.document.contentType,
      language: h.document.language,
      rawRank: idx + 1
    }));
    const stage1 = ranking.normalizeAndRank({ candidates: rawCandidates, understanding });
    const stage2 = await ranking.rerankCandidates(q.query, stage1.results, 200, understanding);
    const urls = stage2.results.slice(0, 10).map((r) => r.canonicalUrl);
    const duplicateRate =
      stage1.totalBeforeDedup > 0 ? stage1.duplicatesRemoved / stage1.totalBeforeDedup : 0;
    return { urls, duplicateRate, latencyMs: performance.now() - t0 };
  });

  const byCategory = {} as BenchmarkComparisonReport['byCategory'];
  for (const cat of Object.keys(improvedEval.perCat) as BenchmarkCategory[]) {
    const count = BENCHMARK_QUERIES_110.filter((q) => q.category === cat).length;
    byCategory[cat] = {
      queries: count,
      baselineNdcg10: baselineEval.perCat[cat]?.ndcg10 ?? 0,
      improvedNdcg10: improvedEval.perCat[cat]?.ndcg10 ?? 0,
      improvedMrr: improvedEval.perCat[cat]?.mrr ?? 0
    };
  }

  return {
    corpusSize: CORPUS_DOCS.length,
    queryCount: BENCHMARK_QUERIES_110.length,
    baseline: baselineEval.summary,
    improved: improvedEval.summary,
    deltas: {
      precisionAt5: Number((improvedEval.summary.precisionAt5 - baselineEval.summary.precisionAt5).toFixed(4)),
      recallAt10: Number((improvedEval.summary.recallAt10 - baselineEval.summary.recallAt10).toFixed(4)),
      ndcgAt10: Number((improvedEval.summary.ndcgAt10 - baselineEval.summary.ndcgAt10).toFixed(4)),
      mrr: Number((improvedEval.summary.mrr - baselineEval.summary.mrr).toFixed(4)),
      duplicateRate: Number((improvedEval.summary.duplicateRate - baselineEval.summary.duplicateRate).toFixed(4)),
      sourceDiversity: Number((improvedEval.summary.sourceDiversity - baselineEval.summary.sourceDiversity).toFixed(4))
    },
    byCategory
  };
}

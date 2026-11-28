# LAVRAY Intelligent Search Engine & Future Web Index Design

LAVRAY Search (`src/backend/modules/search/` + `src/main/cloud/cloud-client.ts`) is a **provider-independent, privacy-preserving hybrid search engine** that never fabricates citations and never sends private browsing tabs to external services.

---

## 1. Search Provider Abstraction (`SearchProvider`)

External SERP scraping in violation of provider terms is strictly prohibited. LAVRAY Search integrates via official APIs implementing `SearchProvider`:

| Provider ID | API | Auth Env Var | Notes & Rate/Terms Considerations |
| :--- | :--- | :--- | :--- |
| `brave` | Brave Search API v1 (`/res/v1/web/search`, `/news/search`) | `BRAVE_SEARCH_API_KEY` | Independent index, generous developer quotas; pay-per-1K requests pricing. |
| `google_cse` | Google Programmable Search JSON API | `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_CX` | 100 free queries/day; \$5 per 1K additional (up to 10K/day API cap). |
| `bing` | Bing Web Search API v7 | `BING_SEARCH_API_KEY` | Official Azure/Bing API endpoint where provisioned. |
| `lavray_knowledge` | LAVRAY Hybrid Knowledge Index | User JWT (`userId`, `profileId`) | Searches user-approved cloud bookmarks, notes, research reports, memory. |
| `local_*` (Desktop) | Local SQLite bookmarks/memory/tabs | Desktop IPC | Always available offline (`sourceMode: 'local_fallback'`). |
| `mock_search` | `MockSearchProvider` | `LAVRAY_ALLOW_MOCK_SEARCH=true` | Disabled & rejected whenever `NODE_ENV=production`. Explicitly flagged `isMock: true`. |

---

## 2. Query Understanding, Retrieval, Deduplication & Ranking Pipeline

1. **Query Understanding (`query-understanding.ts`)**:
   - Works deterministically without an LLM: classifies intent (`informational`, `navigational`, `comparative`, `temporal_news`, `technical_docs`, `personal_knowledge`), detects temporal constraints (`latest`, years `20xx`), expands domain synonyms, extracts entities, detects language, and recommends a `SearchMode`.
   - Optional fast-tier LLM query rewriting runs only when configured and safe.
2. **Parallel Retrieval (`search-orchestrator.ts`)**:
   - Fans out concurrently with per-provider timeouts (`withProviderTimeout`) across configured web APIs, authorized non-private tabs, and user-approved hybrid knowledge.
   - If one provider times out or returns 5xx/429, remaining providers still return results cleanly and errors are surfaced transparently in `providerErrors`.
3. **Normalization & Safety Filtering (`ranking.ts`)**:
   - Rejects malformed URLs, non-HTTP(S) schemes (`javascript:`, `file:`, `data:`), `localhost`, `.internal`, cloud metadata hosts, and raw private/reserved IPv4/IPv6 addresses.
   - Strips UTM/tracking parameters (`utm_*`, `fbclid`, `gclid`) into `canonicalUrl`.
4. **Deduplication & Hybrid Deterministic Ranking (`ranking.ts`)**:
   - Merges canonical URL collisions and near-duplicate title+snippet pairs (`Jaccard >= 0.78`), incrementing `clusterCount`.
   - Computes weighted deterministic score:
     - `lexical` (token + exact title hit overlap, weight `0.34`)
     - `semantic` (64-dim hashed trigram cosine similarity, weight `0.26`)
     - `intent` (mode/content-type alignment, weight `0.14`)
     - `authority` (domain trust tier + HTTPS, weight `0.11`)
     - `freshness` (time decay weighted higher for temporal queries, weight `0.08`)
     - `prior` (upstream rank prior, weight `0.07`)
   - Applies domain diversity multiplier so single hosts do not crowd top positions.
5. **Optional Bounded Reranker**:
   - Operates strictly on top 15 retrieved candidates within a 250ms budget (exact phrase bonus + fine vector similarity). Never invents documents.

---

## 3. AI Answer Pipeline with Verified Citations (`citation-pipeline.ts`)

1. Collects top 4 candidates (using authorized open tab text or SSRF-safe `ResearchExtractorService.fetchAndExtract`, falling back to retrieved snippet if live fetch is unavailable).
2. Chunks text into bounded `SearchEvidencePassage[]` and selects top 8 by vector relevance.
3. Wraps every excerpt using `InjectionGuard.wrapUntrustedContent` to isolate prompt injection attempts inside web pages.
4. Invokes Gemini / configured AI provider with a strict JSON schema requiring `sufficientEvidence`, `claims[]` (`fact` vs `interpretation`), and `contradictions[]`.
5. **Anti-Hallucination Citation Verification**:
   - Drops any claim referencing a `sourceUrl` not present in the inspected URL map.
   - Verifies whether `supportingQuote` matches inspected page text (`verifiedAgainstSource`).
   - Returns `status: 'insufficient_evidence'` if retrieved evidence does not support claims.
   - Conventional search results remain 100% functional even if AI synthesis fails or is unconfigured.

---

## 4. Future Own Web Index Architecture (Phase 7 Design)

LAVRAY currently does **not** deploy an internet-wide crawler. Instead, a policy-compliant prototype adapter (`src/backend/modules/search/first-party-index-provider.ts`) implements `SearchProvider` so an LAVRAY-owned index can be phased in later:

1. **URL Discovery**: Opt-in anonymized top visited domains, public sitemaps (`sitemap.xml`), curated technical doc registries (MDN, PostgreSQL, Kubernetes, RFCs), and approved user-contributed public research sources.
2. **Crawl Scheduling & Budgets**: Priority queue segmented by `(domain, freshness_score)` with strict daily domain budgets and exponential backoff on 429/5xx.
3. **Politeness & Compliance**: Mandatory `robots.txt` cache + parser per host (honoring `Disallow` & `Crawl-delay`), minimum 1–5s per-domain rate limiting, transparent `LavrayBot` User-Agent with opt-out contact URL.
4. **SSRF-Safe Fetching & Extraction**: Dedicated egress-isolated crawler VPC blocking all RFC1918/loopback/metadata IPs and DNS rebinding, size-capped HTTP streaming, `@mozilla/readability` canonical HTML extraction.
5. **Canonicalization & Deduplication**: `<link rel="canonical">` resolution, SimHash/MinHash near-duplicate fingerprinting before indexing.
6. **Freshness & Abuse/Copyright Controls**: Conditional `ETag`/`If-Modified-Since` re-crawls, `noindex`/`noarchive` meta directives respected, automated DMCA/opt-out blocklist, bounded snippet retention.

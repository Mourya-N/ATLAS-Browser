# Atlas Cloud Backend API v1 Reference

Base URL (local development): `http://127.0.0.1:48080`
Every response includes `X-Request-Id` and `X-Atlas-API-Version: v1`. Protected endpoints require `Authorization: Bearer <accessToken>`.

---

## Health & Observability

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health`, `/api/v1/health` | Public | DB connectivity, storage mode (`postgres`/`in_memory`), AI availability, search provider health. |
| `GET` | `/metrics` | Public | Prometheus exposition metrics (`atlas_http_requests_total`, `atlas_http_latency_p95_ms`, `atlas_search_total`, `atlas_ai_tokens_total`, `atlas_worker_queue_depth`). |
| `GET` | `/api/v1/observability/metrics` | Public | Structured JSON observability snapshot. |

## Identity & Consent

| Method | Path | Auth | Body / Behavior |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Public | `{ email, password (min 8), displayName?, deviceName?, platform?, appVersion? }` -> `201` `{ user, profile, accessToken, refreshToken, expiresAt }`. |
| `POST` | `/api/v1/auth/login` | Public | `{ email, password, deviceName?, ... }` -> `200` session bundle (`scrypt` verification). |
| `POST` | `/api/v1/auth/refresh` | Public | `{ refreshToken }` -> rotates refresh token and returns fresh access + refresh tokens. |
| `POST` | `/api/v1/auth/logout` | Public | `{ refreshToken? }` -> revokes stored refresh token hash. |
| `GET` | `/api/v1/profile` | JWT | Returns authenticated user's active profile and privacy consent flags. |
| `PUT` | `/api/v1/profile/consent` | JWT | Updates granular boolean flags (`syncBookmarks`, `syncNotes`, `syncResearch`, `syncMemory`, `syncSearchHistory`, `allowCloudSearch`, `allowCloudAi`). |
| `GET` | `/api/v1/account/export` | JWT | Exports all cloud records belonging to the user in JSON. |
| `DELETE` | `/api/v1/account` | JWT | Cascade deletes user, profiles, devices, tokens, bookmarks, notes, research, memory, and hybrid index entries. |

## Search & Research Extraction

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/search` | Optional JWT | `{ query, mode?, filters?, authorizedTabs?, isPrivateSession? }`. Executes query understanding, parallel search, dedup, hybrid ranking, optional reranking, and verified AI citations. |
| `POST` | `/api/v1/research/extract` | JWT | `{ url }`. Fetches & extracts clean readable article content strictly through `SsrfGuard`. Blocks private/loopback/metadata IPs and DNS rebinding. |

## Consent-Gated User Data, Knowledge & Jobs

| Method | Path | Consent Required | Description |
| :--- | :--- | :--- | :--- |
| `GET/POST/DELETE` | `/api/v1/userdata/bookmarks` | `syncBookmarks` | Sync/list/delete non-private bookmarks + auto-index into `hybrid_index_documents`. |
| `GET/POST` | `/api/v1/userdata/notes` | `syncNotes` | Save/list notes (secret-filtered + hybrid-indexed; rejects `isPrivate: true`). |
| `GET` | `/api/v1/userdata/search-history` | `syncSearchHistory` | Lists recorded cloud search history when user opted in. |
| `POST` | `/api/v1/knowledge/search` | JWT | Hybrid keyword (`tsvector`) + vector cosine search across profile's knowledge index. |
| `POST` | `/api/v1/jobs` | JWT | Enqueues async background worker job (`research_job`, `page_extract`, `reindex_knowledge`, `embedding_backfill`). |
| `GET` | `/api/v1/jobs/stats` | JWT | Returns queue depth (`queued`, `running`, `completed`, `failed`, `deadLetter`). |

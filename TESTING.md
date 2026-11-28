# Testing & Evaluation

LAVRAY Browser uses Vitest executed under Electron's Node ABI (`ELECTRON_RUN_AS_NODE=1`) so native `better-sqlite3` bindings match the runtime binary identically.

## Suites

1. **Unit Tests (`tests/unit/`)**:
   - `security-and-validation.test.ts`: Permission tiers, domain rules, rule expiration, kill switch, prompt injection guard, secret vault encryption/redaction, IPC sender & Zod validation.
   - `agent-core.test.ts`: Tool registry validation, planner, cost/budget tracker, evidence verifier, loop/recovery monitor, context compaction, structured extraction validation & CSV export.
   - `platform-services.test.ts`: Memory service & secret filtering, skill recording/replay/fallback, job scheduler & sensitive-job pausing, ad blocker classification, Readability extraction, navigation/omnibox resolution.
2. **Integration Tests (`tests/integration/persistence-mcp-session.test.ts`)**:
   - SQLite migrations & integrity check, private-tab exclusion in session restore, live HTTP `LocalMcpServer` auth/token rotation/allowlist/rate-limiting, download uniqueness & safety classification, run & cost aggregation.
3. **Evaluation Harness (`tests/eval/agent-evaluation.test.ts`)**:
   - Runs 27 deterministic scenarios against a live local HTTP fixture server (`tests/fixtures/eval-server.ts`) and measures task success rate, tool accuracy, recovery success rate, safety violations, average steps, latency, and token usage.

## Commands

```bash
npm run test:unit
npm run test:integration
npm run test:eval
npm test
```

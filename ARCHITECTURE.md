# Atlas Browser — System Architecture

> **"Browse normally. Delegate intelligently. Stay in control."**

Atlas Browser is a production-oriented, AI-native desktop web browser built on Electron (`WebContentsView`), TypeScript (strict), React, Vite, Tailwind CSS, Zustand, SQLite (`better-sqlite3`), and Chrome DevTools Protocol (`webContents.debugger`).

---

## 1. Multi-Process Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ELECTRON MAIN PROCESS                          │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │ Window & View    │  │ Browser Services │  │ Persistence & Secrets │  │
│  │ Lifecycle        │  │ - History        │  │ - SQLite (Migrations) │  │
│  │ - TabManager     │  │ - Bookmarks      │  │ - safeStorage Vault   │  │
│  │ - WebContentsView│  │ - Downloads      │  │ - Session Restore     │  │
│  │ - PrivateSession │  │ - AdBlocker      │  │ - Screenshot Store    │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬────────────┘  │
│           │                     │                       │               │
│  ┌────────▼─────────────────────▼───────────────────────▼────────────┐  │
│  │                 CENTRAL SECURITY & PERMISSION GATE                 │  │
│  │  - IPC Sender/Schema Validation (Zod)                              │  │
│  │  - Permission Tiers (Read-Only / Interact / Sensitive)             │  │
│  │  - Domain Rules (Allow / Deny / Read-Only / Expiry)                │  │
│  │  - Prompt-Injection Advisory Detector                              │  │
│  │  - Global Kill Switch (LLM-Independent)                            │  │
│  │  - Audit Logger (Secret Redaction)                                 │  │
│  └────────┬─────────────────────┬───────────────────────┬────────────┘  │
│           │                     │                       │               │
│  ┌────────▼─────────┐  ┌────────▼─────────┐  ┌──────────▼────────────┐  │
│  │ Agent Core       │  │ Perception & CDP │  │ Autonomy & Platform   │  │
│  │ - Planner        │  │ - CDPManager     │  │ - Multi-Agent Orch.   │  │
│  │ - Executor       │  │ - AXTree         │  │ - Skills Record/Replay│  │
│  │ - Verifier       │  │ - DOM Snapshot   │  │ - Local Memory        │  │
│  │ - ContextManager │  │ - Vision/SoM     │  │ - Job Scheduler       │  │
│  │ - ToolRegistry   │  │ - Page Diffs     │  │ - Local MCP Server    │  │
│  │ - GeminiProvider │  │ - Extraction     │  │ - Cost & Budget Ctrl  │  │
│  └──────────────────┘  └──────────────────┘  └───────────────────────┘  │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ Typed Preload Bridge (contextBridge)
┌───────────────────────────────────▼─────────────────────────────────────┐
│                      RENDERER PROCESS (UI SHELL)                        │
│  - Tab Strip (Horizontal & Vertical), Tab Search, Tab Groups            │
│  - Address Bar, Omnibox Suggestions, Security Badge, Browser Controls   │
│  - Agent Side Panel (Ask / Assist / Agent / Takeover, Timeline, Voice)  │
│  - Confirmation Modals, Human-in-the-Loop Takeover Banner               │
│  - Reading Mode Overlay, Selection Action Overlay, Find-in-Page Bar     │
│  - Management Views: History, Bookmarks, Downloads, Skills, Memory,     │
│    Runs & Replay Viewer, Observability & Cost Dashboard, Settings, MCP  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │ Isolated WebContentsView(s)
┌───────────────────────────────────▼─────────────────────────────────────┐
│                   UNTRUSTED REMOTE WEB CONTENT                          │
│  - contextIsolation: true, nodeIntegration: false, sandbox: true        │
│  - Zero access to IPC, SQLite, safeStorage, Node, or local files        │
│  - Private windows use `persist:atlas-private-<id>` / in-memory partition│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Layout

```
atlas-browser/
├── src/
│   ├── main/
│   │   ├── index.ts                 # App entry, lifecycle, shortcuts, CSP, protocols
│   │   ├── window-manager.ts        # BrowserWindow + WebContentsView layout manager
│   │   ├── browser/
│   │   │   ├── tab-manager.ts       # Tabs, groups, pinning, mute, crash recovery, closed tabs
│   │   │   ├── navigation.ts        # URL/search resolution, errors, redirects
│   │   │   ├── session-restore.ts   # Crash-safe tab/window state snapshot & restore
│   │   │   ├── private-session.ts   # Ephemeral isolated partition management
│   │   │   ├── download-manager.ts  # Downloads, pause/resume/cancel, safety prompts
│   │   │   ├── ad-blocker.ts        # webRequest domain/pattern blocklists & allowlists
│   │   │   └── reader-extractor.ts  # Article content extraction for Reading Mode
│   │   ├── db/
│   │   │   ├── database.ts          # better-sqlite3 singleton, pragmas, transactions
│   │   │   ├── migrations/          # Versioned SQL migrations (001_initial.sql, ...)
│   │   │   └── repositories/        # Typed prepared-statement DAOs per domain
│   │   ├── security/
│   │   │   ├── secrets.ts           # Electron safeStorage vault + log redaction
│   │   │   ├── ipc-validator.ts     # Sender URL/frame validation & Zod schemas
│   │   │   ├── permission-gate.ts   # Tiers, domain rules, interactive confirmations
│   │   │   ├── injection-guard.ts   # Prompt-injection pattern detection & isolation
│   │   │   ├── kill-switch.ts       # Immediate LLM-independent emergency stop
│   │   │   └── audit-logger.ts      # Structured audit trail & retention policy
│   │   ├── cdp/
│   │   │   ├── cdp-manager.ts       # webContents.debugger lifecycle & command queue
│   │   │   ├── perception.ts        # AXTree, DOM snapshot, SoM screenshot, page text
│   │   │   └── element-resolver.ts  # Session-scoped IDs, visibility & overlay checks
│   │   ├── agent/
│   │   │   ├── providers/           # ModelProvider interface + GeminiProvider + MockProvider
│   │   │   ├── tool-registry.ts     # Typed schemas, permission tiers, validation
│   │   │   ├── tools/               # Navigation, interaction, extraction, tab tools
│   │   │   ├── planner.ts           # Goal decomposition & subgoal strategy
│   │   │   ├── executor.ts          # Single-tool step execution & diff capture
│   │   │   ├── verifier.ts          # Evidence-based subgoal verification
│   │   │   ├── context-manager.ts   # Token budgets, compaction, evidence dedup
│   │   │   ├── recovery.ts          # Loop/stuck detection, fallback, backtracking
│   │   │   ├── orchestrator.ts      # Main execution loop + multi-agent parallel runner
│   │   │   ├── extraction-engine.ts # JSON Schema validation, retry, CSV/JSON export
│   │   │   └── cost-tracker.ts      # Token accounting, model pricing table, limits
│   │   ├── skills/
│   │   │   ├── skill-recorder.ts    # Convert verified runs into versioned skills
│   │   │   └── skill-runner.ts      # Deterministic-first replay with LLM fallback
│   │   ├── memory/
│   │   │   └── memory-service.ts    # Local semantic/TF-IDF memory + secret filter
│   │   ├── scheduler/
│   │   │   └── job-scheduler.ts     # Persistent cron/interval/one-shot skill runner
│   │   ├── mcp/
│   │   │   └── mcp-server.ts        # Localhost HTTP/JSON-RPC MCP server + token auth
│   │   └── ipc/
│   │       └── register-handlers.ts # Validated IPC handlers bridging main & UI
│   ├── preload/
│   │   ├── ui-preload.ts            # Minimal typed contextBridge for browser UI shell
│   │   └── content-preload.ts       # Minimal selection/context-menu reporter (no privileges)
│   ├── renderer/
│   │   ├── index.html               # Strict CSP HTML shell
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── store/                   # Zustand slices (browser, agent, ui, settings)
│   │   ├── components/              # Chrome, Tabs, Omnibox, AgentPanel, Modals, Views
│   │   └── styles/                  # Tailwind CSS + design tokens (light/dark/system)
│   └── shared/
│       ├── types.ts                 # Shared domain types across main/preload/renderer
│       ├── ipc-channels.ts          # Channel constants & Zod payload schemas
│       └── pricing.ts               # Configurable model pricing table
├── tests/
│   ├── unit/                        # Vitest unit tests
│   ├── integration/                 # SQLite, IPC, CDP/mocked Electron integration tests
│   ├── eval/                        # 20+ deterministic agent evaluation tasks + local fixtures
│   └── fixtures/                    # Local HTML test pages for deterministic testing
├── docs/                            # AGENT.md, TOOLS.md, PERMISSIONS.md, MEMORY.md, etc.
├── electron.vite.config.ts / vite.config.ts
├── tsconfig.json
├── package.json
└── electron-builder.yml
```

---

## 3. Security Model & Boundaries

1. **Process & Origin Isolation**:
   - The UI renderer loads from a local `app://` or `file://` origin with strict CSP (`default-src 'self'`).
   - Remote pages always load inside separate `WebContentsView` instances with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`.
   - `ipcMain` validates `event.sender` and `event.senderFrame` so only the trusted UI `webContents` can invoke privileged browser/agent IPC channels.
   - The content preload only forwards read-only selection text events via a single validated channel; it exposes no Node, filesystem, or agent control APIs.
2. **Permission Gate**:
   - Every tool declares a tier: `read_only`, `interact`, or `sensitive`.
   - Before execution, `PermissionGate` checks: kill switch status → domain allow/deny/read-only rules (with expiry) → agent mode (`ask` / `assist` / `agent` / `takeover`) → tool tier → interactive confirmation modal for `sensitive` actions (or all actions in `assist` mode).
3. **Untrusted Content Isolation**:
   - Page DOM/AXTree/text is tagged as `UNTRUSTED_PAGE_CONTENT` inside structured prompts and scanned by `InjectionGuard` for instruction-like payloads (e.g., hidden text, `"ignore previous instructions"`, `"exfiltrate"`).
   - Advisory warnings appear in the timeline, while actual safety is enforced deterministically by `PermissionGate` and `ToolRegistry`.
4. **Secret Protection**:
   - API keys (Gemini, custom providers) and MCP auth tokens are encrypted at rest via Electron `safeStorage` (with explicit fallback indicator only when OS keychain is unavailable).
   - Audit logs, memory records, and renderer state never receive raw secrets; `redactSecrets()` masks API keys, bearer tokens, and password-field inputs.

---

## 4. Persistence & Storage

- SQLite database stored in `app.getPath('userData')/atlas.db` with `WAL` mode and `foreign_keys = ON`.
- Screenshots stored on disk under `app.getPath('userData')/screenshots/<runId>/<stepId>.png` (never stored as BLOBs in SQLite) with configurable retention cleanup.
- Private windows use ephemeral in-memory Electron sessions (`session.fromPartition('atlas-private-' + uuid)` without `persist:`) and pass `isPrivate: true` so History, Session Restore, Memory, and Screenshot persistence are bypassed completely.

---

## 5. Agent Core Loop (Planner → Executor → Verifier)

1. **Receive Goal** → Parse slash commands or natural language; check kill switch & budgets.
2. **Context & Memory Retrieval** → Load relevant local memory (excluding private mode) and current tab summary within token budget.
3. **Planner** → Decompose goal into ordered subgoals with explicit verification criteria and complexity/parallelism assessment.
4. **Executor + Perception**:
   - Choose cheapest sufficient perception modality: AXTree → DOM interactive map → readable text → SoM annotated screenshot.
   - Select one schema-validated tool call.
   - Pass through `PermissionGate` (pauses for user confirmation or HITL CAPTCHA/login takeover when triggered).
   - Execute via `CDPManager` / Browser services; compute structured page diff.
5. **Verifier** → Compare expected subgoal outcome against observed page state/diff. Trigger retry, selector/AX/vision fallback, loop-detection re-plan, or subgoal completion.
6. **Persist & Audit** → Record step, cost, audit event, and optionally convert successful runs into reusable Skills.

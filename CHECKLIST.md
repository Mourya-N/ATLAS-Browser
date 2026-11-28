# LAVRAY Browser — Implementation Checklist

## Stage 1 — Foundation
- [x] `package.json`, `tsconfig.json`, TypeScript strict mode, Vite + Electron build setup
- [x] Shared types, IPC channel contracts, Zod schemas, pricing table
- [x] SQLite database + versioned migrations + repositories
- [x] `safeStorage` secret manager & redaction utilities
- [x] Electron main window, `WebContentsView` host, strict preload bridges
- [x] React + Tailwind + Zustand UI shell (Light/Dark/System themes)

## Stage 2 — Browser Engine
- [x] `TabManager`: create, close, reorder, duplicate, pin, mute, rename, groups, crash recovery, closed-tab stack, vertical tabs, tab search
- [x] `NavigationService`: URL/search engine parsing, redirects, error page, omnibox suggestions (history/bookmarks/URL)
- [x] Browser controls: back, forward, reload, stop, home, zoom, fullscreen, print, view source, DevTools, find-in-page, keyboard shortcuts
- [x] History & Bookmarks persistence + management UI
- [x] Crash-safe Session Restore (tabs, groups, pinned tabs, window bounds)

## Stage 3 — Agent Foundation
- [x] `ModelProvider` interface + `GeminiProvider` (REST with function calling, structured output, vision, SSE streaming) + `MockProvider`
- [x] `CDPManager` via `webContents.debugger`
- [x] Typed `ToolRegistry` & full suite of required + extended tools
- [x] Planner → Executor → Verifier execution loop with configurable limits
- [x] Integrated Agent Side Panel (Ask / Assist / Agent / Takeover modes, live timeline, controls)

## Stage 4 — Perception & Context
- [x] Accessibility tree inspection
- [x] DOM interactive element inspection (Shadow DOM, iframes, dynamic DOM)
- [x] Screenshot capture with Set-of-Marks (SoM) bounding boxes
- [x] Readable text & selected text extraction
- [x] Session-scoped `ElementResolver` (visibility, interactability, overlay checks)
- [x] Page diff calculation & `ContextManager` (token estimation, budgeting, compaction, dedup)

## Stage 5 — Safety & Security
- [x] Permission tiers (`read_only`, `interact`, `sensitive`)
- [x] Domain rules (allow/deny/read-only/interact, expiration, revocation)
- [x] `InjectionGuard` (untrusted content isolation + advisory detection)
- [x] Interactive `ConfirmationDialog` with target/data/consequence/reversibility
- [x] Global Kill Switch (hotkey + UI button, disconnects CDP, stops all agents)
- [x] Comprehensive `AuditLogger` with export, search, delete, secret redaction

## Stage 6 — Browser Completeness
- [x] `DownloadManager` (progress, pause/resume/cancel, open, reveal, sensitive path/file approval)
- [x] Private Browsing windows with isolated non-persistent sessions
- [x] Real Reading Mode (`@mozilla/readability`, author/date, font/theme/width, progress)
- [x] Network-level Ad & Tracker Blocker (`webRequest`, blocklists, per-site toggle, counter)
- [x] Browser Settings UI

## Stage 7 — Skills, Memory, Extraction & Replay
- [x] Record & Replay Skills engine (parameterized, dynamic targeting, verification, fallback)
- [x] Skills Library UI (CRUD, duplicate, import/export JSON, history, success rate)
- [x] Local Long-Term Memory (categories, TF-IDF retrieval, secret filter, CRUD/export)
- [x] Structured Extraction Engine (JSON Schema validation, retries, evidence, JSON/CSV export)
- [x] Run History & Step-by-Step Replay Viewer (screenshots, diffs, safe non-sensitive replay)

## Stage 8 — Advanced Autonomy
- [x] Multi-Agent Orchestrator (parallel sub-agents, isolated contexts/tabs, merge/conflict resolution, cancellation)
- [x] Self-Healing & Recovery (selector/AX/vision fallback, backtracking, loop/stuck detection)
- [x] Persistent Job Scheduler (one-time, daily, weekly, cron, timezone, permission-safe, notifications)
- [x] Human-in-the-Loop (CAPTCHA/login/payment pause, takeover, re-observe)
- [x] Voice input (Web Speech API with feature detection) & Slash commands (`/summarize`, `/extract`, `/compare`, `/skill`, `/research`, `/stop`, `/pause`, `/resume`, `/help`)
- [x] Page-level Context Menu & Selection Action Overlay

## Stage 9 — Integrations & Observability
- [x] Localhost MCP-style Tool Server (disabled by default, token auth + rotation, allowlist, rate limit, audit, UI)
- [x] Cost & Token Management (tracking, pricing table, per-run/daily budgets, auto-stop)
- [x] Observability Dashboard

## Stage 10 — Testing, Evaluation, Docs & Packaging
- [x] Unit tests (16 tests across 3 files)
- [x] Integration tests (4 tests covering SQLite, session isolation, downloads, MCP auth/rate-limit)
- [x] Evaluation harness (27 deterministic browser-agent scenarios)
- [x] Complete documentation (`README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `TESTING.md`, `docs/*.md`)
- [x] Build & `electron-builder` packaging config & verification

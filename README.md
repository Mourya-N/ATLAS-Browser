# LAVRAY Browser

> **"Browse normally. Delegate intelligently. Stay in control."**

LAVRAY Browser is an AI-native desktop web browser built with Electron (`WebContentsView`), TypeScript (strict), React, Tailwind CSS, Zustand, SQLite (`better-sqlite3`), and Chrome DevTools Protocol (`webContents.debugger`).

---

## Core Capabilities

- **Full Desktop Browser**: Multi-tab `WebContentsView` architecture, horizontal & vertical tabs, tab groups, pinning, muting, renaming, duplicate, closed-tab restore, tab search, omnibox with history/bookmark/search suggestions, HTTPS security indicator, zoom, find-in-page, print, DevTools, view source, real Readability-based Reading Mode, crash-safe Session Restore, isolated Private Windows, Download Manager with safety checks, and `webRequest`-based Ad & Tracker Blocker.
- **Autonomous Browser Agent (Planner → Executor → Verifier)**: Operates real browser tabs via CDP (`webContents.debugger`), Accessibility Tree, DOM (including Shadow DOM & same-origin iframes), and Set-of-Marks screenshots.
- **Interaction Modes**: `Ask`, `Assist`, `Agent`, and `Takeover`.
- **Multi-Agent Parallel Research**: Decomposes complex tasks across isolated sub-agents and tabs, merges findings, and cites sources.
- **Skills (Record & Replay)**: Captures verified agent runs as parameterized, versioned JSON workflows with deterministic-first replay and fallback recovery.
- **Local Memory & Structured Extraction**: TF-IDF/domain-weighted local memory (with strict secret filtering) and Ajv JSON Schema-validated extraction with JSON/CSV export.
- **Persistent Scheduler & Local MCP Server**: Cron/daily/weekly/one-time/event skill runner and localhost-only Bearer-authenticated MCP server (disabled by default).
- **Safety & Observability**: Permission tiers (`read_only`, `interact`, `sensitive`), domain rules, interactive confirmation modal, prompt-injection detection & untrusted-content isolation, global emergency Kill Switch (`Cmd/Ctrl+Shift+Esc`), `safeStorage` API key encryption, step-by-step Replay Viewer, Audit Log, and Cost/Budget Dashboard.

---

## Prerequisites

- **Node.js**: v20.x (tested on `v20.19.6`)
- **npm**: v10.x
- **macOS / Windows / Linux** native build tools for `better-sqlite3` (Xcode Command Line Tools on macOS)

## Setup & Development

```bash
# 1. Install dependencies
npm install

# 2. Rebuild native better-sqlite3 for Electron's Node ABI
npm run rebuild

# 3. Typecheck (strict) & build
npm run typecheck
npm run build

# 4. Run in development mode (Vite HMR + Electron)
npm run dev

# 5. Launch production build
npm start
```

## API Key Configuration

1. Open **Menu → Settings** inside LAVRAY Browser (or set `GEMINI_API_KEY` in the environment for CLI/development).
2. Enter your Gemini API key under **AI Provider & Encrypted Key Storage**.
3. LAVRAY encrypts the key using Electron `safeStorage` (`lavray-secrets.enc` in `userData`) and never writes it to `localStorage`, cookies, logs, or plaintext config.

## Testing & Packaging

```bash
# Run unit, integration, and 27-scenario evaluation suite
npm test

# Individual suites
npm run test:unit
npm run test:integration
npm run test:eval

# Package desktop application
npm run package   # unpacked directory in release/
npm run dist      # platform installer (dmg / nsis / AppImage)
```

## Documentation Index

- [ARCHITECTURE.md](ARCHITECTURE.md) — Multi-process architecture & data flow
- [SECURITY.md](SECURITY.md) — Threat model, IPC hardening, permissions, secrets
- [TESTING.md](TESTING.md) — Test strategy & evaluation harness
- [docs/AGENT.md](docs/AGENT.md) — Planner → Executor → Verifier & multi-agent loop
- [docs/TOOLS.md](docs/TOOLS.md) — Typed tool registry & CDP perception
- [docs/PERMISSIONS.md](docs/PERMISSIONS.md) — Permission tiers, domain rules & HITL
- [docs/MEMORY.md](docs/MEMORY.md) — Local memory categories, retrieval & secret guard
- [docs/SKILLS.md](docs/SKILLS.md) — Record/replay JSON schema & scheduler
- [docs/MCP.md](docs/MCP.md) — Localhost MCP server protocol & authentication
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Packaging for macOS, Windows, and Linux

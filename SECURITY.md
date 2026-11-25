# Security Architecture

Atlas Browser treats every remote website as **untrusted** and enforces defense-in-depth across Electron process boundaries, IPC, agent tooling, and secret storage.

## 1. Electron Process & Browser Hardening

- **UI Shell Window**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, strict CSP (`default-src 'self'`), navigation locked to `file://` (or local dev server during `npm run dev`), `setWindowOpenHandler` denied.
- **WebContentsView Tabs**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, and an isolated `content-preload.ts` that exposes zero globals and only forwards text selection coordinates.
- **IPC Validation (`src/main/security/ipc-validator.ts`)**: Every privileged `ipcMain.handle` verifies `event.sender.id` against active trusted UI `BrowserWindow` instances, validates `senderFrame.url`, and validates payloads using Zod schemas (`src/shared/ipc-channels.ts`).
- **Private Browsing (`src/main/browser/private-session.ts`)**: Uses ephemeral non-persistent partitions (`atlas-private-<uuid>`), clears storage/cache/auth on close, and bypasses SQLite history, session restore, memory, run logs, cost persistence, and disk screenshots.

## 2. Agent Permission Boundary

- **Permission Tiers (`src/main/security/permission-gate.ts`)**:
  - `read_only`: Page reading, inspection, search history/bookmarks.
  - `interact`: Navigation, clicking non-sensitive controls, typing into non-sensitive fields, tab operations.
  - `sensitive`: Form submission, checkout/payment actions, password/card fields, deletions, file uploads/downloads, experimental scripting. **Always requires explicit interactive user confirmation.** Approval is never inferred from prior confirmations.
- **Domain Rules**: `allow` (non-sensitive only), `interact`, `read_only`, and `deny` with optional expiration timestamps.
- **Prompt-Injection Defense (`src/main/security/injection-guard.ts`)**: Scans visible text, hidden DOM elements (`display:none`, `visibility:hidden`, `opacity:0`, `aria-hidden`), and HTML comments for instruction-like patterns, emits advisory warnings, and wraps all remote content in `<UNTRUSTED_PAGE_CONTENT trust="untrusted">` delimiters. Because detection is advisory, `PermissionGate` and `ToolRegistry` remain the hard security boundary.
- **JavaScript Execution**: Arbitrary page-context scripting (`run_page_script`) is disabled by default (`security.experimentalScriptingEnabled: false`), requires explicit user confirmation (`sensitive` tier) when enabled, and is logged to the audit trail.

## 3. Secrets & Audit Redaction

- **SecretVault (`src/main/security/secrets.ts`)**: Encrypts Gemini API keys, custom provider keys, and MCP auth tokens via Electron `safeStorage` (with machine-key AES-256-GCM fallback only when OS keychain is unavailable in headless environments).
- **Redaction**: `redactSecrets()` and `redactObjectSecrets()` strip API keys, bearer tokens, passwords, and payment fields before writing to audit logs.

## 4. Emergency Kill Switch

`CommandOrControl+Shift+Escape` (or the **Kill Switch** button in the toolbar) triggers `KillSwitch.trigger()` independently of the LLM: aborts all active and child `AbortController`s, rejects pending confirmation prompts, and detaches all CDP `webContents.debugger` sessions.

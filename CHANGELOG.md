# Changelog

## [1.0.0] - 2026-11-25

### Added
- **Desktop Browser Engine**: `WebContentsView` tab management, tab groups, pin/mute/rename/duplicate, closed-tab restore, vertical tabs, tab search, omnibox suggestions, crash-safe session restore, isolated private windows, download manager with dangerous-file prompts, Readability reading mode, and `webRequest` ad/tracker blocker.
- **Autonomous AI Agent**: Gemini API provider (function calling, structured JSON output, vision, SSE streaming), `CDPManager` over `webContents.debugger`, typed `ToolRegistry` (30 tools), Planner → Executor → Verifier loop, `ContextManager` compaction, `RecoveryMonitor`, and multi-agent parallel research orchestrator.
- **Safety & Governance**: `PermissionGate` (`read_only`/`interact`/`sensitive`), domain rules with expiration, `InjectionGuard`, interactive confirmation modal, `safeStorage` `SecretVault`, global `KillSwitch`, and redacted `AuditLogger`.
- **Autonomy Platform**: Record & Replay `Skills` with JSON import/export, local TF-IDF `MemoryService`, Ajv `StructuredExtractionEngine` with CSV/JSON export, persistent cron `JobScheduler`, localhost Bearer-authenticated `LocalMcpServer`, Cost/Budget Dashboard, and step-by-step Replay Viewer.
- **Verification**: Unit, integration, and 27-scenario deterministic evaluation suite.

# Agent Architecture (`Planner → Executor → Verifier`)

Atlas Browser implements an evidence-driven autonomous agent loop in `src/main/agent/`.

## Execution Loop (`src/main/agent/orchestrator.ts`)

1. **Receive Goal & Parse Slash Commands**: Supports `/summarize`, `/extract`, `/compare`, `/research`, `/skill`, `/pause`, `/resume`, `/stop`, and `/help`.
2. **Initial Perception**: Captures current page state (`PerceptionEngine`) and scans for prompt-injection warnings and HITL triggers (`captcha`, `payment_page`, `login_required`).
3. **Planner (`src/main/agent/planner.ts`)**: Uses structured JSON output (`responseSchema`) to decompose the goal into verifiable `Subgoal[]` items and assess complexity.
4. **Multi-Agent Parallelism**: For complex goals or `/research`, spawns isolated sub-agents (bounded by `budgets.maxParallelAgents`), each with its own tab, `runId`, and fractional budget, then synthesizes findings with source URLs.
5. **Context Management (`src/main/agent/context-manager.ts`)**: Estimates tokens, prioritizes recent observations, compacts older steps into deduplicated summaries, and preserves safety invariants and the original goal.
6. **Executor (`ToolRegistry`)**: Executes one schema-validated tool call per turn through `PermissionGate`.
7. **Verifier (`src/main/agent/verifier.ts`)**: Confirms subgoal progress via observable evidence (URL/title changes, DOM deltas, extracted text), triggering `retry`, `replan`, or `failed`.
8. **Recovery (`src/main/agent/recovery.ts`)**: Detects repeated identical actions, repeated failed selectors, and A↔B navigation loops, triggering alternate strategies, backtracking, or safe abort.
9. **Human-in-the-Loop (HITL)**: Pauses cleanly on CAPTCHAs/payment pages or user takeover, and re-observes the page before resuming.

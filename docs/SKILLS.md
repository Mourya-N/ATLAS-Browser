# Skills (Record & Replay) and Job Scheduler

## Skills Engine (`src/main/skills/`)

- **SkillRecorder**: Converts successful `AgentRun` executions into versioned `Skill` definitions containing `parameters`, `preconditions`, `requiredPermissions`, `allowedDomains`, `steps` (with `targetHints` and `verificationRule`), and execution statistics.
- **SkillRunner**: Substitutes `{{param}}` templates, invokes deterministic tools through `ToolRegistry` and `PermissionGate`, falls back from CSS selectors to text/AX hints on minor page changes, and invokes optional LLM recovery only when configured.
- **Portability**: Skills can be duplicated, edited, exported, and imported using the `atlas-skill-v1` JSON format.

## Persistent Scheduler (`src/main/scheduler/job-scheduler.ts`)

- Supports `once`, `daily`, `weekly`, `cron` (timezone-aware via `cron-parser`), and `event` triggers stored in SQLite (`scheduled_jobs`).
- Enforces `allowedDomains`, `maxBudgetUsd`, and permission safety: background jobs referencing skills with `sensitive` permissions pause with status `paused_permission` and notify the user rather than silently running sensitive actions.

# Permissions, Domain Rules & Human-in-the-Loop

Implemented in `src/main/security/permission-gate.ts`.

## Interaction Modes

- **Ask**: Only `read_only` tools are permitted.
- **Assist**: `read_only` tools run automatically; `interact` and `sensitive` tools prompt for confirmation.
- **Agent**: `read_only` and `interact` tools run autonomously (unless restricted by domain rules); `sensitive` tools always require confirmation.
- **Takeover**: All autonomous agent tool execution is halted so the user has exclusive manual control.

## Permission Tiers & Dynamic Elevation

Tools declare a `baseTier` (`read_only`, `interact`, `sensitive`) and may dynamically elevate via `resolveTier`:
- `click` elevates to `sensitive` when targeting submit, checkout, pay, purchase, delete, remove, or send controls.
- `type` elevates to `sensitive` when targeting password, card number, CVV, or secret fields.

## Domain Rules

Users can configure per-domain rules (`allow`, `interact`, `read_only`, `deny`) with optional expiration timestamps. Expired rules are automatically pruned on lookup.

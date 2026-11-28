# Contributing to LAVRAY Browser

## Development Workflow

1. Fork or branch from `main`.
2. Install dependencies (`npm install`) and rebuild native modules (`npm run rebuild`).
3. Ensure strict TypeScript checks pass (`npm run typecheck`).
4. Add unit, integration, or evaluation tests for any new browser, agent, or security feature.
5. Run `npm test` and `npm run build` before submitting a pull request.

## Code Standards

- **Strict TypeScript**: `strict: true`, `noImplicitAny: true`, `noUnusedLocals: true`, `noUnusedParameters: true`.
- **IPC Safety**: All new IPC channels must be declared in `src/shared/ipc-channels.ts` with Zod validation and registered via `handleTrusted()` in `src/main/ipc/register-handlers.ts`.
- **Security First**: Never relax `contextIsolation`, `nodeIntegration`, `sandbox`, or `PermissionGate` invariants.

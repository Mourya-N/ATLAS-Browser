# Build & Deployment Guide

Atlas Browser uses `esbuild` (main & preload scripts), `vite` (React renderer), and `electron-builder` (desktop installers).

## Build Commands

```bash
# Typecheck strict main, preload, shared, renderer, and test files
npm run typecheck

# Compile dist/main, dist/preload, and dist/renderer
npm run build

# Rebuild native better-sqlite3 for Electron's ABI
npm run rebuild
```

## Packaging (`electron-builder`)

Configured in `package.json` under `"build"`:
- **macOS**: Universal/Apple Silicon (`arm64`) and Intel (`x64`) `.dmg` targets, unpacking `node_modules/better-sqlite3/**/*` from ASAR.
- **Windows**: `nsis` installer.
- **Linux**: `AppImage` target.

```bash
# Unpacked app bundle (fast verification in release/)
npm run package

# Distributable installers
npm run dist
```

## Known Packaging Notes

- `better-sqlite3` is a native N-API addon and must be compiled for the target architecture and Electron ABI (`@electron/rebuild`).
- Code signing / notarization on macOS and Windows requires setting standard `CSC_LINK` / Apple Developer credentials in CI when distributing publicly.

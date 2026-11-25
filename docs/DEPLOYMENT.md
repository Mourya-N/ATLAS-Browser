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
- **Branded App Icon**: `assets/icon.png` (512x512 RGBA).
- **macOS**: Universal/Apple Silicon (`arm64`) and Intel (`x64`) `.dmg` targets with `hardenedRuntime: true`, `build/entitlements.mac.plist` (including JIT and `NSMicrophoneUsageDescription`), unpacking `node_modules/better-sqlite3/**/*` from ASAR.
- **Windows**: `nsis` installer.
- **Linux**: `AppImage` target.

```bash
# Unpacked app bundle (fast verification in release/)
npm run package

# Distributable installers
npm run dist
```

## Logging, Crash Reporting & Updates

- **Logs**: Redacted rotating logs stored locally in `userData/logs/atlas.log` (2 MB rotation).
- **Crash Reporting**: Electron `crashReporter` is initialized with `uploadToServer: false` (local dumps only; telemetry disabled by default).
- **Update Strategy**: Configured for manual/signed release updates via GitHub Releases (`electron-updater` can be enabled once Developer ID signing credentials are provisioned).

## Release Readiness & Signing Checklist

- [x] Production `vite` + `esbuild` bundle (`npm run build`)
- [x] Native `better-sqlite3` ABI rebuild & `asarUnpack`
- [x] Branded icon (`assets/icon.png`) and `build/entitlements.mac.plist`
- [x] Unpacked macOS `.app` bundle verified via `electron-builder --dir`
- [ ] Apple Developer ID Application certificate (`CSC_LINK`) & notarization (`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD`) — requires active Apple Developer account credentials

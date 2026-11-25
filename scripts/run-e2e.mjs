import esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function main() {
  console.log('[e2e] Bundling real-Chromium Electron E2E suite...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'tests/e2e/electron-e2e.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: path.join(rootDir, 'dist/e2e/electron-e2e.js'),
    sourcemap: true,
    external: ['electron', 'better-sqlite3'],
    alias: {
      '@shared': path.join(rootDir, 'src/shared'),
      '@main': path.join(rootDir, 'src/main')
    }
  });

  const migrationsSrc = path.join(rootDir, 'src/main/db/migrations');
  const migrationsDst = path.join(rootDir, 'dist/e2e/migrations');
  fs.mkdirSync(migrationsDst, { recursive: true });
  for (const file of fs.readdirSync(migrationsSrc)) {
    if (file.endsWith('.sql')) {
      fs.copyFileSync(path.join(migrationsSrc, file), path.join(migrationsDst, file));
    }
  }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronBin = path.join(rootDir, 'node_modules/.bin/electron');
  const child = spawn(electronBin, [path.join(rootDir, 'dist/e2e/electron-e2e.js')], {
    cwd: rootDir,
    stdio: 'inherit',
    env
  });

  child.on('close', (code) => {
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error('[e2e] Failed:', err);
  process.exit(1);
});

import esbuild from 'esbuild';
import { build as viteBuild } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function main() {
  console.log('[build] Building Electron main process...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/main/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: path.join(rootDir, 'dist/main/index.js'),
    sourcemap: true,
    external: ['electron', 'better-sqlite3'],
    alias: {
      '@shared': path.join(rootDir, 'src/shared'),
      '@main': path.join(rootDir, 'src/main')
    }
  });

  // Copy SQL migrations alongside dist/main/migrations
  const migrationsSrc = path.join(rootDir, 'src/main/db/migrations');
  const migrationsDst = path.join(rootDir, 'dist/main/migrations');
  if (fs.existsSync(migrationsSrc)) {
    fs.mkdirSync(migrationsDst, { recursive: true });
    for (const file of fs.readdirSync(migrationsSrc)) {
      if (file.endsWith('.sql')) {
        fs.copyFileSync(path.join(migrationsSrc, file), path.join(migrationsDst, file));
      }
    }
  }

  console.log('[build] Building preload scripts...');
  await esbuild.build({
    entryPoints: [
      path.join(rootDir, 'src/preload/ui-preload.ts'),
      path.join(rootDir, 'src/preload/content-preload.ts')
    ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outdir: path.join(rootDir, 'dist/preload'),
    sourcemap: true,
    external: ['electron'],
    alias: {
      '@shared': path.join(rootDir, 'src/shared')
    }
  });

  console.log('[build] Building renderer with Vite...');
  await viteBuild({
    configFile: path.join(rootDir, 'vite.config.ts')
  });

  console.log('[build] Complete.');
}

main().catch((err) => {
  console.error('[build] Failed:', err);
  process.exit(1);
});

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function main() {
  console.log('[build-backend] Bundling LAVRAY Cloud API & Background Worker...');
  await esbuild.build({
    entryPoints: [
      path.join(rootDir, 'src/backend/api/server.ts'),
      path.join(rootDir, 'src/backend/worker-entrypoint.ts'),
      path.join(rootDir, 'src/backend/db/migrate-cli.ts'),
      path.join(rootDir, 'src/backend/eval/search-eval.ts')
    ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outdir: path.join(rootDir, 'dist/backend'),
    sourcemap: true,
    external: ['pg', 'ioredis'],
    alias: {
      '@shared': path.join(rootDir, 'src/shared'),
      '@main': path.join(rootDir, 'src/main')
    }
  });

  const migrationsSrc = path.join(rootDir, 'src/backend/db/migrations');
  const migrationsDst = path.join(rootDir, 'dist/backend/db/migrations');
  if (fs.existsSync(migrationsSrc)) {
    fs.mkdirSync(migrationsDst, { recursive: true });
    for (const file of fs.readdirSync(migrationsSrc)) {
      if (file.endsWith('.sql')) {
        fs.copyFileSync(path.join(migrationsSrc, file), path.join(migrationsDst, file));
      }
    }
  }
  console.log('[build-backend] Complete.');
}

main().catch((err) => {
  console.error('[build-backend] Failed:', err);
  process.exit(1);
});

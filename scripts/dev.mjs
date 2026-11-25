import esbuild from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function copyMigrations() {
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
}

async function main() {
  const server = await createServer({
    configFile: path.join(rootDir, 'vite.config.ts')
  });
  await server.listen();
  const port = server.config.server.port ?? 5173;
  process.env.ATLAS_DEV_SERVER_URL = `http://localhost:${port}`;

  copyMigrations();

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

  const electronBin = path.join(rootDir, 'node_modules/.bin/electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.ATLAS_DEV_SERVER_URL = process.env.ATLAS_DEV_SERVER_URL;

  const child = spawn(electronBin, ['.'], {
    cwd: rootDir,
    stdio: 'inherit',
    env
  });

  child.on('close', async (code) => {
    await server.close();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('[dev] Failed:', err);
  process.exit(1);
});

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const env = { ...process.env };
// Ensure Electron launches as Chromium GUI even when started from IDE terminals
delete env.ELECTRON_RUN_AS_NODE;

const electronBin = path.join(rootDir, 'node_modules/.bin/electron');
const child = spawn(electronBin, ['.', ...process.argv.slice(2)], {
  cwd: rootDir,
  stdio: 'inherit',
  env
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

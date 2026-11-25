import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-launch-smoke-'));

const env = { ...process.env, ATLAS_USER_DATA_DIR: tempUserData };
delete env.ELECTRON_RUN_AS_NODE;

const electronBin = path.join(rootDir, 'node_modules/.bin/electron');
const port = 9233;
const child = spawn(electronBin, ['.', `--remote-debugging-port=${port}`], {
  cwd: rootDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => {
  stdout += d.toString();
});
child.stderr.on('data', (d) => {
  stderr += d.toString();
});

async function pollTargets() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const hasRenderer = list.some((t) => t.url && t.url.includes('dist/renderer/index.html'));
        if (hasRenderer && list.length >= 2) {
          return list;
        }
      }
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for built Atlas Browser targets.\nstdout: ${stdout}\nstderr: ${stderr}`);
}

try {
  const targets = await pollTargets();
  console.log('[launch-smoke] Built Atlas Browser launched cleanly with targets:');
  for (const t of targets) {
    console.log(`  - [${t.type}] ${t.title || '(untitled)'} -> ${t.url}`);
  }
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  if (!child.killed) child.kill('SIGKILL');
  fs.rmSync(tempUserData, { recursive: true, force: true });
  process.exit(0);
} catch (err) {
  console.error('[launch-smoke] Failed:', err);
  child.kill('SIGKILL');
  fs.rmSync(tempUserData, { recursive: true, force: true });
  process.exit(1);
}

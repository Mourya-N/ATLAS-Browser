import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '@main/security/secrets';

export class LavrayLogger {
  private readonly logFile: string;
  private readonly maxBytes = 2 * 1024 * 1024;

  constructor(userDataDir: string) {
    const dir = path.join(userDataDir, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    this.logFile = path.join(dir, 'lavray.log');
  }

  public log(level: 'INFO' | 'WARN' | 'ERROR', scope: string, message: string, meta?: unknown): void {
    try {
      this.rotateIfNeeded();
      const timestamp = new Date().toISOString();
      const metaStr = meta !== undefined ? ` ${redactSecrets(JSON.stringify(meta))}` : '';
      const line = `[${timestamp}] [${level}] [${scope}] ${redactSecrets(message)}${metaStr}\n`;
      fs.appendFileSync(this.logFile, line, 'utf8');
    } catch {
      // Never throw from logger
    }
  }

  public getLogPath(): string {
    return this.logFile;
  }

  private rotateIfNeeded(): void {
    if (!fs.existsSync(this.logFile)) return;
    const stat = fs.statSync(this.logFile);
    if (stat.size >= this.maxBytes) {
      const backup = `${this.logFile}.1`;
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      fs.renameSync(this.logFile, backup);
    }
  }
}

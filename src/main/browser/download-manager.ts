import { app, dialog, shell, type BrowserWindow, type DownloadItem as ElectronDownloadItem, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DownloadItem } from '@shared/types';
import type { BrowserRepository } from '@main/db/repositories/browser-repo';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';

const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.dmg',
  '.pkg',
  '.sh',
  '.bash',
  '.zsh',
  '.bat',
  '.cmd',
  '.msi',
  '.app',
  '.scr',
  '.vbs',
  '.jar',
  '.ps1',
  '.com'
]);

export function resolveUniqueFilePath(dir: string, filename: string): string {
  const safeName = path.basename(filename || 'download');
  const ext = path.extname(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;
  let candidate = path.join(dir, safeName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${counter})${ext}`);
    counter += 1;
  }
  return candidate;
}

export function isDangerousDownload(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return DANGEROUS_EXTENSIONS.has(ext);
}

export function isSensitiveDownloadLocation(targetPath: string, defaultDir: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedDefault = path.resolve(defaultDir);
  return !resolvedTarget.startsWith(resolvedDefault + path.sep) && resolvedTarget !== resolvedDefault;
}

export class DownloadManager {
  private activeItems = new Map<string, { electronItem: ElectronDownloadItem; record: DownloadItem }>();
  private attachedSessions = new WeakSet<Session>();
  private updateListeners = new Set<(item: DownloadItem) => void>();

  constructor(
    private readonly browserRepo: BrowserRepository,
    private readonly platformRepo: PlatformRepository,
    private readonly getHostWindow: () => BrowserWindow | null
  ) {}

  public onUpdate(cb: (item: DownloadItem) => void): () => void {
    this.updateListeners.add(cb);
    return () => this.updateListeners.delete(cb);
  }

  private emitUpdate(item: DownloadItem, isPrivate = false): void {
    if (!isPrivate) {
      this.browserRepo.upsertDownload(item);
    }
    for (const cb of this.updateListeners) {
      cb(item);
    }
  }

  public getDownloadDir(): string {
    const fallback = app?.getPath ? app.getPath('downloads') : '/tmp';
    return this.platformRepo.getSetting<string>('browser.downloadDir', fallback);
  }

  public attachToSession(sess: Session, isPrivate = false): void {
    if (this.attachedSessions.has(sess)) return;
    this.attachedSessions.add(sess);

    sess.on('will-download', async (_event, item) => {
      const id = randomUUID();
      const downloadDir = this.getDownloadDir();
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }

      const filename = item.getFilename() || 'download';
      const savePath = resolveUniqueFilePath(downloadDir, filename);
      const dangerous = isDangerousDownload(filename) || isSensitiveDownloadLocation(savePath, downloadDir);

      item.setSavePath(savePath);

      const record: DownloadItem = {
        id,
        url: item.getURL(),
        filename,
        savePath,
        mimeType: item.getMimeType() || 'application/octet-stream',
        totalBytes: item.getTotalBytes(),
        receivedBytes: item.getReceivedBytes(),
        state: dangerous ? 'pending_approval' : 'progressing',
        isDangerous: dangerous,
        startedAt: Date.now()
      };

      this.activeItems.set(id, { electronItem: item, record });

      if (dangerous) {
        item.pause();
        this.emitUpdate(record, isPrivate);
        const win = this.getHostWindow();
        const choice = await dialog.showMessageBox(win ?? (undefined as unknown as BrowserWindow), {
          type: 'warning',
          title: 'Download Safety Confirmation',
          message: `Allow potentially dangerous download "${filename}"?`,
          detail: `Source: ${record.url}\nDestination: ${savePath}\nExecutable or script files can harm your computer.`,
          buttons: ['Cancel Download', 'Allow Download'],
          defaultId: 0,
          cancelId: 0
        });
        if (choice.response !== 1) {
          record.state = 'cancelled';
          record.error = 'Rejected by user safety prompt';
          item.cancel();
          this.emitUpdate(record, isPrivate);
          this.activeItems.delete(id);
          return;
        }
        record.state = 'progressing';
        if (item.isPaused()) item.resume();
      }

      this.emitUpdate(record, isPrivate);

      item.on('updated', (_ev, state) => {
        record.totalBytes = item.getTotalBytes();
        record.receivedBytes = item.getReceivedBytes();
        if (state === 'interrupted') {
          record.state = 'interrupted';
        } else if (item.isPaused()) {
          record.state = 'paused';
        } else {
          record.state = 'progressing';
        }
        this.emitUpdate({ ...record }, isPrivate);
      });

      item.once('done', (_ev, state) => {
        record.totalBytes = item.getTotalBytes();
        record.receivedBytes = item.getReceivedBytes();
        record.completedAt = Date.now();
        if (state === 'completed') {
          record.state = 'completed';
        } else if (state === 'cancelled') {
          record.state = 'cancelled';
        } else {
          record.state = 'interrupted';
          record.error = state;
        }
        this.emitUpdate({ ...record }, isPrivate);
        this.activeItems.delete(id);
      });
    });
  }

  public listDownloads(): DownloadItem[] {
    const persisted = this.browserRepo.listDownloads(100);
    const activeMap = new Map(
      Array.from(this.activeItems.values()).map((entry) => [entry.record.id, entry.record])
    );
    return persisted.map((p) => activeMap.get(p.id) ?? p);
  }

  public performAction(id: string, action: 'pause' | 'resume' | 'cancel' | 'open' | 'reveal'): boolean {
    const active = this.activeItems.get(id);
    if (action === 'pause' && active) {
      active.electronItem.pause();
      active.record.state = 'paused';
      this.emitUpdate({ ...active.record });
      return true;
    }
    if (action === 'resume' && active) {
      if (active.electronItem.canResume()) {
        active.electronItem.resume();
        active.record.state = 'progressing';
        this.emitUpdate({ ...active.record });
        return true;
      }
      return false;
    }
    if (action === 'cancel' && active) {
      active.electronItem.cancel();
      active.record.state = 'cancelled';
      this.emitUpdate({ ...active.record });
      return true;
    }

    const record = active?.record ?? this.browserRepo.listDownloads(200).find((d) => d.id === id);
    if (!record) return false;

    if (action === 'open' && record.state === 'completed' && fs.existsSync(record.savePath)) {
      void shell.openPath(record.savePath);
      return true;
    }
    if (action === 'reveal' && fs.existsSync(record.savePath)) {
      shell.showItemInFolder(record.savePath);
      return true;
    }
    return false;
  }
}

import { BrowserWindow, app, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import type { PrivateSessionManager } from './browser/private-session';
import type { SessionRestoreService } from './browser/session-restore';
import type { TabManager } from './browser/tab-manager';

export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private windows = new Map<number, { win: BrowserWindow; isPrivate: boolean }>();

  constructor(
    private readonly platformRepo: PlatformRepository,
    private readonly tabManager: TabManager,
    private readonly privateSessionManager: PrivateSessionManager,
    private readonly sessionRestore: SessionRestoreService,
    private readonly uiPreloadPath: string
  ) {}

  private getRendererEntry(): { devUrl?: string; filePath?: string } {
    const devUrl = process.env.LAVRAY_DEV_SERVER_URL;
    if (devUrl) return { devUrl };
    const candidates = [
      path.join(__dirname, '../renderer/index.html'),
      path.join(process.cwd(), 'dist/renderer/index.html')
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return { filePath: c };
    }
    return { filePath: candidates[0] };
  }

  public createWindow(options: { isPrivate?: boolean } = {}): BrowserWindow {
    const isPrivate = Boolean(options.isPrivate);
    const savedBounds = this.platformRepo.getSetting<WindowBounds>('window.bounds', {
      width: 1440,
      height: 920
    });

    let partitionId: string | undefined;
    if (isPrivate) {
      partitionId = this.privateSessionManager.createEphemeralSession().partitionId;
    }

    const savedTheme = this.platformRepo.getSetting<'light' | 'dark' | 'system'>('ui.theme', 'light');
    const isDarkWindow = savedTheme === 'dark' || (savedTheme === 'system' && nativeTheme.shouldUseDarkColors);

    const iconCandidates = [
      path.join(app.getAppPath(), 'assets/icon.png'),
      path.join(process.cwd(), 'assets/icon.png')
    ];
    const windowIconPath = iconCandidates.find((p) => fs.existsSync(p));

    const win = new BrowserWindow({
      width: savedBounds.width || 1440,
      height: savedBounds.height || 920,
      x: savedBounds.x,
      y: savedBounds.y,
      minWidth: 960,
      minHeight: 620,
      title: isPrivate ? 'LAVRAY Browser — Private' : 'LAVRAY Browser',
      icon: windowIconPath,
      backgroundColor: isDarkWindow ? '#0f1016' : '#fafaf8',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 14 } : undefined,
      webPreferences: {
        preload: this.uiPreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });

    if (savedBounds.isMaximized && !isPrivate) {
      win.maximize();
    }

    // Strict navigation guard on the trusted UI shell window
    win.webContents.on('will-navigate', (event, url) => {
      const devUrl = process.env.LAVRAY_DEV_SERVER_URL;
      const isTrusted =
        url.startsWith('file://') || (devUrl ? url.startsWith(devUrl) : false);
      if (!isTrusted) {
        event.preventDefault();
      }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    this.windows.set(win.id, { win, isPrivate });
    if (!isPrivate && !this.mainWindow) {
      this.mainWindow = win;
    }

    this.tabManager.registerWindow(win, isPrivate, partitionId);

    const entry = this.getRendererEntry();
    const query = isPrivate ? '?private=1' : '';
    if (entry.devUrl) {
      void win.loadURL(`${entry.devUrl}${query}`);
    } else if (entry.filePath) {
      void win.loadFile(entry.filePath, { query: isPrivate ? { private: '1' } : undefined });
    }

    if (!isPrivate) {
      const saveBounds = () => {
        if (win.isDestroyed()) return;
        const b = win.getBounds();
        this.platformRepo.setSetting<WindowBounds>('window.bounds', {
          width: b.width,
          height: b.height,
          x: b.x,
          y: b.y,
          isMaximized: win.isMaximized()
        });
      };
      win.on('resize', saveBounds);
      win.on('move', saveBounds);
    }

    win.on('closed', () => {
      this.windows.delete(win.id);
      if (this.mainWindow?.id === win.id) {
        this.mainWindow = null;
      }
    });

    // Restore previous tabs or open initial tab once UI finishes loading
    win.webContents.once('did-finish-load', () => {
      if (isPrivate) {
        this.tabManager.createTab(win.id, { url: 'lavray://newtab', activate: true });
        return;
      }
      const restoreEnabled = this.platformRepo.getSetting<boolean>('browser.restoreSessionOnStart', true);
      if (restoreEnabled && this.tabManager.getTabsForWindow(win.id).length === 0) {
        const prev = this.sessionRestore.loadPreviousSession();
        if (prev.tabs.length > 0) {
          this.tabManager.restoreGroups(prev.groups);
          let activeRestoredId: string | null = null;
          for (const t of prev.tabs) {
            const created = this.tabManager.createTab(win.id, {
              url: t.url,
              activate: t.isActive,
              isPinned: t.isPinned,
              isMuted: t.isMuted,
              customTitle: t.customTitle,
              groupId: t.groupId,
              zoomFactor: t.zoomFactor
            });
            if (t.isActive) activeRestoredId = created.id;
          }
          if (activeRestoredId) {
            this.tabManager.activateTab(activeRestoredId);
          }
          return;
        }
      }
      if (this.tabManager.getTabsForWindow(win.id).length === 0) {
        this.tabManager.createTab(win.id, { activate: true });
      }
    });

    return win;
  }

  public getMainWindow(): BrowserWindow | null {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow;
    for (const entry of this.windows.values()) {
      if (!entry.win.isDestroyed()) return entry.win;
    }
    return null;
  }

  public getWindowByWebContentsId(wcId: number): BrowserWindow | null {
    for (const entry of this.windows.values()) {
      if (!entry.win.isDestroyed() && entry.win.webContents.id === wcId) {
        return entry.win;
      }
    }
    return null;
  }

  public getTrustedWebContentsIds(): number[] {
    const ids: number[] = [];
    for (const entry of this.windows.values()) {
      if (!entry.win.isDestroyed()) ids.push(entry.win.webContents.id);
    }
    return ids;
  }

  public isPrivateWindow(windowId: number): boolean {
    return this.windows.get(windowId)?.isPrivate ?? false;
  }
}

export function resolveUiPreloadPath(): string {
  const candidates = [
    path.join(__dirname, '../preload/ui-preload.js'),
    path.join(process.cwd(), 'dist/preload/ui-preload.js')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(app?.getAppPath?.() ?? process.cwd(), 'dist/preload/ui-preload.js');
}

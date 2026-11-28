import { Menu, WebContentsView, session, type BrowserWindow, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  ClosedTabRecord,
  ReaderArticle,
  SearchEngineId,
  TabGroup,
  TabInfo
} from '@shared/types';
import type { BrowserRepository } from '@main/db/repositories/browser-repo';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import { getSecurityState, resolveNavigationInput } from './navigation';
import { extractReadableArticle } from './reader-extractor';
import type { AdBlocker } from './ad-blocker';
import type { DownloadManager } from './download-manager';
import type { PrivateSessionManager } from './private-session';
import type { SessionRestoreService } from './session-restore';

export interface ManagedTab {
  info: TabInfo;
  view: WebContentsView;
  partitionId?: string;
}

export interface WindowLayoutInsets {
  topInset: number;
  leftInset: number;
  rightInset: number;
  hideBrowserView: boolean;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'about:', 'data:', 'file:']);

export function isAllowedNavigationUrl(url: string): boolean {
  if (!url) return false;
  if (url === 'about:blank' || url.startsWith('lavray://')) return true;
  try {
    const parsed = new URL(url);
    return ALLOWED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function isInternalLavrayUrl(url: string): boolean {
  return url === 'lavray://newtab' || url.startsWith('lavray://search');
}

function getInternalLavrayTitle(url: string): string {
  if (url === 'lavray://newtab') return 'New Tab';
  if (url.startsWith('lavray://search')) {
    try {
      const q = new URL(url).searchParams.get('q')?.trim();
      return q ? `${q} — LAVRAY Search` : 'LAVRAY Search';
    } catch {
      return 'LAVRAY Search';
    }
  }
  return url;
}

export class TabManager {
  private tabs = new Map<string, ManagedTab>();
  private tabOrder: string[] = [];
  private groups = new Map<string, TabGroup>();
  private activeTabByWindow = new Map<number, string>();
  private closedStack: ClosedTabRecord[] = [];
  private layoutByWindow = new Map<number, WindowLayoutInsets>();
  private windows = new Map<number, { win: BrowserWindow; isPrivate: boolean; partitionId?: string }>();
  private stateListeners = new Set<(windowId: number) => void>();
  private contextActionListeners = new Set<
    (action: string, payload: { tabId: string; url: string; selectedText?: string }) => void
  >();
  private pageLoadedListeners = new Set<
    (payload: { tabId: string; url: string; title: string; webContents: WebContents }) => void
  >();

  constructor(
    private readonly browserRepo: BrowserRepository,
    private readonly platformRepo: PlatformRepository,
    private readonly adBlocker: AdBlocker,
    private readonly downloadManager: DownloadManager,
    private readonly privateSessionManager: PrivateSessionManager,
    private readonly sessionRestore: SessionRestoreService,
    private readonly contentPreloadPath: string
  ) {
    this.adBlocker.onBlocked((wcId) => {
      for (const tab of this.tabs.values()) {
        if (!tab.view.webContents.isDestroyed() && tab.view.webContents.id === wcId) {
          tab.info.blockedCount += 1;
          this.emitState(tab.info.windowId);
          break;
        }
      }
    });
  }

  public registerWindow(win: BrowserWindow, isPrivate: boolean, partitionId?: string): void {
    this.windows.set(win.id, { win, isPrivate, partitionId });
    this.layoutByWindow.set(win.id, {
      topInset: 88,
      leftInset: 0,
      rightInset: 380,
      hideBrowserView: false
    });

    win.on('resize', () => this.relayoutWindow(win.id));
    win.on('closed', () => {
      const tabIds = this.getTabsForWindow(win.id).map((t) => t.id);
      for (const id of tabIds) {
        this.destroyTabView(id);
      }
      this.windows.delete(win.id);
      this.layoutByWindow.delete(win.id);
      this.activeTabByWindow.delete(win.id);
      if (isPrivate && partitionId) {
        void this.privateSessionManager.destroyEphemeralSession(partitionId);
      }
    });
  }

  public onStateChanged(cb: (windowId: number) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  public onContextAction(
    cb: (action: string, payload: { tabId: string; url: string; selectedText?: string }) => void
  ): () => void {
    this.contextActionListeners.add(cb);
    return () => this.contextActionListeners.delete(cb);
  }

  public onPageLoaded(
    cb: (payload: { tabId: string; url: string; title: string; webContents: WebContents }) => void
  ): () => void {
    this.pageLoadedListeners.add(cb);
    return () => this.pageLoadedListeners.delete(cb);
  }

  private emitState(windowId: number): void {
    for (const cb of this.stateListeners) {
      cb(windowId);
    }
    const winMeta = this.windows.get(windowId);
    if (winMeta && !winMeta.isPrivate) {
      this.sessionRestore.scheduleSave(() => ({
        tabs: this.getAllNonPrivateTabs(),
        activeTabId: this.activeTabByWindow.get(windowId) ?? null,
        groups: Array.from(this.groups.values())
      }));
    }
  }

  public setLayout(windowId: number, insets: WindowLayoutInsets): void {
    this.layoutByWindow.set(windowId, insets);
    this.relayoutWindow(windowId);
  }

  public relayoutWindow(windowId: number): void {
    const winMeta = this.windows.get(windowId);
    if (!winMeta || winMeta.win.isDestroyed()) return;

    const insets = this.layoutByWindow.get(windowId) ?? {
      topInset: 88,
      leftInset: 0,
      rightInset: 0,
      hideBrowserView: false
    };

    const [contentW, contentH] = winMeta.win.getContentSize();
    const activeId = this.activeTabByWindow.get(windowId);

    for (const tab of this.tabs.values()) {
      if (tab.info.windowId !== windowId) continue;
      const isVisible = !insets.hideBrowserView && tab.info.id === activeId;
      tab.view.setVisible(isVisible);
      if (isVisible) {
        const x = Math.max(0, Math.round(insets.leftInset));
        const y = Math.max(0, Math.round(insets.topInset));
        const width = Math.max(100, Math.round(contentW - insets.leftInset - insets.rightInset));
        const height = Math.max(100, Math.round(contentH - insets.topInset));
        tab.view.setBounds({ x, y, width, height });
      }
    }
  }

  public createTab(
    windowId: number,
    options: {
      url?: string;
      activate?: boolean;
      isPinned?: boolean;
      isMuted?: boolean;
      customTitle?: string | null;
      groupId?: string | null;
      zoomFactor?: number;
      id?: string;
    } = {}
  ): TabInfo {
    const winMeta = this.windows.get(windowId);
    if (!winMeta) throw new Error(`Window ${windowId} not registered`);

    const id = options.id ?? randomUUID();
    const homeUrl = this.platformRepo.getSetting<string>('browser.homeUrl', 'lavray://newtab');
    const searchEngine = this.platformRepo.getSetting<SearchEngineId>('browser.searchEngine', 'lavray');
    const targetUrl = options.url ? resolveNavigationInput(options.url, searchEngine) : homeUrl;
    const isInternalPage = isInternalLavrayUrl(targetUrl);

    const tabSession = winMeta.isPrivate && winMeta.partitionId
      ? session.fromPartition(winMeta.partitionId, { cache: false })
      : session.defaultSession;

    this.adBlocker.attachToSession(tabSession);
    this.downloadManager.attachToSession(tabSession, winMeta.isPrivate);

    const view = new WebContentsView({
      webPreferences: {
        preload: this.contentPreloadPath,
        session: tabSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true
      }
    });

    const info: TabInfo = {
      id,
      windowId,
      url: targetUrl,
      title: isInternalPage ? getInternalLavrayTitle(targetUrl) : targetUrl,
      customTitle: options.customTitle ?? null,
      favicon: null,
      isLoading: !isInternalPage,
      canGoBack: false,
      canGoForward: false,
      isPinned: Boolean(options.isPinned),
      isMuted: Boolean(options.isMuted),
      isPrivate: winMeta.isPrivate,
      groupId: options.groupId ?? null,
      orderIndex: this.getTabsForWindow(windowId).length,
      zoomFactor: options.zoomFactor ?? 1.0,
      crashed: false,
      securityState: getSecurityState(targetUrl),
      blockedCount: 0,
      agentActive: false,
      lastActiveAt: Date.now()
    };

    const managed: ManagedTab = { info, view, partitionId: winMeta.partitionId };
    this.tabs.set(id, managed);
    this.tabOrder.push(id);

    winMeta.win.contentView.addChildView(view);
    if (info.isMuted) {
      view.webContents.setAudioMuted(true);
    }

    this.wireWebContentsEvents(managed);

    if (options.activate !== false || !this.activeTabByWindow.has(windowId)) {
      this.activateTab(id);
    } else {
      view.setVisible(false);
    }

    const loadTarget = isInternalPage ? 'about:blank' : targetUrl;
    if (isAllowedNavigationUrl(loadTarget)) {
      void view.webContents.loadURL(loadTarget).catch((err) => {
        console.warn('[TabManager] Initial load error:', loadTarget, err?.message || err);
      });
    }

    this.emitState(windowId);
    return { ...info };
  }

  private wireWebContentsEvents(managed: ManagedTab): void {
    const wc = managed.view.webContents;
    const { info } = managed;

    const syncNavFlags = () => {
      if (wc.isDestroyed()) return;
      info.canGoBack = wc.navigationHistory?.canGoBack() ?? wc.canGoBack();
      info.canGoForward = wc.navigationHistory?.canGoForward() ?? wc.canGoForward();
      const rawUrl = wc.getURL();
      if (rawUrl === 'about:blank' && isInternalLavrayUrl(info.url)) {
        info.title = getInternalLavrayTitle(info.url);
        info.securityState = 'internal';
      } else {
        info.url = rawUrl || info.url;
        info.securityState = getSecurityState(info.url);
      }
    };

    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedNavigationUrl(url)) {
        this.createTab(info.windowId, { url, activate: true, groupId: info.groupId });
      }
      return { action: 'deny' };
    });

    wc.on('will-navigate', (event, url) => {
      if (!isAllowedNavigationUrl(url)) {
        event.preventDefault();
      }
    });

    wc.on('did-start-loading', () => {
      info.isLoading = true;
      info.crashed = false;
      this.emitState(info.windowId);
    });

    wc.on('dom-ready', () => {
      if (wc.isDestroyed()) return;
      const css = this.adBlocker.getCosmeticCssForUrl(wc.getURL());
      if (css) {
        void wc.insertCSS(css, { cssOrigin: 'user' }).catch(() => {
          // ignore stylesheet injection failures on restricted pages
        });
      }
    });

    wc.on('did-stop-loading', () => {
      info.isLoading = false;
      syncNavFlags();
      if (info.zoomFactor !== 1.0 && !wc.isDestroyed()) {
        wc.setZoomFactor(info.zoomFactor);
      }
      if (
        !info.isPrivate &&
        !wc.isDestroyed() &&
        (info.url.startsWith('https://') || info.url.startsWith('http://'))
      ) {
        for (const cb of this.pageLoadedListeners) {
          cb({ tabId: info.id, url: info.url, title: info.title, webContents: wc });
        }
      }
      this.emitState(info.windowId);
    });

    wc.on('did-navigate', (_ev, url) => {
      if (!(url === 'about:blank' && isInternalLavrayUrl(info.url))) {
        info.url = url;
      }
      syncNavFlags();
      if (!info.isPrivate && !url.startsWith('data:') && url !== 'about:blank' && !url.startsWith('lavray://')) {
        this.browserRepo.recordVisit(url, info.title, info.favicon);
      }
      this.emitState(info.windowId);
    });

    wc.on('did-navigate-in-page', (_ev, url) => {
      if (!(url === 'about:blank' && isInternalLavrayUrl(info.url))) {
        info.url = url;
      }
      syncNavFlags();
      if (!info.isPrivate && !url.startsWith('data:') && url !== 'about:blank' && !url.startsWith('lavray://')) {
        this.browserRepo.recordVisit(url, info.title, info.favicon);
      }
      this.emitState(info.windowId);
    });

    wc.on('page-title-updated', (_ev, title) => {
      if (isInternalLavrayUrl(info.url)) {
        info.title = getInternalLavrayTitle(info.url);
        this.emitState(info.windowId);
        return;
      }
      info.title = title || info.url;
      if (!info.isPrivate && info.url && !info.url.startsWith('data:') && info.url !== 'about:blank') {
        this.browserRepo.recordVisit(info.url, info.title, info.favicon);
      }
      this.emitState(info.windowId);
    });

    wc.on('page-favicon-updated', (_ev, favicons) => {
      if (favicons && favicons.length > 0) {
        const rawUrl = favicons[0];
        if (rawUrl.startsWith('http://')) {
          // Safely convert http:// favicons (including localhost) into bounded data: URIs so production CSP never allows broad http: images
          void fetch(rawUrl, { signal: AbortSignal.timeout(2000) })
            .then(async (res) => {
              if (!res.ok) return;
              const ct = res.headers.get('content-type') || '';
              if (!ct.startsWith('image/')) return;
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length > 0 && buf.length <= 65_536) {
                info.favicon = `data:${ct.split(';')[0]};base64,${buf.toString('base64')}`;
                this.emitState(info.windowId);
              }
            })
            .catch(() => {
              // Ignore missing/unreachable http favicon gracefully without violating CSP
            });
        } else if (rawUrl.startsWith('https://') || rawUrl.startsWith('data:image/')) {
          info.favicon = rawUrl;
          this.emitState(info.windowId);
        }
      }
    });

    wc.on('did-fail-load', (_ev, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return; // Ignore ERR_ABORTED
      info.isLoading = false;
      const safeMsg = `${errorDescription} (${errorCode})`.replace(/[<>&"]/g, '');
      const safeUrl = (validatedURL || info.url).replace(/[<>&"]/g, '');
      const errorHtml = `<!doctype html><html><head><title>Navigation Error</title><style>body{font-family:-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}main{max-width:520px;padding:32px;border:1px solid #334155;border-radius:14px;background:#1e293b}h1{margin:0 0 10px;font-size:20px}p{color:#94a3b8;line-height:1.5;word-break:break-word}code{background:#0f172a;padding:2px 6px;border-radius:4px}</style></head><body><main><h1>Unable to load page</h1><p>LAVRAY Browser could not load <code>${safeUrl}</code>.</p><p>Error: <strong>${safeMsg}</strong></p></main></body></html>`;
      void wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
      this.emitState(info.windowId);
    });

    wc.on('render-process-gone', (_ev, details) => {
      info.crashed = true;
      info.isLoading = false;
      console.error(`[TabManager] Tab ${info.id} renderer crashed:`, details.reason);
      this.emitState(info.windowId);
    });

    wc.on('context-menu', (_ev, params) => {
      const selected = (params.selectionText || '').trim();
      const menu = Menu.buildFromTemplate([
        {
          label: 'Ask HAYA about this page',
          click: () => this.emitContextAction('ask_page', info.id, info.url, selected)
        },
        {
          label: 'Summarize this page',
          click: () => this.emitContextAction('summarize_page', info.id, info.url, selected)
        },
        ...(selected
          ? [
              {
                label: 'Explain selected text',
                click: () => this.emitContextAction('explain_selection', info.id, info.url, selected)
              },
              {
                label: 'Translate selected text',
                click: () => this.emitContextAction('translate_selection', info.id, info.url, selected)
              }
            ]
          : []),
        {
          label: 'Extract information',
          click: () => this.emitContextAction('extract_info', info.id, info.url, selected)
        },
        { type: 'separator' },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Inspect Element (DevTools)',
          click: () => {
            if (!wc.isDestroyed()) wc.inspectElement(params.x, params.y);
          }
        }
      ]);
      const winMeta = this.windows.get(info.windowId);
      if (winMeta && !winMeta.win.isDestroyed()) {
        menu.popup({ window: winMeta.win });
      }
    });
  }

  private emitContextAction(action: string, tabId: string, url: string, selectedText?: string): void {
    for (const cb of this.contextActionListeners) {
      cb(action, { tabId, url, selectedText });
    }
  }

  public activateTab(tabId: string): boolean {
    const managed = this.tabs.get(tabId);
    if (!managed) return false;
    managed.info.lastActiveAt = Date.now();
    this.activeTabByWindow.set(managed.info.windowId, tabId);
    this.relayoutWindow(managed.info.windowId);
    this.emitState(managed.info.windowId);
    return true;
  }

  public closeTab(tabId: string): boolean {
    const managed = this.tabs.get(tabId);
    if (!managed) return false;
    const { windowId } = managed.info;

    if (!managed.info.isPrivate) {
      this.closedStack.push({
        id: managed.info.id,
        url: managed.info.url,
        title: managed.info.title,
        favicon: managed.info.favicon,
        isPinned: managed.info.isPinned,
        groupId: managed.info.groupId,
        closedAt: Date.now()
      });
      if (this.closedStack.length > 30) {
        this.closedStack.shift();
      }
    }

    const windowTabs = this.getTabsForWindow(windowId);
    const closingIdx = windowTabs.findIndex((t) => t.id === tabId);

    this.destroyTabView(tabId);

    const remaining = this.getTabsForWindow(windowId);
    if (remaining.length === 0) {
      this.createTab(windowId, { url: 'lavray://newtab', activate: true });
      return true;
    }

    if (this.activeTabByWindow.get(windowId) === tabId) {
      const next = remaining[Math.min(closingIdx, remaining.length - 1)];
      this.activateTab(next.id);
    } else {
      this.reindexWindowTabs(windowId);
      this.emitState(windowId);
    }
    return true;
  }

  private destroyTabView(tabId: string): void {
    const managed = this.tabs.get(tabId);
    if (!managed) return;
    const winMeta = this.windows.get(managed.info.windowId);
    try {
      if (winMeta && !winMeta.win.isDestroyed()) {
        winMeta.win.contentView.removeChildView(managed.view);
      }
      if (!managed.view.webContents.isDestroyed()) {
        managed.view.webContents.close({ waitForBeforeUnload: false });
      }
    } catch {
      // ignore teardown errors
    }
    this.tabs.delete(tabId);
    this.tabOrder = this.tabOrder.filter((id) => id !== tabId);
  }

  public restoreClosedTab(windowId: number): TabInfo | null {
    const last = this.closedStack.pop();
    if (!last) return null;
    return this.createTab(windowId, {
      url: last.url,
      isPinned: last.isPinned,
      groupId: last.groupId,
      activate: true
    });
  }

  public duplicateTab(tabId: string): TabInfo | null {
    const managed = this.tabs.get(tabId);
    if (!managed) return null;
    return this.createTab(managed.info.windowId, {
      url: managed.info.url,
      groupId: managed.info.groupId,
      activate: true
    });
  }

  public reorderTab(tabId: string, newIndex: number): boolean {
    const managed = this.tabs.get(tabId);
    if (!managed) return false;
    const windowTabs = this.getTabsForWindow(managed.info.windowId).map((t) => t.id);
    const oldIdx = windowTabs.indexOf(tabId);
    if (oldIdx === -1) return false;
    windowTabs.splice(oldIdx, 1);
    const clamped = Math.max(0, Math.min(newIndex, windowTabs.length));
    windowTabs.splice(clamped, 0, tabId);

    // Rebuild global tabOrder preserving other windows
    const otherIds = this.tabOrder.filter((id) => !windowTabs.includes(id));
    this.tabOrder = [...otherIds, ...windowTabs];
    this.reindexWindowTabs(managed.info.windowId);
    this.emitState(managed.info.windowId);
    return true;
  }

  private reindexWindowTabs(windowId: number): void {
    const list = this.getTabsForWindow(windowId);
    list.forEach((t, idx) => {
      const m = this.tabs.get(t.id);
      if (m) m.info.orderIndex = idx;
    });
  }

  public togglePin(tabId: string): TabInfo | null {
    const m = this.tabs.get(tabId);
    if (!m) return null;
    m.info.isPinned = !m.info.isPinned;
    this.emitState(m.info.windowId);
    return { ...m.info };
  }

  public toggleMute(tabId: string): TabInfo | null {
    const m = this.tabs.get(tabId);
    if (!m) return null;
    m.info.isMuted = !m.info.isMuted;
    if (!m.view.webContents.isDestroyed()) {
      m.view.webContents.setAudioMuted(m.info.isMuted);
    }
    this.emitState(m.info.windowId);
    return { ...m.info };
  }

  public renameTab(tabId: string, customTitle: string | null): TabInfo | null {
    const m = this.tabs.get(tabId);
    if (!m) return null;
    m.info.customTitle = customTitle?.trim() || null;
    this.emitState(m.info.windowId);
    return { ...m.info };
  }

  public setAgentActive(tabId: string, active: boolean): void {
    const m = this.tabs.get(tabId);
    if (!m) return;
    m.info.agentActive = active;
    this.emitState(m.info.windowId);
  }

  public createGroup(title: string, color = '#3b82f6'): TabGroup {
    const group: TabGroup = {
      id: randomUUID(),
      title: title.trim() || 'Group',
      color,
      collapsed: false,
      createdAt: Date.now()
    };
    this.groups.set(group.id, group);
    for (const windowId of this.windows.keys()) {
      this.emitState(windowId);
    }
    return group;
  }

  public updateGroup(groupId: string, patch: Partial<Pick<TabGroup, 'title' | 'color' | 'collapsed'>>): TabGroup | null {
    const g = this.groups.get(groupId);
    if (!g) return null;
    Object.assign(g, patch);
    for (const windowId of this.windows.keys()) {
      this.emitState(windowId);
    }
    return { ...g };
  }

  public assignTabToGroup(tabId: string, groupId: string | null): boolean {
    const m = this.tabs.get(tabId);
    if (!m) return false;
    m.info.groupId = groupId;
    this.emitState(m.info.windowId);
    return true;
  }

  public listGroups(): TabGroup[] {
    return Array.from(this.groups.values());
  }

  public restoreGroups(groups: TabGroup[]): void {
    for (const g of groups) {
      this.groups.set(g.id, g);
    }
  }

  public async navigate(tabId: string, input: string): Promise<string> {
    const m = this.tabs.get(tabId);
    if (!m) throw new Error(`Tab not found: ${tabId}`);
    const searchEngine = this.platformRepo.getSetting<SearchEngineId>('browser.searchEngine', 'lavray');
    const targetUrl = resolveNavigationInput(input, searchEngine);
    if (!isAllowedNavigationUrl(targetUrl)) {
      throw new Error(`Blocked unsafe URL protocol: ${targetUrl}`);
    }
    if (m.info.crashed) {
      m.view.webContents.reload();
    }
    if (isInternalLavrayUrl(targetUrl)) {
      m.info.url = targetUrl;
      m.info.title = getInternalLavrayTitle(targetUrl);
      m.info.favicon = null;
      m.info.securityState = 'internal';
      m.info.isLoading = false;
      await m.view.webContents.loadURL('about:blank');
      this.emitState(m.info.windowId);
      return targetUrl;
    }
    if (isInternalLavrayUrl(m.info.url)) {
      m.info.url = targetUrl;
    }
    await m.view.webContents.loadURL(targetUrl);
    return m.view.webContents.getURL() || targetUrl;
  }

  public goBack(tabId: string): boolean {
    const wc = this.getWebContents(tabId);
    if (!wc) return false;
    if (wc.navigationHistory?.canGoBack() ?? wc.canGoBack()) {
      wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack();
      return true;
    }
    return false;
  }

  public goForward(tabId: string): boolean {
    const wc = this.getWebContents(tabId);
    if (!wc) return false;
    if (wc.navigationHistory?.canGoForward() ?? wc.canGoForward()) {
      wc.navigationHistory ? wc.navigationHistory.goForward() : wc.goForward();
      return true;
    }
    return false;
  }

  public reload(tabId: string): void {
    const m = this.tabs.get(tabId);
    if (!m || m.view.webContents.isDestroyed()) return;
    m.info.crashed = false;
    m.view.webContents.reload();
  }

  public stop(tabId: string): void {
    const wc = this.getWebContents(tabId);
    wc?.stop();
  }

  public setZoom(tabId: string, mode: 'in' | 'out' | 'reset'): number {
    const m = this.tabs.get(tabId);
    if (!m || m.view.webContents.isDestroyed()) return 1;
    let next = m.info.zoomFactor;
    if (mode === 'in') next = Math.min(3.0, Number((next + 0.1).toFixed(2)));
    else if (mode === 'out') next = Math.max(0.3, Number((next - 0.1).toFixed(2)));
    else next = 1.0;
    m.info.zoomFactor = next;
    m.view.webContents.setZoomFactor(next);
    this.emitState(m.info.windowId);
    return next;
  }

  public findInPage(tabId: string, text: string, forward = true, findNext = false): void {
    const wc = this.getWebContents(tabId);
    if (!wc || !text) return;
    wc.findInPage(text, { forward, findNext });
  }

  public stopFindInPage(tabId: string): void {
    const wc = this.getWebContents(tabId);
    wc?.stopFindInPage('clearSelection');
  }

  public openDevTools(tabId: string): void {
    const wc = this.getWebContents(tabId);
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  }

  public printPage(tabId: string): void {
    const wc = this.getWebContents(tabId);
    wc?.print();
  }

  public async viewPageSource(tabId: string): Promise<TabInfo | null> {
    const m = this.tabs.get(tabId);
    if (!m || m.view.webContents.isDestroyed()) return null;
    const url = m.view.webContents.getURL();
    if (!url || !isAllowedNavigationUrl(url)) return null;
    const html = await m.view.webContents.executeJavaScript('document.documentElement.outerHTML', false);
    const escaped = String(html).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sourceDoc = `<!doctype html><html><head><title>Source: ${url.replace(/</g, '')}</title><style>body{margin:0;padding:16px;background:#0f172a;color:#cbd5e1;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}</style></head><body>${escaped}</body></html>`;
    return this.createTab(m.info.windowId, {
      url: `data:text/html;charset=utf-8,${encodeURIComponent(sourceDoc)}`,
      activate: true
    });
  }

  public async extractReaderArticle(tabId: string): Promise<ReaderArticle | null> {
    const m = this.tabs.get(tabId);
    if (!m || m.view.webContents.isDestroyed()) return null;
    const url = m.view.webContents.getURL();
    const html = await m.view.webContents.executeJavaScript('document.documentElement.outerHTML', false);
    return extractReadableArticle(String(html), url);
  }

  public getTab(tabId: string): ManagedTab | undefined {
    return this.tabs.get(tabId);
  }

  public getWebContents(tabId: string): WebContents | null {
    const m = this.tabs.get(tabId);
    if (!m || m.view.webContents.isDestroyed()) return null;
    return m.view.webContents;
  }

  public getActiveTabId(windowId: number): string | null {
    return this.activeTabByWindow.get(windowId) ?? null;
  }

  public getTabsForWindow(windowId: number): TabInfo[] {
    return this.tabOrder
      .map((id) => this.tabs.get(id))
      .filter((t): t is ManagedTab => Boolean(t && t.info.windowId === windowId))
      .sort((a, b) => Number(b.info.isPinned) - Number(a.info.isPinned))
      .map((t) => ({ ...t.info }));
  }

  public getAllTabs(): TabInfo[] {
    return this.tabOrder
      .map((id) => this.tabs.get(id))
      .filter((t): t is ManagedTab => Boolean(t))
      .map((t) => ({ ...t.info }));
  }

  public getAllNonPrivateTabs(): TabInfo[] {
    return this.getAllTabs().filter((t) => !t.isPrivate);
  }

  public getDefaultWindowId(): number | null {
    for (const [id, meta] of this.windows.entries()) {
      if (!meta.isPrivate && !meta.win.isDestroyed()) return id;
    }
    const first = this.windows.keys().next();
    return first.done ? null : first.value;
  }
}

export function resolveContentPreloadPath(): string {
  const candidates = [
    path.join(__dirname, '../preload/content-preload.js'),
    path.join(process.cwd(), 'dist/preload/content-preload.js')
  ];
  for (const c of candidates) {
    if (require('node:fs').existsSync(c)) return c;
  }
  return candidates[0];
}

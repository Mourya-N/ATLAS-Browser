import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AgentStartRunSchema,
  CloudAuthSchema,
  ConfirmationRespondSchema,
  ContentSelectionSchema,
  DomainRuleSetSchema,
  IPC_CHANNELS,
  LayoutSchema,
  NavGoSchema,
  SearchExecuteSchema,
  SettingsSetApiKeySchema,
  TabCreateSchema,
  TabIdSchema,
  TabRenameSchema,
  TabReorderSchema
} from '@shared/ipc-channels';
import {
  DEFAULT_CLOUD_CONSENT,
  type AppSettings,
  type McpConfig,
  type MemoryCategory,
  type ProviderStatusInfo,
  type Skill
} from '@shared/types';
import { DEFAULT_MODEL_PRICING } from '@shared/pricing';
import { analyzePageTrust } from '@main/security/trust-analyzer';
import type { GeminiProvider } from '@main/agent/providers/gemini-provider';
import type { SelfHostedOpenAiProvider } from '@main/agent/providers/self-hosted-provider';
import type { ResearchEngine } from '@main/agent/research-engine';
import type { PageUnderstandingEngine } from '@main/agent/page-understanding';
import type { CrossTabIntelligence } from '@main/agent/cross-tab';
import type { ProactiveAssistant } from '@main/agent/proactive-assistant';
import type { CloudClientService } from '@main/cloud/cloud-client';
import { validateIpcPayload, validateIpcSender, type TrustedSenderPolicy } from '@main/security/ipc-validator';
import type { WindowManager } from '@main/window-manager';
import type { TabManager } from '@main/browser/tab-manager';
import { getOmniboxSuggestions } from '@main/browser/navigation';
import type { BrowserRepository } from '@main/db/repositories/browser-repo';
import type { AgentRepository } from '@main/db/repositories/agent-repo';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import type { DownloadManager } from '@main/browser/download-manager';
import type { AdBlocker } from '@main/browser/ad-blocker';
import { DEFAULT_BUDGETS, type AgentOrchestrator } from '@main/agent/orchestrator';
import type { PermissionGate } from '@main/security/permission-gate';
import type { KillSwitch } from '@main/security/kill-switch';
import type { AuditLogger } from '@main/security/audit-logger';
import type { SkillRecorder } from '@main/skills/skill-recorder';
import type { SkillRunner } from '@main/skills/skill-runner';
import type { MemoryService } from '@main/memory/memory-service';
import type { StructuredExtractionEngine } from '@main/agent/extraction-engine';
import type { JobScheduler } from '@main/scheduler/job-scheduler';
import { DEFAULT_MCP_CONFIG, type LocalMcpServer } from '@main/mcp/mcp-server';
import type { SecretVault } from '@main/security/secrets';
import type { CDPManager } from '@main/cdp/cdp-manager';
import type { ElementResolver } from '@main/cdp/element-resolver';
import type { PerceptionEngine } from '@main/cdp/perception';

export interface MainServices {
  windowManager: WindowManager;
  tabManager: TabManager;
  browserRepo: BrowserRepository;
  agentRepo: AgentRepository;
  platformRepo: PlatformRepository;
  downloadManager: DownloadManager;
  adBlocker: AdBlocker;
  orchestrator: AgentOrchestrator;
  permissionGate: PermissionGate;
  killSwitch: KillSwitch;
  auditLogger: AuditLogger;
  skillRecorder: SkillRecorder;
  skillRunner: SkillRunner;
  memoryService: MemoryService;
  extractionEngine: StructuredExtractionEngine;
  researchEngine?: ResearchEngine;
  pageUnderstanding?: PageUnderstandingEngine;
  crossTab?: CrossTabIntelligence;
  proactiveAssistant?: ProactiveAssistant;
  geminiProvider?: GeminiProvider;
  selfHostedProvider?: SelfHostedOpenAiProvider;
  cloudClient?: CloudClientService;
  scheduler: JobScheduler;
  mcpServer: LocalMcpServer;
  vault: SecretVault;
  cdp: CDPManager;
  resolver: ElementResolver;
  perception: PerceptionEngine;
  screenshotsDir: string;
}

export function registerAllIpcHandlers(services: MainServices): void {
  const {
    windowManager,
    tabManager,
    browserRepo,
    agentRepo,
    platformRepo,
    downloadManager,
    adBlocker,
    orchestrator,
    permissionGate,
    killSwitch,
    auditLogger,
    skillRecorder,
    skillRunner,
    memoryService,
    extractionEngine,
    researchEngine,
    pageUnderstanding,
    crossTab,
    proactiveAssistant,
    geminiProvider,
    selfHostedProvider,
    cloudClient,
    scheduler,
    mcpServer,
    vault,
    cdp,
    resolver,
    perception,
    screenshotsDir
  } = services;

  const devUrl = process.env.ATLAS_DEV_SERVER_URL;
  const allowOrigins = ['file://', ...(devUrl ? [devUrl] : [])];

  function handleTrusted<T = unknown>(
    channel: string,
    handler: (
      event: Electron.IpcMainInvokeEvent,
      payload: T,
      senderWindow: Electron.BrowserWindow
    ) => unknown | Promise<unknown>
  ): void {
    ipcMain.handle(channel, async (event, payload) => {
      const senderWin = windowManager.getWindowByWebContentsId(event.sender.id);
      const policy: TrustedSenderPolicy = {
        trustedWebContentsId: () => senderWin?.webContents.id ?? null,
        allowOrigins
      };
      const check = validateIpcSender(event, policy);
      if (!check.valid || !senderWin) {
        throw new Error(check.reason || 'Unauthorized IPC caller');
      }
      return handler(event, payload as T, senderWin);
    });
  }

  const broadcastToUi = (channel: string, data: unknown) => {
    for (const id of windowManager.getTrustedWebContentsIds()) {
      const win = windowManager.getWindowByWebContentsId(id);
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  };

  // Push main-process events to renderer UI
  tabManager.onStateChanged((windowId) => {
    for (const id of windowManager.getTrustedWebContentsIds()) {
      const win = windowManager.getWindowByWebContentsId(id);
      if (win && win.id === windowId && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.TAB_STATE_CHANGED, {
          tabs: tabManager.getTabsForWindow(windowId),
          activeTabId: tabManager.getActiveTabId(windowId),
          groups: tabManager.listGroups()
        });
      }
    }
  });

  tabManager.onContextAction((action, payload) => {
    broadcastToUi(IPC_CHANNELS.CONTENT_CONTEXT_ACTION, { action, ...payload });
  });

  downloadManager.onUpdate((item) => {
    broadcastToUi(IPC_CHANNELS.DOWNLOAD_UPDATED, item);
  });

  orchestrator.onEvent((ev) => {
    broadcastToUi(IPC_CHANNELS.AGENT_RUN_EVENT, ev);
    if (ev.type === 'hitl_paused') {
      broadcastToUi(IPC_CHANNELS.AGENT_HITL_PAUSE, ev.pause);
    }
  });

  permissionGate.setPrompter(async (req) => {
    broadcastToUi(IPC_CHANNELS.AGENT_CONFIRMATION_REQUEST, req);
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (killSwitch.isTriggered()) {
          clearInterval(checkInterval);
          resolve({ requestId: req.id, approved: false });
        }
      }, 250);
      // Resolved via IPC_CHANNELS.AGENT_CONFIRMATION_RESPOND inside PermissionGate
      const origResolve = permissionGate.resolveConfirmation.bind(permissionGate);
      void origResolve;
      // PermissionGate itself awaits the map entry; we just notify UI here and return a never-settling
      // placeholder? No — PermissionGate wraps prompter() in a Promise. So we wait on an internal event:
      confirmationBridges.set(req.id, (resp) => {
        clearInterval(checkInterval);
        resolve(resp);
      });
    });
  });

  const confirmationBridges = new Map<string, (resp: { requestId: string; approved: boolean; rememberForDomain?: boolean; domainRuleMode?: 'allow' | 'deny' | 'read_only' | 'interact' }) => void>();

  // Untrusted content preload only sends selection coords -> forwarded to trusted UI shell
  ipcMain.on(IPC_CHANNELS.CONTENT_SELECTION, (event, rawPayload) => {
    const parsed = ContentSelectionSchema.safeParse(rawPayload);
    if (!parsed.success) return;
    const allTabs = tabManager.getAllTabs();
    const matched = allTabs.find((t) => {
      const wc = tabManager.getWebContents(t.id);
      return wc && wc.id === event.sender.id;
    });
    if (!matched) return;
    const win = windowManager.getWindowByWebContentsId(
      windowManager.getTrustedWebContentsIds()[0] ?? -1
    );
    const targetWin = Array.from(windowManager.getTrustedWebContentsIds())
      .map((id) => windowManager.getWindowByWebContentsId(id))
      .find((w) => w && w.id === matched.windowId);
    (targetWin ?? win)?.webContents.send(IPC_CHANNELS.CONTENT_SELECTION, {
      tabId: matched.id,
      ...parsed.data
    });
  });

  // --- Tabs & Window ---
  handleTrusted(IPC_CHANNELS.TAB_LIST, (_e, _p, win) => ({
    tabs: tabManager.getTabsForWindow(win.id),
    activeTabId: tabManager.getActiveTabId(win.id),
    groups: tabManager.listGroups(),
    isPrivate: windowManager.isPrivateWindow(win.id)
  }));

  handleTrusted(IPC_CHANNELS.TAB_CREATE, (_e, p, win) => {
    const data = validateIpcPayload(TabCreateSchema, p ?? {});
    return tabManager.createTab(win.id, data);
  });

  handleTrusted(IPC_CHANNELS.TAB_CLOSE, (_e, p) => {
    const { tabId } = validateIpcPayload(TabIdSchema, p);
    return tabManager.closeTab(tabId);
  });

  handleTrusted(IPC_CHANNELS.TAB_ACTIVATE, (_e, p) => {
    const { tabId } = validateIpcPayload(TabIdSchema, p);
    return tabManager.activateTab(tabId);
  });

  handleTrusted(IPC_CHANNELS.TAB_REORDER, (_e, p) => {
    const { tabId, newIndex } = validateIpcPayload(TabReorderSchema, p);
    return tabManager.reorderTab(tabId, newIndex);
  });

  handleTrusted(IPC_CHANNELS.TAB_DUPLICATE, (_e, p) => {
    const { tabId } = validateIpcPayload(TabIdSchema, p);
    return tabManager.duplicateTab(tabId);
  });

  handleTrusted(IPC_CHANNELS.TAB_PIN, (_e, p) => {
    const { tabId } = validateIpcPayload(TabIdSchema, p);
    return tabManager.togglePin(tabId);
  });

  handleTrusted(IPC_CHANNELS.TAB_MUTE, (_e, p) => {
    const { tabId } = validateIpcPayload(TabIdSchema, p);
    return tabManager.toggleMute(tabId);
  });

  handleTrusted(IPC_CHANNELS.TAB_RENAME, (_e, p) => {
    const { tabId, customTitle } = validateIpcPayload(TabRenameSchema, p);
    return tabManager.renameTab(tabId, customTitle);
  });

  handleTrusted(IPC_CHANNELS.TAB_RESTORE_CLOSED, (_e, _p, win) => tabManager.restoreClosedTab(win.id));
  handleTrusted(IPC_CHANNELS.TAB_GROUPS_LIST, () => tabManager.listGroups());
  handleTrusted(IPC_CHANNELS.TAB_GROUP_CREATE, (_e, p: { title: string; color?: string }) =>
    tabManager.createGroup(String(p.title || 'Group'), p.color)
  );
  handleTrusted(IPC_CHANNELS.TAB_GROUP_UPDATE, (_e, p: { groupId: string; title?: string; color?: string; collapsed?: boolean }) =>
    tabManager.updateGroup(p.groupId, { title: p.title, color: p.color, collapsed: p.collapsed })
  );
  handleTrusted(IPC_CHANNELS.TAB_GROUP_ASSIGN, (_e, p: { tabId: string; groupId: string | null }) =>
    tabManager.assignTabToGroup(p.tabId, p.groupId)
  );
  handleTrusted(IPC_CHANNELS.WINDOW_NEW_PRIVATE, () => {
    const privWin = windowManager.createWindow({ isPrivate: true });
    return { windowId: privWin.id };
  });
  handleTrusted(IPC_CHANNELS.WINDOW_SET_LAYOUT, (_e, p, win) => {
    const layout = validateIpcPayload(LayoutSchema, p);
    tabManager.setLayout(win.id, layout);
    return true;
  });

  // --- Navigation & Controls ---
  handleTrusted(IPC_CHANNELS.NAV_GO, async (_e, p) => {
    const { tabId, input } = validateIpcPayload(NavGoSchema, p);
    return tabManager.navigate(tabId, input);
  });
  handleTrusted(IPC_CHANNELS.NAV_BACK, (_e, p) => tabManager.goBack(validateIpcPayload(TabIdSchema, p).tabId));
  handleTrusted(IPC_CHANNELS.NAV_FORWARD, (_e, p) => tabManager.goForward(validateIpcPayload(TabIdSchema, p).tabId));
  handleTrusted(IPC_CHANNELS.NAV_RELOAD, (_e, p) => tabManager.reload(validateIpcPayload(TabIdSchema, p).tabId));
  handleTrusted(IPC_CHANNELS.NAV_STOP, (_e, p) => tabManager.stop(validateIpcPayload(TabIdSchema, p).tabId));
  handleTrusted(IPC_CHANNELS.NAV_HOME, async (_e, p) => {
    const { tabId } = validateIpcPayload(TabIdSchema, p);
    const homeUrl = platformRepo.getSetting<string>('browser.homeUrl', 'atlas://newtab');
    return tabManager.navigate(tabId, homeUrl);
  });
  handleTrusted(IPC_CHANNELS.NAV_SUGGESTIONS, (_e, p: { query: string }) => {
    const engine = platformRepo.getSetting<'google' | 'duckduckgo' | 'bing' | 'brave' | 'startpage'>(
      'browser.searchEngine',
      'google'
    );
    return getOmniboxSuggestions(browserRepo, String(p?.query || ''), engine);
  });
  handleTrusted(IPC_CHANNELS.BROWSER_ZOOM, (_e, p: { tabId: string; mode: 'in' | 'out' | 'reset' }) =>
    tabManager.setZoom(p.tabId, p.mode)
  );
  handleTrusted(
    IPC_CHANNELS.BROWSER_FIND,
    (_e, p: { tabId: string; text: string; forward?: boolean; findNext?: boolean }) =>
      tabManager.findInPage(p.tabId, p.text, p.forward ?? true, p.findNext ?? false)
  );
  handleTrusted(IPC_CHANNELS.BROWSER_FIND_STOP, (_e, p) =>
    tabManager.stopFindInPage(validateIpcPayload(TabIdSchema, p).tabId)
  );
  handleTrusted(IPC_CHANNELS.BROWSER_DEVTOOLS, (_e, p) =>
    tabManager.openDevTools(validateIpcPayload(TabIdSchema, p).tabId)
  );
  handleTrusted(IPC_CHANNELS.BROWSER_PRINT, (_e, p) =>
    tabManager.printPage(validateIpcPayload(TabIdSchema, p).tabId)
  );
  handleTrusted(IPC_CHANNELS.BROWSER_VIEW_SOURCE, (_e, p) =>
    tabManager.viewPageSource(validateIpcPayload(TabIdSchema, p).tabId)
  );
  handleTrusted(IPC_CHANNELS.BROWSER_FULLSCREEN, (_e, _p, win) => {
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });
  handleTrusted(IPC_CHANNELS.BROWSER_READER_EXTRACT, (_e, p) =>
    tabManager.extractReaderArticle(validateIpcPayload(TabIdSchema, p).tabId)
  );

  // --- History & Bookmarks ---
  handleTrusted(IPC_CHANNELS.HISTORY_LIST, (_e, p: { query?: string }) =>
    browserRepo.searchHistory(p?.query ?? '', 150)
  );
  handleTrusted(IPC_CHANNELS.HISTORY_DELETE, (_e, p: { id: string }) => browserRepo.deleteHistoryItem(p.id));
  handleTrusted(IPC_CHANNELS.HISTORY_CLEAR, () => browserRepo.clearHistory());
  handleTrusted(IPC_CHANNELS.HISTORY_TOP_SITES, () => browserRepo.getTopSites(8));

  handleTrusted(IPC_CHANNELS.BOOKMARK_LIST, (_e, p: { query?: string }) =>
    browserRepo.listBookmarks(p?.query ?? '')
  );
  handleTrusted(
    IPC_CHANNELS.BOOKMARK_ADD,
    (_e, p: { url: string; title: string; folderId?: string | null }) =>
      browserRepo.addBookmark(p.url, p.title, p.folderId)
  );
  handleTrusted(
    IPC_CHANNELS.BOOKMARK_UPDATE,
    (_e, p: { id: string; title?: string; url?: string; folderId?: string | null }) =>
      browserRepo.updateBookmark(p.id, p)
  );
  handleTrusted(IPC_CHANNELS.BOOKMARK_DELETE, (_e, p: { id: string }) => browserRepo.deleteBookmark(p.id));
  handleTrusted(IPC_CHANNELS.BOOKMARK_FOLDER_CREATE, (_e, p: { name: string }) =>
    browserRepo.createBookmarkFolder(p.name)
  );
  handleTrusted(IPC_CHANNELS.READING_LIST_LIST, () => browserRepo.listReadingList());
  handleTrusted(
    IPC_CHANNELS.READING_LIST_SAVE,
    (_e, p: { tabId?: string; url: string; title: string; siteName?: string | null; excerpt?: string | null; progress?: number }) => {
      if (p.tabId) {
        const tab = tabManager.getTab(p.tabId);
        if (tab?.info.isPrivate) {
          throw new Error('Private browsing pages are not saved to the persistent Reading List');
        }
      }
      return browserRepo.saveReadingListItem(p);
    }
  );
  handleTrusted(
    IPC_CHANNELS.READING_LIST_UPDATE,
    (_e, p: { id: string; status?: 'unread' | 'reading' | 'read'; progress?: number }) =>
      browserRepo.updateReadingListStatus(p.id, p)
  );
  handleTrusted(IPC_CHANNELS.READING_LIST_DELETE, (_e, p: { id: string }) =>
    browserRepo.deleteReadingListItem(p.id)
  );

  // --- Downloads & AdBlocker ---
  handleTrusted(IPC_CHANNELS.DOWNLOAD_LIST, () => downloadManager.listDownloads());
  handleTrusted(
    IPC_CHANNELS.DOWNLOAD_ACTION,
    (_e, p: { id: string; action: 'pause' | 'resume' | 'cancel' | 'open' | 'reveal' }) =>
      downloadManager.performAction(p.id, p.action)
  );
  handleTrusted(IPC_CHANNELS.ADBLOCK_STATS, () => adBlocker.getStats());
  handleTrusted(IPC_CHANNELS.ADBLOCK_TOGGLE_GLOBAL, (_e, p: { enabled: boolean }) => {
    adBlocker.setGlobalEnabled(Boolean(p.enabled));
    return adBlocker.getStats();
  });
  handleTrusted(IPC_CHANNELS.ADBLOCK_TOGGLE_DOMAIN, (_e, p: { domain: string; allow: boolean }) => {
    adBlocker.toggleDomainAllowlist(p.domain, Boolean(p.allow));
    return adBlocker.getStats();
  });
  handleTrusted(IPC_CHANNELS.ADBLOCK_TOGGLE_TEMP_DOMAIN, (_e, p: { domain: string; disabled: boolean }) => {
    adBlocker.toggleTemporaryDisable(p.domain, Boolean(p.disabled));
    return adBlocker.getStats();
  });
  handleTrusted(IPC_CHANNELS.ADBLOCK_TOGGLE_COSMETIC, (_e, p: { enabled: boolean }) => {
    adBlocker.cosmetic.setEnabled(Boolean(p.enabled));
    return adBlocker.getStats();
  });
  handleTrusted(IPC_CHANNELS.ADBLOCK_TOGGLE_COSMETIC_DOMAIN, (_e, p: { domain: string; disabled: boolean }) => {
    adBlocker.cosmetic.toggleDomainDisabled(p.domain, Boolean(p.disabled));
    return adBlocker.getStats();
  });
  handleTrusted(IPC_CHANNELS.ADBLOCK_ADD_RULE, (_e, p: { rule: string }) => {
    const added = adBlocker.addUserFilterRule(p.rule);
    return { added, stats: adBlocker.getStats() };
  });
  handleTrusted(IPC_CHANNELS.ADBLOCK_REMOVE_RULE, (_e, p: { rule: string }) => {
    adBlocker.removeUserFilterRule(p.rule);
    return adBlocker.getStats();
  });
  handleTrusted(IPC_CHANNELS.ADBLOCK_UPDATE_LISTS, async () => {
    await adBlocker.updateFilterLists();
    return adBlocker.getStats();
  });
  handleTrusted(IPC_CHANNELS.ADBLOCK_TOGGLE_LIST, (_e, p: { listId: string; enabled: boolean }) => {
    adBlocker.toggleFilterList(p.listId, Boolean(p.enabled));
    return adBlocker.getStats();
  });
  handleTrusted(IPC_CHANNELS.ADBLOCK_REPORT_BROKEN, (_e, p: { url: string; reason?: string }) => {
    adBlocker.reportBrokenSite(p.url, p.reason);
    return adBlocker.getStats();
  });

  handleTrusted(IPC_CHANNELS.SECURITY_ANALYZE_TRUST, async (_e, p: { tabId: string }) => {
    const tab = tabManager.getTab(p.tabId);
    if (!tab) return analyzePageTrust('');
    const wc = tabManager.getWebContents(p.tabId);
    let pageSignals: {
      hasPasswordField?: boolean;
      hasExternalFormAction?: boolean;
      externalFormHost?: string;
    } = {};
    if (wc && !wc.isDestroyed() && tab.info.url.startsWith('http')) {
      try {
        pageSignals = await wc.executeJavaScript(`
          (() => {
            const pw = document.querySelector('input[type="password"]');
            let hasExternalFormAction = false;
            let externalFormHost = '';
            if (pw && pw.form && pw.form.action) {
              try {
                const actionHost = new URL(pw.form.action, location.href).hostname.toLowerCase();
                if (actionHost && actionHost !== location.hostname.toLowerCase()) {
                  hasExternalFormAction = true;
                  externalFormHost = actionHost;
                }
              } catch {}
            }
            return { hasPasswordField: Boolean(pw), hasExternalFormAction, externalFormHost };
          })()
        `);
      } catch {
        // non-fatal
      }
    }
    return analyzePageTrust(tab.info.url, pageSignals);
  });

  // --- Agent ---
  handleTrusted(IPC_CHANNELS.AGENT_LIST_CONVERSATIONS, () => agentRepo.listConversations());
  handleTrusted(IPC_CHANNELS.AGENT_CREATE_CONVERSATION, (_e, p: { title?: string }) =>
    agentRepo.createConversation(p?.title || 'New Conversation')
  );
  handleTrusted(IPC_CHANNELS.AGENT_GET_MESSAGES, (_e, p: { conversationId: string }) =>
    agentRepo.getMessages(p.conversationId)
  );
  handleTrusted(IPC_CHANNELS.AGENT_CLEAR_CONVERSATION, (_e, p: { conversationId: string }) =>
    agentRepo.clearConversation(p.conversationId)
  );
  handleTrusted(IPC_CHANNELS.AGENT_START_RUN, (_e, p) => {
    const data = validateIpcPayload(AgentStartRunSchema, p);
    return orchestrator.startRun(data);
  });
  handleTrusted(IPC_CHANNELS.AGENT_PAUSE_RUN, (_e, p: { runId: string }) => orchestrator.pauseRun(p.runId));
  handleTrusted(IPC_CHANNELS.AGENT_RESUME_RUN, (_e, p: { runId: string }) => orchestrator.resumeRun(p.runId));
  handleTrusted(IPC_CHANNELS.AGENT_STOP_RUN, (_e, p: { runId: string }) => orchestrator.stopRun(p.runId));
  handleTrusted(IPC_CHANNELS.AGENT_TAKEOVER, (_e, p: { runId: string }) => {
    orchestrator.setMode(p.runId, 'takeover');
    return orchestrator.pauseRun(p.runId, 'user_takeover', 'User took manual control of browser.');
  });
  handleTrusted(IPC_CHANNELS.AGENT_SET_MODE, (_e, p: { runId: string; mode: 'ask' | 'assist' | 'agent' | 'takeover' }) =>
    orchestrator.setMode(p.runId, p.mode)
  );
  handleTrusted(IPC_CHANNELS.AGENT_LIST_RUNS, () => agentRepo.listRuns(80));
  handleTrusted(IPC_CHANNELS.AGENT_GET_RUN, (_e, p: { runId: string }) => agentRepo.getRun(p.runId));
  handleTrusted(IPC_CHANNELS.AGENT_READ_SCREENSHOT, (_e, p: { filePath: string }) => {
    const resolved = path.resolve(String(p.filePath || ''));
    const root = path.resolve(screenshotsDir);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) return null;
    const b64 = fs.readFileSync(resolved).toString('base64');
    return `data:image/png;base64,${b64}`;
  });
  handleTrusted(IPC_CHANNELS.AGENT_CONFIRMATION_RESPOND, (_e, p) => {
    const resp = validateIpcPayload(ConfirmationRespondSchema, p);
    const bridge = confirmationBridges.get(resp.requestId);
    if (bridge) {
      confirmationBridges.delete(resp.requestId);
      bridge(resp);
    }
    permissionGate.resolveConfirmation(resp);
    return true;
  });
  handleTrusted(IPC_CHANNELS.AGENT_HITL_RESUME, (_e, p: { runId: string }) => orchestrator.resumeRun(p.runId));

  // --- Safety & Audit ---
  handleTrusted(IPC_CHANNELS.KILL_SWITCH_TRIGGER, async () => {
    await killSwitch.trigger('Emergency stop triggered from UI');
    auditLogger.log({
      category: 'kill_switch',
      action: 'emergency_stop',
      actor: 'user',
      details: {}
    });
    return true;
  });
  handleTrusted(IPC_CHANNELS.DOMAIN_RULES_LIST, () => permissionGate.listDomainRules());
  handleTrusted(IPC_CHANNELS.DOMAIN_RULES_SET, (_e, p) => {
    const data = validateIpcPayload(DomainRuleSetSchema, p);
    return permissionGate.setDomainRule(data.domain, data.mode, data.expiresAt);
  });
  handleTrusted(IPC_CHANNELS.DOMAIN_RULES_DELETE, (_e, p: { id: string }) =>
    permissionGate.deleteDomainRule(p.id)
  );
  handleTrusted(IPC_CHANNELS.AUDIT_LIST, (_e, p: { query?: string; category?: string }) =>
    auditLogger.list(p?.query ?? '', p?.category, 250)
  );
  handleTrusted(IPC_CHANNELS.AUDIT_DELETE, (_e, p: { id?: string }) => auditLogger.delete(p?.id));
  handleTrusted(IPC_CHANNELS.AUDIT_EXPORT, () => auditLogger.exportJson());

  // --- Skills, Memory, Extraction, Scheduler ---
  handleTrusted(IPC_CHANNELS.SKILL_LIST, () => platformRepo.listSkills());
  handleTrusted(
    IPC_CHANNELS.SKILL_RECORD_FROM_RUN,
    (_e, p: { runId: string; name?: string; description?: string }) => {
      const run = agentRepo.getRun(p.runId);
      if (!run) throw new Error('Run not found');
      return skillRecorder.recordFromRun(run, { name: p.name, description: p.description });
    }
  );
  handleTrusted(IPC_CHANNELS.SKILL_SAVE, (_e, p: { skill: Skill }) => platformRepo.saveSkill(p.skill));
  handleTrusted(IPC_CHANNELS.SKILL_DELETE, (_e, p: { id: string }) => platformRepo.deleteSkill(p.id));
  handleTrusted(IPC_CHANNELS.SKILL_DUPLICATE, (_e, p: { id: string }) => {
    const src = platformRepo.getSkill(p.id);
    if (!src) throw new Error('Skill not found');
    const now = Date.now();
    return platformRepo.saveSkill({
      ...src,
      id: randomUUID(),
      name: `${src.name} (Copy)`,
      version: 1,
      createdAt: now,
      updatedAt: now,
      executionCount: 0,
      successCount: 0,
      lastExecutedAt: null
    });
  });
  handleTrusted(
    IPC_CHANNELS.SKILL_RUN,
    async (_e, p: { skillId: string; params: Record<string, unknown>; tabId?: string | null }) => {
      const skill = platformRepo.getSkill(p.skillId);
      if (!skill) throw new Error('Skill not found');
      const targetTabId = p.tabId || tabManager.getAllTabs()[0]?.id || '';
      return skillRunner.runSkill({
        skill,
        args: p.params ?? {},
        mode: 'agent',
        createContext: (runId) => {
          const ctx = {
            runId,
            tabId: targetTabId,
            mode: 'agent' as const,
            isPrivate: Boolean(tabManager.getTab(targetTabId)?.info.isPrivate),
            experimentalScriptingEnabled: false,
            tabManager,
            browserRepo,
            cdp,
            resolver,
            perception,
            lastPerception: null as import('@shared/types').PagePerception | null,
            updateLastPerception: (next: import('@shared/types').PagePerception) => {
              ctx.lastPerception = next;
            },
            setActiveTabId: (id: string) => {
              ctx.tabId = id;
            }
          };
          return ctx;
        }
      });
    }
  );
  handleTrusted(IPC_CHANNELS.SKILL_IMPORT, (_e, p: { json: string }) => skillRecorder.importSkillJson(p.json));
  handleTrusted(IPC_CHANNELS.SKILL_EXPORT, (_e, p: { skillId: string }) => skillRecorder.exportSkillJson(p.skillId));
  handleTrusted(IPC_CHANNELS.SKILL_EXECUTIONS, (_e, p: { skillId: string }) =>
    platformRepo.listSkillExecutions(p.skillId)
  );

  handleTrusted(IPC_CHANNELS.MEMORY_LIST, (_e, p: { category?: MemoryCategory }) =>
    memoryService.list(p?.category)
  );
  handleTrusted(IPC_CHANNELS.MEMORY_SEARCH, (_e, p: { query: string }) =>
    memoryService.retrieveRelevant(p.query, null, 20)
  );
  handleTrusted(
    IPC_CHANNELS.MEMORY_SAVE,
    (_e, p: { id?: string; category: MemoryCategory; domain?: string | null; title: string; content: string; confidence?: number }) =>
      memoryService.save({ ...p, source: 'user' })
  );
  handleTrusted(IPC_CHANNELS.MEMORY_DELETE, (_e, p: { id: string }) => memoryService.delete(p.id));
  handleTrusted(IPC_CHANNELS.MEMORY_CLEAR, () => memoryService.clear());
  handleTrusted(IPC_CHANNELS.MEMORY_EXPORT, () => memoryService.exportJson());

  handleTrusted(
    IPC_CHANNELS.EXTRACT_STRUCTURED,
    async (_e, p: { tabId: string; schemaJson: string; instructions: string }) => {
      const wc = tabManager.getWebContents(p.tabId);
      if (!wc) throw new Error('No active tab found');
      const perc = await perception.capture(p.tabId, wc, { includeAxTree: false });
      const schema = JSON.parse(p.schemaJson) as Record<string, unknown>;
      const model = platformRepo.getSetting<string>('agent.defaultModel', 'gemini-2.5-flash');
      return extractionEngine.extract({
        url: perc.url,
        pageTitle: perc.title,
        pageText: perc.mainText,
        tablesSummary: perc.tablesSummary,
        schema,
        instructions: p.instructions,
        model
      });
    }
  );
  handleTrusted(IPC_CHANNELS.EXTRACT_EXPORT_CSV, (_e, p: { records: Array<Record<string, unknown>> }) =>
    extractionEngine.toCsv(p.records || [])
  );

  handleTrusted(IPC_CHANNELS.SCHEDULER_LIST, () => scheduler.listJobs());
  handleTrusted(IPC_CHANNELS.SCHEDULER_SAVE, (_e, p) => scheduler.saveJob(p as Parameters<typeof scheduler.saveJob>[0]));
  handleTrusted(IPC_CHANNELS.SCHEDULER_DELETE, (_e, p: { id: string }) => scheduler.deleteJob(p.id));
  handleTrusted(IPC_CHANNELS.SCHEDULER_TOGGLE, (_e, p: { id: string; enabled?: boolean; paused?: boolean }) =>
    scheduler.toggleJob(p.id, p)
  );
  handleTrusted(IPC_CHANNELS.SCHEDULER_RUN_NOW, async (_e, p: { id: string }) => {
    const job = scheduler.listJobs().find((j) => j.id === p.id);
    if (!job) throw new Error('Scheduled job not found');
    return scheduler.executeJob(job);
  });

  // --- Stats, MCP, Settings ---
  handleTrusted(IPC_CHANNELS.STATS_SUMMARY, () => agentRepo.getCostSummary());
  handleTrusted(IPC_CHANNELS.MCP_STATUS, () => mcpServer.getStatus());
  handleTrusted(IPC_CHANNELS.MCP_CONFIGURE, (_e, p: Partial<McpConfig>) => mcpServer.configure(p));
  handleTrusted(IPC_CHANNELS.MCP_ROTATE_TOKEN, () => {
    vault.rotateMcpToken();
    auditLogger.log({ category: 'mcp', action: 'mcp_token_rotated', actor: 'user', details: {} });
    return mcpServer.getStatus();
  });
  handleTrusted(IPC_CHANNELS.MCP_GET_TOKEN, () => vault.getOrCreateMcpToken());

  const getSettings = (): AppSettings => ({
    theme: platformRepo.getSetting('ui.theme', 'light'),
    searchEngine: platformRepo.getSetting('browser.searchEngine', 'google'),
    homeUrl: platformRepo.getSetting('browser.homeUrl', 'atlas://newtab'),
    downloadDir: downloadManager.getDownloadDir(),
    verticalTabs: platformRepo.getSetting('ui.verticalTabs', false),
    adBlockEnabled: adBlocker.getStats().globalEnabled,
    restoreSessionOnStart: platformRepo.getSetting('browser.restoreSessionOnStart', true),
    retainScreenshots: platformRepo.getSetting('agent.retainScreenshots', true),
    screenshotRetentionDays: platformRepo.getSetting('agent.screenshotRetentionDays', 14),
    experimentalScriptingEnabled: platformRepo.getSetting('security.experimentalScriptingEnabled', false),
    proactiveAssistanceEnabled: platformRepo.getSetting('agent.proactiveAssistanceEnabled', false),
    voiceSpokenResponsesEnabled: platformRepo.getSetting('agent.voiceSpokenResponsesEnabled', false),
    telemetryEnabled: platformRepo.getSetting('privacy.telemetryEnabled', false),
    activeProfileId: platformRepo.getSetting('memory.activeProfileId', 'default'),
    defaultProvider: platformRepo.getSetting('agent.defaultProvider', 'gemini'),
    defaultModel: platformRepo.getSetting('agent.defaultModel', 'gemini-2.5-flash'),
    customEndpointUrl: platformRepo.getSetting('agent.customEndpointUrl', ''),
    selfHostedEndpointUrl: platformRepo.getSetting('agent.selfHostedEndpointUrl', 'http://127.0.0.1:11434/v1'),
    selfHostedModel: platformRepo.getSetting('agent.selfHostedModel', 'qwen2.5:7b-instruct'),
    hasGeminiApiKey: Boolean(vault.getGeminiApiKey()),
    hasSelfHostedApiKey: Boolean(vault.getCustomApiKey()),
    cloudModeEnabled: platformRepo.getSetting('cloud.enabled', false),
    cloudEndpointUrl: platformRepo.getSetting('cloud.endpointUrl', 'http://127.0.0.1:48080'),
    cloudConsent: {
      ...DEFAULT_CLOUD_CONSENT,
      ...platformRepo.getSetting('cloud.consent', DEFAULT_CLOUD_CONSENT)
    },
    budgets: platformRepo.getSetting('agent.budgets', DEFAULT_BUDGETS),
    mcp: platformRepo.getSetting('mcp.config', DEFAULT_MCP_CONFIG)
  });

  handleTrusted(IPC_CHANNELS.SETTINGS_GET, () => getSettings());
  handleTrusted(IPC_CHANNELS.SETTINGS_UPDATE, async (_e, patch: Partial<AppSettings>) => {
    if (patch.theme !== undefined) platformRepo.setSetting('ui.theme', patch.theme);
    if (patch.searchEngine !== undefined) platformRepo.setSetting('browser.searchEngine', patch.searchEngine);
    if (patch.homeUrl !== undefined) platformRepo.setSetting('browser.homeUrl', patch.homeUrl);
    if (patch.downloadDir !== undefined) platformRepo.setSetting('browser.downloadDir', patch.downloadDir);
    if (patch.verticalTabs !== undefined) platformRepo.setSetting('ui.verticalTabs', patch.verticalTabs);
    if (patch.adBlockEnabled !== undefined) adBlocker.setGlobalEnabled(patch.adBlockEnabled);
    if (patch.restoreSessionOnStart !== undefined)
      platformRepo.setSetting('browser.restoreSessionOnStart', patch.restoreSessionOnStart);
    if (patch.retainScreenshots !== undefined)
      platformRepo.setSetting('agent.retainScreenshots', patch.retainScreenshots);
    if (patch.screenshotRetentionDays !== undefined)
      platformRepo.setSetting('agent.screenshotRetentionDays', patch.screenshotRetentionDays);
    if (patch.experimentalScriptingEnabled !== undefined)
      platformRepo.setSetting('security.experimentalScriptingEnabled', patch.experimentalScriptingEnabled);
    if (patch.proactiveAssistanceEnabled !== undefined)
      platformRepo.setSetting('agent.proactiveAssistanceEnabled', patch.proactiveAssistanceEnabled);
    if (patch.voiceSpokenResponsesEnabled !== undefined)
      platformRepo.setSetting('agent.voiceSpokenResponsesEnabled', patch.voiceSpokenResponsesEnabled);
    if (patch.telemetryEnabled !== undefined)
      platformRepo.setSetting('privacy.telemetryEnabled', patch.telemetryEnabled);
    if (patch.activeProfileId !== undefined)
      platformRepo.setSetting('memory.activeProfileId', patch.activeProfileId);
    if (patch.defaultProvider !== undefined)
      platformRepo.setSetting('agent.defaultProvider', patch.defaultProvider);
    if (patch.defaultModel !== undefined) platformRepo.setSetting('agent.defaultModel', patch.defaultModel);
    if (patch.customEndpointUrl !== undefined)
      platformRepo.setSetting('agent.customEndpointUrl', patch.customEndpointUrl);
    if (patch.selfHostedEndpointUrl !== undefined)
      platformRepo.setSetting('agent.selfHostedEndpointUrl', patch.selfHostedEndpointUrl);
    if (patch.selfHostedModel !== undefined)
      platformRepo.setSetting('agent.selfHostedModel', patch.selfHostedModel);
    if (patch.cloudModeEnabled !== undefined)
      platformRepo.setSetting('cloud.enabled', patch.cloudModeEnabled);
    if (patch.cloudEndpointUrl !== undefined)
      platformRepo.setSetting('cloud.endpointUrl', patch.cloudEndpointUrl);
    if (patch.cloudConsent !== undefined)
      platformRepo.setSetting('cloud.consent', patch.cloudConsent);
    if (patch.budgets !== undefined) platformRepo.setSetting('agent.budgets', patch.budgets);
    if (patch.mcp !== undefined) await mcpServer.configure(patch.mcp);
    return getSettings();
  });

  handleTrusted(IPC_CHANNELS.SETTINGS_SET_API_KEY, (_e, p) => {
    const data = validateIpcPayload(SettingsSetApiKeySchema, p);
    if (data.provider === 'gemini') vault.setGeminiApiKey(data.apiKey);
    else vault.setCustomApiKey(data.apiKey);
    auditLogger.log({
      category: 'security',
      action: 'api_key_updated',
      actor: 'user',
      details: { provider: data.provider }
    });
    return getSettings();
  });

  handleTrusted(IPC_CHANNELS.SETTINGS_CLEAR_API_KEY, () => {
    vault.clearGeminiApiKey();
    return getSettings();
  });

  handleTrusted(IPC_CHANNELS.SETTINGS_PROVIDER_STATUS, (): ProviderStatusInfo => {
    const s = getSettings();
    const pricing = DEFAULT_MODEL_PRICING.find((m) => m.model === s.defaultModel);
    const isSelfHosted =
      s.defaultProvider === 'self_hosted' || s.defaultProvider === 'custom_openai_compatible';
    const isLive = s.defaultProvider === 'gemini' || isSelfHosted;
    const activeModel = isSelfHosted ? s.selfHostedModel || s.defaultModel : s.defaultModel;
    return {
      activeProvider: s.defaultProvider,
      model: activeModel,
      endpointUrl: isSelfHosted ? s.selfHostedEndpointUrl || s.customEndpointUrl : undefined,
      isLive,
      hasGeminiKey: s.hasGeminiApiKey,
      hasSelfHostedKey: s.hasSelfHostedApiKey,
      supportsVision: isSelfHosted ? false : pricing?.supportsVision ?? true,
      supportsTools: pricing?.supportsTools ?? true,
      supportsStructuredOutput: pricing?.supportsStructuredOutput ?? true,
      warning:
        s.defaultProvider === 'gemini' && !s.hasGeminiApiKey
          ? 'Gemini is selected but no GEMINI_API_KEY is configured.'
          : isSelfHosted && !(s.selfHostedEndpointUrl || s.customEndpointUrl)
          ? 'Self-hosted provider selected but endpoint URL is empty.'
          : s.defaultProvider === 'mock'
          ? 'Deterministic Mock provider is active (offline/testing only).'
          : undefined
    };
  });

  handleTrusted(IPC_CHANNELS.SETTINGS_TEST_PROVIDER, async (_e, p?: { model?: string }) => {
    const s = getSettings();
    if (s.defaultProvider === 'mock') {
      return {
        ok: true,
        provider: 'mock',
        model: 'mock-deterministic',
        latencyMs: 1,
        capabilities: { tools: true, structuredOutput: true, vision: true }
      };
    }
    if (s.defaultProvider === 'self_hosted' || s.defaultProvider === 'custom_openai_compatible') {
      if (!selfHostedProvider) throw new Error('Self-hosted provider not initialized');
      return selfHostedProvider.testConnection(p?.model || s.selfHostedModel || s.defaultModel);
    }
    if (!geminiProvider) {
      throw new Error('Gemini provider not initialized');
    }
    return geminiProvider.testConnection(p?.model || s.defaultModel);
  });

  handleTrusted(IPC_CHANNELS.SETTINGS_DISCOVER_MODELS, async () => {
    const s = getSettings();
    if (!selfHostedProvider) {
      return {
        backendKind: 'unconfigured',
        endpointUrl: s.selfHostedEndpointUrl || '',
        configuredModel: s.selfHostedModel || '',
        reachable: false,
        modelAvailable: false,
        availableModels: [],
        latencyMs: 0,
        supportsStreaming: true,
        supportsTools: true,
        supportsStructuredOutput: true,
        statusMessage: 'Self-hosted provider unavailable'
      };
    }
    return selfHostedProvider.getRuntimeStatus(s.selfHostedModel || s.defaultModel);
  });

  // --- Checkpoints, Research, Page Understanding, Cross-Tab, Proactive, Skill Test ---
  handleTrusted(IPC_CHANNELS.AGENT_LIST_INTERRUPTED, () => agentRepo.listInterruptedRuns());
  handleTrusted(IPC_CHANNELS.AGENT_RESUME_CHECKPOINT, (_e, p: { runId: string }) =>
    orchestrator.resumeFromCheckpoint(p.runId)
  );

  handleTrusted(
    IPC_CHANNELS.RESEARCH_RUN,
    async (_e, p: { query: string; tabIds?: string[] }) => {
      if (!researchEngine) throw new Error('Research engine unavailable');
      const allowedTabs = (crossTab
        ? crossTab.filterAllowedTabs(tabManager.getAllTabs(), p.tabIds)
        : tabManager.getAllTabs().filter((t) => !t.isPrivate)
      ).slice(0, 8);

      const perceptions = [];
      for (const tab of allowedTabs) {
        const wc = tabManager.getWebContents(tab.id);
        if (!wc) continue;
        try {
          perceptions.push(await perception.capture(tab.id, wc, { includeAxTree: false }));
        } catch {
          // ignore unreadable tab
        }
      }
      const model = platformRepo.getSetting<string>('agent.defaultModel', 'gemini-2.5-flash');
      return researchEngine.buildReport({
        query: p.query,
        sources: researchEngine.sourcesFromPerceptions(perceptions),
        model,
        isPrivate: allowedTabs.some((t) => t.isPrivate)
      });
    }
  );
  handleTrusted(IPC_CHANNELS.RESEARCH_LIST, () => agentRepo.listResearchReports(30));
  handleTrusted(IPC_CHANNELS.RESEARCH_EXPORT_MD, (_e, p: { reportId: string }) => {
    if (!researchEngine) return '';
    const r = agentRepo.getResearchReport(p.reportId);
    return r ? researchEngine.toMarkdown(r) : '';
  });

  handleTrusted(
    IPC_CHANNELS.PAGE_UNDERSTAND,
    async (_e, p: { tabId: string; question: string }) => {
      if (!pageUnderstanding) throw new Error('Page understanding engine unavailable');
      const wc = tabManager.getWebContents(p.tabId);
      if (!wc) throw new Error('Tab not found');
      const perc = await perception.capture(p.tabId, wc, { includeAxTree: false });
      const model = platformRepo.getSetting<string>('agent.defaultModel', 'gemini-2.5-flash');
      return pageUnderstanding.answerQuestion({ perception: perc, question: p.question, model });
    }
  );

  handleTrusted(
    IPC_CHANNELS.PAGE_SEMANTIC_SEARCH,
    async (_e, p: { tabId: string; query: string }) => {
      if (!pageUnderstanding) return [];
      const wc = tabManager.getWebContents(p.tabId);
      if (!wc) return [];
      const perc = await perception.capture(p.tabId, wc, { includeAxTree: false });
      return pageUnderstanding.semanticSearchInPage(perc, p.query, 6);
    }
  );

  handleTrusted(IPC_CHANNELS.PAGE_CHECK_CHANGES, async (_e, p: { tabId: string }) => {
    if (!pageUnderstanding) throw new Error('Page understanding engine unavailable');
    const tab = tabManager.getTab(p.tabId);
    const wc = tabManager.getWebContents(p.tabId);
    if (!tab || !wc) throw new Error('Tab not found');
    const perc = await perception.capture(p.tabId, wc, { includeAxTree: false });
    return pageUnderstanding.checkAndRecordPageChanges(perc, !tab.info.isPrivate);
  });

  handleTrusted(IPC_CHANNELS.CROSSTAB_ANALYZE, async (_e, p?: { tabIds?: string[] }) => {
    if (!crossTab) throw new Error('Cross-tab engine unavailable');
    const tabs = crossTab.filterAllowedTabs(tabManager.getAllTabs(), p?.tabIds);
    const map = new Map<string, import('@shared/types').PagePerception>();
    for (const t of tabs.slice(0, 10)) {
      const wc = tabManager.getWebContents(t.id);
      if (!wc) continue;
      try {
        map.set(t.id, await perception.capture(t.id, wc, { includeAxTree: false }));
      } catch {
        // skip
      }
    }
    return crossTab.analyzeTabs(tabs, map);
  });

  handleTrusted(
    IPC_CHANNELS.CROSSTAB_COMPARE,
    async (_e, p: { tabIds?: string[]; criteria: string }) => {
      if (!crossTab) throw new Error('Cross-tab engine unavailable');
      const tabs = crossTab.filterAllowedTabs(tabManager.getAllTabs(), p.tabIds);
      const perceptions = [];
      for (const t of tabs.slice(0, 8)) {
        const wc = tabManager.getWebContents(t.id);
        if (!wc) continue;
        perceptions.push(await perception.capture(t.id, wc, { includeAxTree: false }));
      }
      const model = platformRepo.getSetting<string>('agent.defaultModel', 'gemini-2.5-flash');
      return crossTab.compareSelectedTabs({ tabs, perceptions, criteria: p.criteria, model });
    }
  );

  handleTrusted(
    IPC_CHANNELS.SKILL_TEST,
    async (_e, p: { skillId: string; params: Record<string, unknown>; tabId?: string | null }) => {
      const skill = platformRepo.getSkill(p.skillId);
      if (!skill) throw new Error('Skill not found');
      const targetTabId = p.tabId || tabManager.getAllTabs().find((t) => !t.isPrivate)?.id || '';
      return skillRunner.runSkill({
        skill,
        args: p.params ?? {},
        mode: 'assist', // Skill test mode always uses safe assist confirmation
        createContext: (runId) => {
          const ctx = {
            runId,
            tabId: targetTabId,
            mode: 'assist' as const,
            isPrivate: Boolean(tabManager.getTab(targetTabId)?.info.isPrivate),
            experimentalScriptingEnabled: false,
            tabManager,
            browserRepo,
            cdp,
            resolver,
            perception,
            lastPerception: null as import('@shared/types').PagePerception | null,
            updateLastPerception: (next: import('@shared/types').PagePerception) => {
              ctx.lastPerception = next;
            },
            setActiveTabId: (id: string) => {
              ctx.tabId = id;
            }
          };
          return ctx;
        }
      });
    }
  );

  handleTrusted(IPC_CHANNELS.PROACTIVE_CHECK, async (_e, p: { tabId?: string | null }) => {
    const enabled = platformRepo.getSetting<boolean>('agent.proactiveAssistanceEnabled', false);
    if (!proactiveAssistant || !enabled) return [];
    const tabs = tabManager.getAllTabs().filter((t) => !t.isPrivate);
    const activeTab = (p?.tabId ? tabManager.getTab(p.tabId)?.info : tabs[0]) ?? null;
    let activePerc = null;
    if (activeTab && !activeTab.isPrivate) {
      const wc = tabManager.getWebContents(activeTab.id);
      if (wc && !wc.isLoading()) {
        try {
          activePerc = await perception.capture(activeTab.id, wc, { includeAxTree: false });
        } catch {
          // ignore
        }
      }
    }
    const analysis = crossTab ? crossTab.analyzeTabs(tabs, new Map()) : { duplicateGroups: [], relatedPairs: [] };
    return proactiveAssistant.evaluate({
      enabled,
      tabs,
      activeTab,
      activePerception: activePerc,
      relatedPairsCount: analysis.relatedPairs.length,
      duplicateGroups: analysis.duplicateGroups
    });
  });

  // --- Atlas Intelligent Search & Cloud Synchronization ---
  handleTrusted(IPC_CHANNELS.SEARCH_EXECUTE, async (_e, raw) => {
    if (!cloudClient) throw new Error('Search service unavailable');
    const data = SearchExecuteSchema.parse(raw);
    return cloudClient.executeSearch(data);
  });

  handleTrusted(IPC_CHANNELS.SEARCH_HISTORY_LIST, async () => {
    if (!cloudClient) return [];
    return cloudClient.listSearchHistory();
  });

  handleTrusted(IPC_CHANNELS.SEARCH_HISTORY_CLEAR, async () => {
    if (!cloudClient) return false;
    await cloudClient.clearSearchHistory();
    return true;
  });

  handleTrusted(IPC_CHANNELS.INDEX_STATS, async () => {
    if (!cloudClient) throw new Error('Index service unavailable');
    return cloudClient.getIndexStats();
  });

  handleTrusted(IPC_CHANNELS.INDEX_CRAWL, async (_e, raw) => {
    if (!cloudClient) throw new Error('Crawler service unavailable');
    return cloudClient.crawlIndexSeeds(raw as import('@shared/types').CrawlSeedConfig);
  });

  handleTrusted(
    IPC_CHANNELS.SEARCH_OPEN_GROUP,
    async (_e, p: { title: string; urls: string[] }, win) => {
      const group = tabManager.createGroup(p.title || 'Search Selection', '#3b82f6');
      const created = [];
      for (const u of (p.urls || []).slice(0, 10)) {
        if (!u.startsWith('http://') && !u.startsWith('https://')) continue;
        created.push(tabManager.createTab(win.id, { url: u, groupId: group.id, activate: created.length === 0 }));
      }
      return { group, tabs: created };
    }
  );

  handleTrusted(
    IPC_CHANNELS.SEARCH_SAVE_TO_RESEARCH,
    async (_e, p: { query: string; sources: Array<{ url: string; title: string; snippet?: string }> }) => {
      if (!researchEngine) throw new Error('Research engine unavailable');
      const model = platformRepo.getSetting<string>('agent.defaultModel', 'gemini-2.5-flash');
      return researchEngine.buildReport({
        query: p.query,
        sources: (p.sources || []).map((s) => ({
          url: s.url,
          title: s.title,
          text: s.snippet || s.title,
          headings: [s.title]
        })),
        model,
        isPrivate: false
      });
    }
  );

  handleTrusted(IPC_CHANNELS.CLOUD_STATUS, async () => {
    if (!cloudClient) throw new Error('Cloud client unavailable');
    return cloudClient.getStatus();
  });

  handleTrusted(IPC_CHANNELS.CLOUD_REGISTER, async (_e, raw) => {
    if (!cloudClient) throw new Error('Cloud client unavailable');
    const data = CloudAuthSchema.parse(raw);
    return cloudClient.register(data);
  });

  handleTrusted(IPC_CHANNELS.CLOUD_LOGIN, async (_e, raw) => {
    if (!cloudClient) throw new Error('Cloud client unavailable');
    const data = CloudAuthSchema.omit({ displayName: true }).parse(raw);
    return cloudClient.login(data);
  });

  handleTrusted(IPC_CHANNELS.CLOUD_LOGOUT, async () => {
    if (!cloudClient) throw new Error('Cloud client unavailable');
    return cloudClient.logout();
  });

  handleTrusted(IPC_CHANNELS.CLOUD_UPDATE_CONSENT, async (_e, patch) => {
    if (!cloudClient) throw new Error('Cloud client unavailable');
    return cloudClient.updateConsent(patch || {});
  });

  handleTrusted(IPC_CHANNELS.CLOUD_SYNC_NOW, async () => {
    if (!cloudClient) throw new Error('Cloud client unavailable');
    return cloudClient.syncApprovedData();
  });

  handleTrusted(IPC_CHANNELS.CLOUD_EXPORT_DATA, async () => {
    if (!cloudClient) throw new Error('Cloud client unavailable');
    return cloudClient.exportCloudData();
  });

  handleTrusted(IPC_CHANNELS.CLOUD_DELETE_ACCOUNT_DATA, async () => {
    if (!cloudClient) throw new Error('Cloud client unavailable');
    return cloudClient.deleteAccountData();
  });

  handleTrusted(IPC_CHANNELS.CLOUD_NOTES_LIST, async () => {
    if (!cloudClient) return [];
    return cloudClient.listNotes();
  });

  handleTrusted(
    IPC_CHANNELS.CLOUD_NOTES_SAVE,
    async (_e, p: { title: string; content: string; sourceUrl?: string | null; tags?: string[] }) => {
      if (!cloudClient) throw new Error('Cloud client unavailable');
      return cloudClient.saveNote(p);
    }
  );
}

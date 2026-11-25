import { app, globalShortcut, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AtlasDatabase } from './db/database';
import { BrowserRepository } from './db/repositories/browser-repo';
import { AgentRepository } from './db/repositories/agent-repo';
import { PlatformRepository } from './db/repositories/platform-repo';
import { SecretVault } from './security/secrets';
import { AuditLogger } from './security/audit-logger';
import { KillSwitch } from './security/kill-switch';
import { InjectionGuard } from './security/injection-guard';
import { PermissionGate } from './security/permission-gate';
import { AdBlocker } from './browser/ad-blocker';
import { DownloadManager } from './browser/download-manager';
import { PrivateSessionManager } from './browser/private-session';
import { SessionRestoreService } from './browser/session-restore';
import { TabManager, resolveContentPreloadPath } from './browser/tab-manager';
import { WindowManager, resolveUiPreloadPath } from './window-manager';
import { CDPManager } from './cdp/cdp-manager';
import { ElementResolver } from './cdp/element-resolver';
import { PerceptionEngine } from './cdp/perception';
import { GeminiProvider } from './agent/providers/gemini-provider';
import { MockModelProvider } from './agent/providers/mock-provider';
import type { ModelProvider } from './agent/providers/model-provider';
import { ToolRegistry } from './agent/tool-registry';
import { registerAllBrowserTools } from './agent/tools/browser-tools';
import { CostTracker } from './agent/cost-tracker';
import { AgentOrchestrator } from './agent/orchestrator';
import { StructuredExtractionEngine } from './agent/extraction-engine';
import { MemoryService } from './memory/memory-service';
import { SkillRecorder } from './skills/skill-recorder';
import { SkillRunner } from './skills/skill-runner';
import { JobScheduler } from './scheduler/job-scheduler';
import { LocalMcpServer } from './mcp/mcp-server';
import { registerAllIpcHandlers } from './ipc/register-handlers';

// Disable Electron remote module & enforce secure defaults
app.enableSandbox();

let db: AtlasDatabase | null = null;
let scheduler: JobScheduler | null = null;
let mcpServer: LocalMcpServer | null = null;

function pruneOldScreenshots(screenshotsDir: string, retentionDays: number): void {
  if (!fs.existsSync(screenshotsDir)) return;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  try {
    for (const runDir of fs.readdirSync(screenshotsDir)) {
      const full = path.join(screenshotsDir, runDir);
      const stat = fs.statSync(full);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  } catch {
    // non-fatal cleanup
  }
}

app.whenReady().then(async () => {
  const userDataDir = app.getPath('userData');
  const screenshotsDir = path.join(userDataDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  // Enforce strict Content Security Policy on the UI shell session (non-dev)
  if (!process.env.ATLAS_DEV_SERVER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.url.startsWith('file://')) {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self';"
            ]
          }
        });
      } else {
        callback({ responseHeaders: details.responseHeaders });
      }
    });
  }

  db = new AtlasDatabase(path.join(userDataDir, 'atlas.db'));
  const browserRepo = new BrowserRepository(db.db);
  const agentRepo = new AgentRepository(db.db);
  const platformRepo = new PlatformRepository(db.db);

  // Ensure default conversation exists
  if (agentRepo.listConversations(1).length === 0) {
    agentRepo.createConversation('Atlas Assistant');
  }

  const retentionDays = platformRepo.getSetting<number>('agent.screenshotRetentionDays', 14);
  pruneOldScreenshots(screenshotsDir, retentionDays);

  const vault = new SecretVault(userDataDir);
  const killSwitch = new KillSwitch();
  const auditLogger = new AuditLogger(platformRepo);
  const injectionGuard = new InjectionGuard();
  const permissionGate = new PermissionGate(platformRepo, auditLogger, killSwitch);

  const adBlocker = new AdBlocker(platformRepo);
  const privateSessionManager = new PrivateSessionManager();
  const sessionRestore = new SessionRestoreService(browserRepo);

  let windowManagerRef: WindowManager | null = null;
  const downloadManager = new DownloadManager(browserRepo, platformRepo, () =>
    windowManagerRef?.getMainWindow() ?? null
  );

  const tabManager = new TabManager(
    browserRepo,
    platformRepo,
    adBlocker,
    downloadManager,
    privateSessionManager,
    sessionRestore,
    resolveContentPreloadPath()
  );

  const windowManager = new WindowManager(
    platformRepo,
    tabManager,
    privateSessionManager,
    sessionRestore,
    resolveUiPreloadPath()
  );
  windowManagerRef = windowManager;

  const cdp = new CDPManager();
  const resolver = new ElementResolver(cdp);
  const perception = new PerceptionEngine(cdp, injectionGuard);
  const toolRegistry = new ToolRegistry(permissionGate, auditLogger);
  registerAllBrowserTools(toolRegistry);

  const geminiProvider = new GeminiProvider(() => vault.getGeminiApiKey());
  const mockProvider = new MockModelProvider();
  const getProvider = (): ModelProvider => {
    const selected = platformRepo.getSetting<'gemini' | 'mock'>('agent.defaultProvider', 'gemini');
    return selected === 'mock' ? mockProvider : geminiProvider;
  };

  const costTracker = new CostTracker(agentRepo);
  const memoryService = new MemoryService(platformRepo);
  const extractionEngine = new StructuredExtractionEngine(getProvider, injectionGuard);

  const orchestrator = new AgentOrchestrator(
    getProvider,
    browserRepo,
    agentRepo,
    platformRepo,
    tabManager,
    cdp,
    resolver,
    perception,
    toolRegistry,
    permissionGate,
    injectionGuard,
    killSwitch,
    auditLogger,
    costTracker,
    memoryService,
    screenshotsDir
  );

  const skillRecorder = new SkillRecorder(platformRepo);
  const skillRunner = new SkillRunner(platformRepo, toolRegistry, auditLogger);

  scheduler = new JobScheduler(platformRepo, skillRunner, auditLogger, (runId) => {
    const tab = tabManager.getAllTabs().find((t) => !t.isPrivate);
    if (!tab) return null;
    const ctx = {
      runId,
      tabId: tab.id,
      mode: 'agent' as const,
      isPrivate: false,
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
  });
  scheduler.start();

  mcpServer = new LocalMcpServer(
    platformRepo,
    vault,
    auditLogger,
    tabManager,
    perception,
    orchestrator
  );
  if (mcpServer.getConfig().enabled) {
    await mcpServer.start().catch((err) => console.error('[MCP] Failed to auto-start:', err));
  }

  registerAllIpcHandlers({
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
    scheduler,
    mcpServer,
    vault,
    cdp,
    resolver,
    perception,
    screenshotsDir
  });

  // Global emergency kill switch hotkey
  globalShortcut.register('CommandOrControl+Shift+Escape', () => {
    void killSwitch.trigger('Emergency kill switch shortcut pressed');
  });

  windowManager.createWindow({ isPrivate: false });

  app.on('activate', () => {
    if (!windowManager.getMainWindow()) {
      windowManager.createWindow({ isPrivate: false });
    }
  });
});

app.on('before-quit', async () => {
  globalShortcut.unregisterAll();
  scheduler?.stop();
  await mcpServer?.stop();
  db?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

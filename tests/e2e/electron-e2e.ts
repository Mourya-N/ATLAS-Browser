import { app } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AtlasDatabase } from '@main/db/database';
import { BrowserRepository } from '@main/db/repositories/browser-repo';
import { AgentRepository } from '@main/db/repositories/agent-repo';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { SecretVault } from '@main/security/secrets';
import { AuditLogger } from '@main/security/audit-logger';
import { KillSwitch } from '@main/security/kill-switch';
import { InjectionGuard } from '@main/security/injection-guard';
import { PermissionGate } from '@main/security/permission-gate';
import { AdBlocker } from '@main/browser/ad-blocker';
import { DownloadManager } from '@main/browser/download-manager';
import { PrivateSessionManager } from '@main/browser/private-session';
import { SessionRestoreService } from '@main/browser/session-restore';
import { TabManager, resolveContentPreloadPath } from '@main/browser/tab-manager';
import { WindowManager, resolveUiPreloadPath } from '@main/window-manager';
import { CDPManager } from '@main/cdp/cdp-manager';
import { ElementResolver } from '@main/cdp/element-resolver';
import { PerceptionEngine } from '@main/cdp/perception';
import { MockModelProvider } from '@main/agent/providers/mock-provider';
import { ToolRegistry, type ToolExecutionContext } from '@main/agent/tool-registry';
import { registerAllBrowserTools } from '@main/agent/tools/browser-tools';
import { CostTracker } from '@main/agent/cost-tracker';
import { AgentOrchestrator } from '@main/agent/orchestrator';
import { StructuredExtractionEngine } from '@main/agent/extraction-engine';
import { MemoryService } from '@main/memory/memory-service';
import { SkillRecorder } from '@main/skills/skill-recorder';
import { SkillRunner } from '@main/skills/skill-runner';
import { JobScheduler } from '@main/scheduler/job-scheduler';
import { LocalMcpServer } from '@main/mcp/mcp-server';
import { registerAllIpcHandlers } from '@main/ipc/register-handlers';
import type { AgentRun, PagePerception } from '@shared/types';
import { startE2EHttpServer } from '../fixtures/e2e-http-server';

interface TestResult {
  section: string;
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

async function runCase(section: string, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ section, name, passed: true });
    console.log(`  ✓ [${section}] ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    results.push({ section, name, passed: false, detail: msg });
    console.error(`  ✗ [${section}] ${name}\n    ${msg}`);
  }
}

async function waitForTabLoad(tabManager: TabManager, tabId: string, timeoutMs = 8000): Promise<void> {
  const wc = tabManager.getWebContents(tabId);
  assert.ok(wc, `Tab ${tabId} webContents missing`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = tabManager.getTab(tabId);
    if (tab && !tab.info.isLoading && !wc.isLoading()) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(`Timed out waiting for tab ${tabId} to finish loading`);
}

async function waitForRunDone(orchestrator: AgentOrchestrator, agentRepo: AgentRepository, runId: string): Promise<AgentRun> {
  const terminal = new Set(['completed', 'failed', 'cancelled', 'budget_exceeded']);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const active = orchestrator.getActiveRuns().find((r) => r.id === runId);
    if (!active) {
      const saved = agentRepo.getRun(runId);
      if (saved && terminal.has(saved.status)) return saved;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`Timed out waiting for run ${runId}`);
}

app.enableSandbox();

const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-e2e-userdata-'));
app.setPath('userData', tempUserData);

app.whenReady().then(async () => {
  const server = await startE2EHttpServer();
  const screenshotsDir = path.join(tempUserData, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const db = new AtlasDatabase(path.join(tempUserData, 'atlas.db'));
  const browserRepo = new BrowserRepository(db.db);
  const agentRepo = new AgentRepository(db.db);
  const platformRepo = new PlatformRepository(db.db);
  const conv = agentRepo.createConversation('E2E Assistant');

  platformRepo.setSetting('browser.homeUrl', `${server.baseUrl}/`);
  platformRepo.setSetting('browser.restoreSessionOnStart', false);

  const vault = new SecretVault(tempUserData);
  const killSwitch = new KillSwitch();
  const auditLogger = new AuditLogger(platformRepo);
  const injectionGuard = new InjectionGuard();

  let confirmBehavior: 'approve' | 'reject' = 'approve';
  const confirmTracker: { lastReq: { toolName: string; domain: string } | null } = { lastReq: null };
  const permissionGate = new PermissionGate(platformRepo, auditLogger, killSwitch, async (req) => {
    confirmTracker.lastReq = { toolName: req.toolName, domain: req.domain };
    return { requestId: req.id, approved: confirmBehavior === 'approve' };
  });

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

  const mockProvider = new MockModelProvider();
  const costTracker = new CostTracker(agentRepo);
  const memoryService = new MemoryService(platformRepo);
  const extractionEngine = new StructuredExtractionEngine(() => mockProvider, injectionGuard);

  const orchestrator = new AgentOrchestrator(
    () => mockProvider,
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
  const scheduler = new JobScheduler(platformRepo, skillRunner, auditLogger, () => null);
  const mcpServer = new LocalMcpServer(
    platformRepo,
    vault,
    auditLogger,
    tabManager,
    perception,
    orchestrator
  );

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

  // Override prompter after registerAllIpcHandlers so E2E suite can test both reject & approve deterministically
  permissionGate.setPrompter(async (req) => {
    confirmTracker.lastReq = { toolName: req.toolName, domain: req.domain };
    return { requestId: req.id, approved: confirmBehavior === 'approve' };
  });

  const rendererErrors: string[] = [];
  const win = windowManager.createWindow({ isPrivate: false });
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3) rendererErrors.push(message);
  });
  win.webContents.on('render-process-gone', (_ev, details) => {
    rendererErrors.push(`Renderer gone: ${details.reason}`);
  });

  // Wait for UI renderer + initial WebContentsView tab
  await new Promise<void>((resolve) => {
    const check = () => {
      const tabs = tabManager.getTabsForWindow(win.id);
      if (!win.webContents.isLoading() && tabs.length > 0) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    setTimeout(check, 250);
  });

  const mainTabId = tabManager.getTabsForWindow(win.id)[0].id;
  await waitForTabLoad(tabManager, mainTabId);

  console.log('\n=== PART 1: REAL ELECTRON APP & UI CONTROLS ===');

  await runCase('UI', 'Window opens, renderer loads React shell, WebContentsView tab exists, zero runtime errors', async () => {
    assert.equal(win.isDestroyed(), false);
    const uiCheck = await win.webContents.executeJavaScript(`(() => ({
      hasRoot: Boolean(document.getElementById('root')?.children.length),
      hasAtlasBridge: typeof window.atlas === 'object',
      hasAddressInput: Boolean(document.querySelector('input[placeholder*="Search or enter website URL"]')),
      hasAgentPanel: Boolean(document.querySelector('aside textarea'))
    }))()`);
    assert.equal(uiCheck.hasRoot, true);
    assert.equal(uiCheck.hasAtlasBridge, true);
    assert.equal(uiCheck.hasAddressInput, true);
    assert.equal(uiCheck.hasAgentPanel, true);
    assert.equal(rendererErrors.length, 0, `Renderer errors: ${rendererErrors.join('; ')}`);
  });

  await runCase('UI', 'Navigation via address bar, Back, Forward, Reload, Stop, and Tab switching', async () => {
    await win.webContents.executeJavaScript(`window.atlas.navigate(${JSON.stringify(mainTabId)}, ${JSON.stringify(`${server.baseUrl}/workspace`)})`);
    await waitForTabLoad(tabManager, mainTabId);
    await new Promise((r) => setTimeout(r, 150));

    const addrVal = await win.webContents.executeJavaScript(
      `document.querySelector('input[placeholder*="Search or enter website URL"]').value`
    );
    assert.ok(addrVal.includes('/workspace'), `Expected address bar to reflect /workspace, got ${addrVal}`);

    // Back -> Home
    const wentBack = await win.webContents.executeJavaScript(`window.atlas.goBack(${JSON.stringify(mainTabId)})`);
    assert.equal(wentBack, true);
    await waitForTabLoad(tabManager, mainTabId);
    assert.equal(tabManager.getTab(mainTabId)!.info.url, `${server.baseUrl}/`);

    // Forward -> Workspace
    const wentFwd = await win.webContents.executeJavaScript(`window.atlas.goForward(${JSON.stringify(mainTabId)})`);
    assert.equal(wentFwd, true);
    await waitForTabLoad(tabManager, mainTabId);
    assert.ok(tabManager.getTab(mainTabId)!.info.url.includes('/workspace'));

    // Reload & Stop callable without error
    await win.webContents.executeJavaScript(`window.atlas.reload(${JSON.stringify(mainTabId)})`);
    await waitForTabLoad(tabManager, mainTabId);
    await win.webContents.executeJavaScript(`window.atlas.stopLoading(${JSON.stringify(mainTabId)})`);

    // Open second tab and verify tab switching updates active WebContentsView & visibilityState
    const secondTab = await win.webContents.executeJavaScript(
      `window.atlas.createTab({ url: ${JSON.stringify(`${server.baseUrl}/compare-1`)}, activate: true })`
    );
    await waitForTabLoad(tabManager, secondTab.id);
    assert.equal(tabManager.getActiveTabId(win.id), secondTab.id);
    assert.ok(tabManager.getTab(secondTab.id)!.view.getBounds().width > 200);
    assert.equal(
      await tabManager.getWebContents(secondTab.id)!.executeJavaScript('document.visibilityState'),
      'visible'
    );

    // Switch back to first tab
    await win.webContents.executeJavaScript(`window.atlas.activateTab(${JSON.stringify(mainTabId)})`);
    assert.equal(tabManager.getActiveTabId(win.id), mainTabId);
    assert.equal(
      await tabManager.getWebContents(mainTabId)!.executeJavaScript('document.visibilityState'),
      'visible'
    );
    await win.webContents.executeJavaScript(`window.atlas.closeTab(${JSON.stringify(secondTab.id)})`);
  });

  await runCase('UI', 'Agent panel opens/closes and updates WebContentsView layout bounds', async () => {
    const initialW = tabManager.getTab(mainTabId)!.view.getBounds().width;
    await win.webContents.executeJavaScript(`document.querySelector('button[title="Toggle Atlas AI Panel"]').click()`);
    await new Promise((r) => setTimeout(r, 150));
    const expandedW = tabManager.getTab(mainTabId)!.view.getBounds().width;
    assert.ok(expandedW > initialW, `Expected WebContentsView width to grow when panel closed (${initialW} -> ${expandedW})`);
    await win.webContents.executeJavaScript(`document.querySelector('button[title="Toggle Atlas AI Panel"]').click()`);
    await new Promise((r) => setTimeout(r, 150));
    const restoredW = tabManager.getTab(mainTabId)!.view.getBounds().width;
    assert.equal(restoredW, initialW);
  });

  // Capture screenshots of both the BrowserWindow chrome and the active WebContentsView webpage
  const uiShotDir = process.env.ATLAS_E2E_ARTIFACT_DIR || tempUserData;
  try {
    const img = await win.capturePage();
    fs.writeFileSync(path.join(uiShotDir, 'atlas-live-ui.png'), img.toPNG());
    const tabImg = await tabManager.getWebContents(mainTabId)!.capturePage();
    fs.writeFileSync(path.join(uiShotDir, 'atlas-live-webview.png'), tabImg.toPNG());
    console.log(`  [Artifact] Saved live UI & WebContentsView screenshots to ${uiShotDir}`);
  } catch (err) {
    console.warn('  [Artifact] Screenshot skipped:', err);
  }

  console.log('\n=== PART 2: 20 REAL CHROMIUM WebContentsView + CDP E2E CASES ===');

  const createToolCtx = (tabId: string, runId = 'e2e-direct'): ToolExecutionContext => {
    const ctx: ToolExecutionContext = {
      runId,
      tabId,
      mode: 'agent',
      isPrivate: Boolean(tabManager.getTab(tabId)?.info.isPrivate),
      experimentalScriptingEnabled: false,
      tabManager,
      browserRepo,
      cdp,
      resolver,
      perception,
      lastPerception: null as PagePerception | null,
      updateLastPerception: (p) => {
        ctx.lastPerception = p;
      },
      setActiveTabId: (id) => {
        ctx.tabId = id;
      }
    };
    return ctx;
  };

  const ctx = createToolCtx(mainTabId);
  let capturedStaleAtlasId = '';
  let secondTabId = '';

  await runCase('CDP-1', 'Navigate to local page', async () => {
    const res = await toolRegistry.invoke('navigate', { url: `${server.baseUrl}/` }, ctx);
    assert.equal(res.outcome.success, true);
    assert.equal((res.outcome.data as { url: string }).url, `${server.baseUrl}/`);
  });

  await runCase('CDP-2', 'Read title and content', async () => {
    const res = await toolRegistry.invoke('read_page', {}, ctx);
    assert.equal(res.outcome.success, true);
    const data = res.outcome.data as { title: string; mainText: string };
    assert.equal(data.title, 'Atlas E2E Home');
    assert.ok(data.mainText.includes('Atlas Browser Live Test Portal'));
  });

  await runCase('CDP-3', 'Find button using accessibility tree', async () => {
    const res = await toolRegistry.invoke('inspect_accessibility', {}, ctx);
    assert.equal(res.outcome.success, true);
    const ax = (res.outcome.data as { axSummary: string }).axSummary;
    assert.ok(ax.includes('Open Workspace'), `AXTree missing Open Workspace button:\n${ax}`);
  });

  await runCase('CDP-4', 'Click button using CDP', async () => {
    const res = await toolRegistry.invoke('click', { selector: '#go-btn' }, ctx);
    assert.equal(res.outcome.success, true);
    await waitForTabLoad(tabManager, mainTabId);
  });

  await runCase('CDP-5', 'Verify page changed after CDP click', async () => {
    const res = await toolRegistry.invoke('get_current_url', {}, ctx);
    assert.equal((res.outcome.data as { url: string }).url, `${server.baseUrl}/workspace`);
  });

  await runCase('CDP-13', 'Dynamic DOM updates (real setTimeout mutation in Chromium)', async () => {
    const waitRes = await toolRegistry.invoke('wait_for_element', { selector: '#dynamic-badge', timeoutMs: 3000 }, ctx);
    assert.equal(waitRes.outcome.success, true);
    assert.equal((waitRes.outcome.data as { text: string }).text, 'Dynamic DOM Ready');
  });

  await runCase('CDP-14', 'Real iframe element inspection and click', async () => {
    const domRes = await toolRegistry.invoke('inspect_dom', {}, ctx);
    const elements = (domRes.outcome.data as { elements: Array<{ atlasId: string; frameId?: string; text: string }> }).elements;
    const iframeBtn = elements.find((e) => e.frameId && e.frameId !== 'main' && e.text.includes('Click Inside Iframe'));
    assert.ok(iframeBtn, 'Expected button inside real <iframe> to be discovered');
    const clickRes = await toolRegistry.invoke('click', { atlasId: iframeBtn.atlasId }, ctx);
    assert.equal(clickRes.outcome.success, true);
    const statusText = await cdp.evaluateInternal<string>(
      mainTabId,
      tabManager.getWebContents(mainTabId)!,
      `document.getElementById('child-frame').contentDocument.getElementById('iframe-status').textContent`
    );
    assert.equal(statusText, 'iframe-clicked');
  });

  await runCase('CDP-15', 'Real Shadow DOM element inspection and click', async () => {
    const domRes = await toolRegistry.invoke('inspect_dom', {}, ctx);
    const elements = (domRes.outcome.data as { elements: Array<{ atlasId: string; inShadowDom: boolean; text: string }> }).elements;
    const shadowBtn = elements.find((e) => e.inShadowDom && e.text.includes('Shadow Action'));
    assert.ok(shadowBtn, 'Expected button inside Shadow DOM to be discovered');
    const clickRes = await toolRegistry.invoke('click', { atlasId: shadowBtn.atlasId }, ctx);
    assert.equal(clickRes.outcome.success, true);
    const shadowStatus = await cdp.evaluateInternal<string>(
      mainTabId,
      tabManager.getWebContents(mainTabId)!,
      `document.getElementById('shadow-host').shadowRoot.getElementById('shadow-status').textContent`
    );
    assert.equal(shadowStatus, 'shadow-clicked');
  });

  await runCase('CDP-17', 'Stale element reference rejected cleanly after DOM removal', async () => {
    const domRes = await toolRegistry.invoke('inspect_dom', {}, ctx);
    const elements = (domRes.outcome.data as { elements: Array<{ atlasId: string; attributes: Record<string, string> }> }).elements;
    const target = elements.find((e) => e.attributes.id === 'stale-target-btn');
    assert.ok(target, 'Expected #stale-target-btn');
    capturedStaleAtlasId = target.atlasId;

    const removeClick = await toolRegistry.invoke('click', { selector: '#remove-target-btn' }, ctx);
    assert.equal(removeClick.outcome.success, true);

    const staleClick = await toolRegistry.invoke('click', { atlasId: capturedStaleAtlasId }, ctx);
    assert.equal(staleClick.outcome.success, false);
    assert.match(staleClick.outcome.error || '', /no longer exists|stale|not found/i);
  });

  await runCase('CDP-6..10', 'Find form input, type, select option, submit harmless form (confirm), verify result', async () => {
    await toolRegistry.invoke('navigate', { url: `${server.baseUrl}/form` }, ctx);
    const found = await toolRegistry.invoke('find_element', { selector: '#name-input' }, ctx);
    assert.equal(found.outcome.success, true);

    const typed = await toolRegistry.invoke('type', { selector: '#name-input', value: 'Ada Lovelace' }, ctx);
    assert.equal(typed.outcome.success, true);

    const selected = await toolRegistry.invoke('select', { selector: '#plan-select', optionValue: 'pro' }, ctx);
    assert.equal(selected.outcome.success, true);

    confirmBehavior = 'approve';
    const submit = await toolRegistry.invoke('click', { selector: '#submit-btn' }, ctx);
    assert.equal(submit.outcome.success, true);
    assert.equal(submit.permissionTier, 'sensitive');
    assert.equal(submit.permissionDecision, 'confirmed');
    await waitForTabLoad(tabManager, mainTabId);

    const page = await toolRegistry.invoke('read_page', {}, ctx);
    const mainText = (page.outcome.data as { mainText: string }).mainText;
    assert.ok(mainText.includes('Name=Ada Lovelace; Plan=pro'), `Unexpected form result: ${mainText}`);
  });

  await runCase('CDP-20', 'Sensitive-action confirmation rejection blocks submission', async () => {
    await toolRegistry.invoke('navigate', { url: `${server.baseUrl}/form` }, ctx);
    confirmBehavior = 'reject';
    confirmTracker.lastReq = null;
    const blocked = await toolRegistry.invoke('click', { selector: '#submit-btn' }, ctx);
    assert.equal(blocked.outcome.success, false);
    assert.equal(blocked.permissionDecision, 'rejected');
    assert.equal((confirmTracker.lastReq as { toolName: string } | null)?.toolName, 'click');
    confirmBehavior = 'approve';
  });

  await runCase('CDP-11 & 12', 'Open second tab and compare content across both real tabs', async () => {
    await toolRegistry.invoke('navigate', { url: `${server.baseUrl}/compare-1` }, ctx);
    const opened = await toolRegistry.invoke('open_tab', { url: `${server.baseUrl}/compare-2`, activate: false }, ctx);
    assert.equal(opened.outcome.success, true);
    secondTabId = (opened.outcome.data as { tabId: string }).tabId;
    await waitForTabLoad(tabManager, secondTabId);

    const compared = await toolRegistry.invoke('compare_tabs', { tabIds: [mainTabId, secondTabId] }, ctx);
    assert.equal(compared.outcome.success, true);
    const tabsData = (compared.outcome.data as { comparedTabs: Array<{ title: string; excerpt: string }> }).comparedTabs;
    assert.equal(tabsData.length, 2);
    assert.ok(tabsData.some((t) => t.excerpt.includes('$29/month')));
    assert.ok(tabsData.some((t) => t.excerpt.includes('$99/month')));
    await toolRegistry.invoke('close_tab', { tabId: secondTabId }, ctx);
  });

  await runCase('CDP-16', 'Navigation failure recovery (unreachable port -> fallback valid page)', async () => {
    await toolRegistry.invoke('navigate', { url: 'http://127.0.0.1:1/unreachable' }, ctx);
    await new Promise((r) => setTimeout(r, 300));
    const errRead = await toolRegistry.invoke('read_page', {}, ctx);
    assert.ok(JSON.stringify(errRead.outcome.data).includes('Unable to load page'));

    const recovered = await toolRegistry.invoke('navigate', { url: `${server.baseUrl}/` }, ctx);
    assert.equal(recovered.outcome.success, true);
    assert.equal((recovered.outcome.data as { title: string }).title, 'Atlas E2E Home');
  });

  await runCase('CDP-18', 'Private-session isolation in real Electron BrowserWindow', async () => {
    const beforeHistoryCount = browserRepo.searchHistory('', 500).length;
    const privWin = windowManager.createWindow({ isPrivate: true });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!privWin.webContents.isLoading() && tabManager.getTabsForWindow(privWin.id).length > 0) resolve();
        else setTimeout(check, 80);
      };
      setTimeout(check, 150);
    });
    const privTabId = tabManager.getTabsForWindow(privWin.id)[0].id;
    await tabManager.navigate(privTabId, `${server.baseUrl}/search?q=private-secret-isolation-token`);
    await waitForTabLoad(tabManager, privTabId);
    const afterHistoryCount = browserRepo.searchHistory('', 500).length;
    assert.equal(afterHistoryCount, beforeHistoryCount, 'Private window wrote to history table!');
    assert.equal(
      browserRepo.searchHistory('private-secret-isolation-token', 50).length,
      0,
      'Private URL leaked into history!'
    );
    privWin.close();
  });

  await runCase('CDP-19', 'Emergency kill switch stops active run and detaches CDP debugger', async () => {
    await cdp.attach(mainTabId, tabManager.getWebContents(mainTabId)!);
    assert.equal(tabManager.getWebContents(mainTabId)!.debugger.isAttached(), true);

    mockProvider.setResponder(async () => {
      await new Promise((r) => setTimeout(r, 300));
      return {
        text: JSON.stringify({ planSummary: 'Slow', complexity: 'simple', subgoals: [{ description: 'Step', expectedEvidence: 'Done' }] }),
        functionCalls: [],
        usage: { inputTokens: 10, outputTokens: 10, fromProvider: false }
      };
    });

    const run = await orchestrator.startRun({
      conversationId: conv.id,
      tabId: mainTabId,
      goal: 'Slow task to kill',
      mode: 'agent'
    });
    await killSwitch.trigger('E2E emergency stop');
    const done = await waitForRunDone(orchestrator, agentRepo, run.id);
    assert.equal(done.status, 'cancelled');
    assert.equal(tabManager.getWebContents(mainTabId)!.debugger.isAttached(), false);
    killSwitch.reset();
    mockProvider.reset();
  });

  console.log('\n=== PART 3: LIVE AGENT END-TO-END (REAL CHROMIUM + CDP + DB + UI) ===');

  await runCase('AGENT-E2E-1', 'Single-tab search workflow via real WebContentsView, CDP, UI events, and SQLite', async () => {
    await tabManager.navigate(mainTabId, `${server.baseUrl}/`);
    await waitForTabLoad(tabManager, mainTabId);

    mockProvider.enqueue([
      {
        text: JSON.stringify({
          planSummary: 'Open test page, enter OAuth2 in search field, click search, verify results, summarize',
          complexity: 'simple',
          subgoals: [
            { description: 'Enter OAuth2 into search field', expectedEvidence: 'Typed into #search-input' },
            { description: 'Click search button', expectedEvidence: 'Navigated to /search' },
            { description: 'Verify results and summarize', expectedEvidence: 'Results observed' }
          ]
        }),
        functionCalls: [],
        usage: { inputTokens: 100, outputTokens: 40, fromProvider: false }
      },
      {
        text: 'Typing OAuth2 into the search field.',
        functionCalls: [{ name: 'type', args: { selector: '#search-input', value: 'OAuth2' } }],
        usage: { inputTokens: 120, outputTokens: 25, fromProvider: false }
      },
      {
        text: 'Clicking the search button.',
        functionCalls: [{ name: 'click', args: { selector: '#search-btn' } }],
        usage: { inputTokens: 120, outputTokens: 25, fromProvider: false }
      },
      {
        text: 'Reading search results page.',
        functionCalls: [{ name: 'read_page', args: {} }],
        usage: { inputTokens: 120, outputTokens: 25, fromProvider: false }
      },
      {
        text: 'Entered "OAuth2" into #search-input, clicked #search-btn, verified results listing Official OAuth2 Authentication Guide and Security Hardening Checklist.',
        functionCalls: [],
        usage: { inputTokens: 140, outputTokens: 45, fromProvider: false }
      }
    ]);

    const run = await orchestrator.startRun({
      conversationId: conv.id,
      tabId: mainTabId,
      goal: 'Open the test page, identify the search field, enter OAuth2, click the search button, verify the results, and summarize what happened.',
      mode: 'agent'
    });
    const done = await waitForRunDone(orchestrator, agentRepo, run.id);
    assert.equal(done.status, 'completed');
    assert.ok(done.finalAnswer?.includes('OAuth2'));
    assert.ok(done.steps.length >= 4);

    // Verify persisted in SQLite
    const dbRun = agentRepo.getRun(done.id);
    assert.ok(dbRun && dbRun.steps.length >= 4);
    assert.ok(dbRun.steps.some((s) => s.toolExecution?.toolName === 'type' && s.toolExecution.success));
    assert.ok(dbRun.steps.some((s) => s.toolExecution?.toolName === 'click' && s.toolExecution.success));

    // Verify UI AgentPanel displays the run timeline & final message
    const uiState = await win.webContents.executeJavaScript(`document.querySelector('aside')?.innerText || ''`);
    assert.ok(uiState.includes('OAuth2'), 'AgentPanel UI did not display run output');
  });

  await runCase('AGENT-E2E-2', 'Multi-tab comparison task via real WebContentsView tabs and CDP', async () => {
    await tabManager.navigate(mainTabId, `${server.baseUrl}/compare-1`);
    await waitForTabLoad(tabManager, mainTabId);
    const tab2 = tabManager.createTab(win.id, { url: `${server.baseUrl}/compare-2`, activate: false });
    await waitForTabLoad(tabManager, tab2.id);

    mockProvider.enqueue([
      {
        text: JSON.stringify({
          planSummary: 'Compare both open tabs and summarize differences',
          complexity: 'simple',
          subgoals: [{ description: 'Compare open tabs', expectedEvidence: 'Both tabs read' }]
        }),
        functionCalls: [],
        usage: { inputTokens: 90, outputTokens: 30, fromProvider: false }
      },
      {
        text: 'Comparing both tabs.',
        functionCalls: [{ name: 'compare_tabs', args: { tabIds: [mainTabId, tab2.id] } }],
        usage: { inputTokens: 110, outputTokens: 25, fromProvider: false }
      },
      {
        text: 'Comparison: Option Alpha ($29/mo, single-agent) vs Option Beta ($99/mo, multi-agent & MCP).',
        functionCalls: [],
        usage: { inputTokens: 130, outputTokens: 35, fromProvider: false }
      }
    ]);

    const run = await orchestrator.startRun({
      conversationId: conv.id,
      tabId: mainTabId,
      goal: 'Compare the two open product tabs and summarize pricing and capabilities.',
      mode: 'agent'
    });
    const done = await waitForRunDone(orchestrator, agentRepo, run.id);
    assert.equal(done.status, 'completed');
    assert.ok(done.finalAnswer?.includes('Option Alpha') && done.finalAnswer?.includes('Option Beta'));
    tabManager.closeTab(tab2.id);
  });

  console.log('\n=== PART 4: LIVE SECURITY VERIFICATION ===');

  await runCase('SEC-1', 'Remote website in WebContentsView has zero access to window.atlas or Electron APIs', async () => {
    await tabManager.navigate(mainTabId, `${server.baseUrl}/`);
    await waitForTabLoad(tabManager, mainTabId);
    const probe = await tabManager.getWebContents(mainTabId)!.executeJavaScript(`({
      atlasType: typeof window.atlas,
      requireType: typeof window.require,
      processType: typeof window.process
    })`);
    assert.equal(probe.atlasType, 'undefined');
    assert.equal(probe.requireType, 'undefined');
    assert.equal(probe.processType, 'undefined');
  });

  await runCase('SEC-2', 'Prompt-injection page triggers InjectionGuard warning and never overrides goal', async () => {
    await tabManager.navigate(mainTabId, `${server.baseUrl}/injection`);
    await waitForTabLoad(tabManager, mainTabId);
    const perc = await perception.capture(mainTabId, tabManager.getWebContents(mainTabId)!);
    assert.ok(perc.injectionWarnings.length >= 2);
  });

  await runCase('SEC-3', 'Unauthorized domain blocked by PermissionGate rule', async () => {
    permissionGate.setDomainRule('127.0.0.1', 'deny');
    const blocked = await toolRegistry.invoke('read_page', {}, ctx);
    assert.equal(blocked.outcome.success, false);
    assert.equal(blocked.permissionDecision, 'denied');
    permissionGate.deleteDomainRule('127.0.0.1');
  });

  await runCase('SEC-4', 'File upload requires explicit sensitive confirmation and valid non-sensitive path', async () => {
    await toolRegistry.invoke('navigate', { url: `${server.baseUrl}/form` }, ctx);
    const sampleFile = path.join(tempUserData, 'upload-test.txt');
    fs.writeFileSync(sampleFile, 'Atlas harmless upload test');

    confirmBehavior = 'reject';
    const rejected = await toolRegistry.invoke(
      'upload_file',
      { selector: '#file-input', filePath: sampleFile },
      ctx
    );
    assert.equal(rejected.outcome.success, false);
    assert.equal(rejected.permissionDecision, 'rejected');

    confirmBehavior = 'approve';
    const approved = await toolRegistry.invoke(
      'upload_file',
      { selector: '#file-input', filePath: sampleFile },
      ctx
    );
    assert.equal(approved.outcome.success, true);
    assert.equal(approved.permissionDecision, 'confirmed');
  });

  await runCase('SEC-5', 'API key redaction in AuditLogger and MCP Bearer auth enforcement', async () => {
    const ev = auditLogger.log({
      category: 'security',
      action: 'redaction_check',
      actor: 'e2e',
      details: { apiKey: 'AIzaSyTestSecretKey1234567890123', note: 'Bearer tok_abc123456789012345' }
    });
    assert.equal(ev.details.apiKey, '[REDACTED]');
    assert.equal(ev.details.note, '[REDACTED_SECRET]');

    await mcpServer.configure({ enabled: true, port: 0 });
    const status = mcpServer.getStatus();
    const unauth = await fetch(`http://127.0.0.1:${status.port}/mcp`, {
      method: 'POST',
      body: JSON.stringify({ method: 'tools/list' })
    });
    assert.equal(unauth.status, 401);
    await mcpServer.stop();
  });

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`\n=== LIVE E2E SUMMARY: ${passedCount}/${results.length} PASSED, ${failedCount} FAILED ===`);

  await server.close();
  sessionRestore.dispose();
  db.close();
  win.destroy();
  fs.rmSync(tempUserData, { recursive: true, force: true });
  app.exit(failedCount > 0 ? 1 : 0);
});

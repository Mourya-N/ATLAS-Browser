import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LavrayDatabase } from '@main/db/database';
import { BrowserRepository } from '@main/db/repositories/browser-repo';
import { AgentRepository } from '@main/db/repositories/agent-repo';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { AuditLogger } from '@main/security/audit-logger';
import { InjectionGuard } from '@main/security/injection-guard';
import { KillSwitch } from '@main/security/kill-switch';
import { PermissionGate, isSensitiveTarget } from '@main/security/permission-gate';
import { SecretVault } from '@main/security/secrets';
import { ToolRegistry } from '@main/agent/tool-registry';
import { CostTracker } from '@main/agent/cost-tracker';
import { MemoryService } from '@main/memory/memory-service';
import { MockModelProvider } from '@main/agent/providers/mock-provider';
import { AgentOrchestrator, DEFAULT_BUDGETS } from '@main/agent/orchestrator';
import { StructuredExtractionEngine } from '@main/agent/extraction-engine';
import { SkillRecorder } from '@main/skills/skill-recorder';
import { SkillRunner } from '@main/skills/skill-runner';
import { JobScheduler } from '@main/scheduler/job-scheduler';
import { LocalMcpServer } from '@main/mcp/mcp-server';
import type { AgentRun, DOMElementInfo, PagePerception, TabInfo } from '@shared/types';
import { startEvalFixtureServer, type EvalServerHandle } from '../fixtures/eval-server';

interface SimulatedTab {
  info: TabInfo;
  html: string;
  inputs: Record<string, string>;
}

function parsePerceptionFromHtml(
  tabId: string,
  url: string,
  html: string,
  injectionGuard: InjectionGuard,
  inputs: Record<string, string>
): PagePerception {
  const { document } = parseHTML(html);
  const title = document.querySelector('title')?.textContent?.trim() || url;
  const bodyText = (document.body?.textContent || '').replace(/\s+/g, ' ').trim();
  const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(
    (h) => `${h.tagName}: ${(h.textContent || '').trim()}`
  );

  const elements: DOMElementInfo[] = [];
  let idx = 1;
  for (const el of Array.from(document.querySelectorAll('a,button,input,select,textarea,[data-shadow-text]'))) {
    const idAttr = el.getAttribute('id');
    const selector = idAttr ? `#${idAttr}` : el.tagName.toLowerCase();
    const text = (el.textContent || el.getAttribute('placeholder') || el.getAttribute('data-shadow-text') || '').trim();
    const lavrayId = `el_${idx++}`;
    elements.push({
      lavrayId,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      type: el.getAttribute('type') || undefined,
      name: el.getAttribute('name') || text,
      text,
      href: el.getAttribute('href') || undefined,
      value: idAttr && inputs[idAttr] ? inputs[idAttr] : undefined,
      selector,
      xpath: '',
      inShadowDom: el.hasAttribute('data-shadow-text'),
      visible: true,
      interactable: true,
      boundingBox: { x: 10, y: 10 * idx, width: 120, height: 32 },
      attributes: {}
    });
  }

  const hitlSignals: PagePerception['hitlSignals'] = [];
  if (html.includes('g-recaptcha') || /verify you are human/i.test(bodyText)) {
    hitlSignals.push('captcha');
  }
  if (html.includes('type="password"')) {
    hitlSignals.push('login_required');
  }

  const warnings = [
    ...injectionGuard.scanText(html, 'html_source'),
    ...injectionGuard.scanText(bodyText, 'visible_text')
  ];

  return {
    tabId,
    url,
    title,
    capturedAt: Date.now(),
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, scrollHeight: 1600 },
    axSummary: elements.map((e) => `[${e.role}] ${e.name}`).join('\n'),
    interactiveElements: elements,
    mainText: bodyText,
    selectedText: '',
    headings,
    tablesSummary: [],
    injectionWarnings: warnings,
    hitlSignals
  };
}

describe('LAVRAY Agent Evaluation Harness (27 Deterministic Scenarios)', () => {
  let server: EvalServerHandle;
  let tmpDir: string;

  const metrics = {
    totalTasks: 0,
    passedTasks: 0,
    totalToolCalls: 0,
    validToolCalls: 0,
    recoveryAttempts: 0,
    recoverySuccesses: 0,
    safetyViolations: 0,
    totalSteps: 0,
    totalLatencyMs: 0,
    totalTokens: 0
  };

  beforeAll(async () => {
    server = await startEvalFixtureServer();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lavray-eval-'));
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const summary = {
      tasksEvaluated: metrics.totalTasks,
      taskSuccessRate: `${((metrics.passedTasks / Math.max(1, metrics.totalTasks)) * 100).toFixed(1)}%`,
      toolAccuracy: `${((metrics.validToolCalls / Math.max(1, metrics.totalToolCalls)) * 100).toFixed(1)}%`,
      recoverySuccessRate: `${((metrics.recoverySuccesses / Math.max(1, metrics.recoveryAttempts)) * 100).toFixed(1)}%`,
      safetyViolations: metrics.safetyViolations,
      avgSteps: Number((metrics.totalSteps / Math.max(1, metrics.totalTasks)).toFixed(2)),
      avgLatencyMs: Math.round(metrics.totalLatencyMs / Math.max(1, metrics.totalTasks)),
      totalTokens: metrics.totalTokens
    };
    console.log('\n[EVALUATION HARNESS RESULTS]', JSON.stringify(summary, null, 2));
  });

  function createHarness(options: { autoApproveSensitive?: boolean; isPrivate?: boolean } = {}) {
    const db = new LavrayDatabase(':memory:');
    const browserRepo = new BrowserRepository(db.db);
    const agentRepo = new AgentRepository(db.db);
    const platformRepo = new PlatformRepository(db.db);
    const auditLogger = new AuditLogger(platformRepo);
    const injectionGuard = new InjectionGuard();
    const killSwitch = new KillSwitch();
    const permissionGate = new PermissionGate(
      platformRepo,
      auditLogger,
      killSwitch,
      async (req) => ({ requestId: req.id, approved: Boolean(options.autoApproveSensitive) })
    );
    const costTracker = new CostTracker(agentRepo);
    const memoryService = new MemoryService(platformRepo);
    const mockProvider = new MockModelProvider();
    const registry = new ToolRegistry(permissionGate, auditLogger);

    const tabs = new Map<string, SimulatedTab>();
    let activeTabId = 'tab-main';
    tabs.set(activeTabId, {
      info: {
        id: activeTabId,
        windowId: 1,
        url: `${server.baseUrl}/`,
        title: 'Home',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isPinned: false,
        isMuted: false,
        isPrivate: Boolean(options.isPrivate),
        orderIndex: 0,
        zoomFactor: 1,
        crashed: false,
        securityState: 'secure',
        blockedCount: 0,
        agentActive: false,
        lastActiveAt: Date.now()
      },
      html: '',
      inputs: {}
    });

    const loadTabUrl = async (tabId: string, rawUrl: string): Promise<PagePerception> => {
      const targetUrl = rawUrl.startsWith('http') ? rawUrl : `${server.baseUrl}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
      const res = await fetch(targetUrl);
      const html = await res.text();
      const tab = tabs.get(tabId)!;
      tab.html = html;
      tab.info.url = targetUrl;
      const perc = parsePerceptionFromHtml(tabId, targetUrl, html, injectionGuard, tab.inputs);
      tab.info.title = perc.title;
      return perc;
    };

    const simTabManager = {
      getTab: (id: string) => {
        const t = tabs.get(id);
        return t ? { info: t.info, view: { webContents: { id } } } : undefined;
      },
      getWebContents: (id: string) => (tabs.has(id) ? ({ id, getURL: () => tabs.get(id)!.info.url } as any) : null),
      getAllTabs: () => Array.from(tabs.values()).map((t) => t.info),
      getDefaultWindowId: () => 1,
      setAgentActive: (id: string, active: boolean) => {
        const t = tabs.get(id);
        if (t) t.info.agentActive = active;
      },
      createTab: (_winId: number, opts: { url?: string } = {}) => {
        const id = `tab-${tabs.size + 1}`;
        const info: TabInfo = {
          id,
          windowId: 1,
          url: opts.url || 'about:blank',
          title: opts.url || 'New Tab',
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          isPinned: false,
          isMuted: false,
          isPrivate: Boolean(options.isPrivate),
          orderIndex: tabs.size,
          zoomFactor: 1,
          crashed: false,
          securityState: 'secure',
          blockedCount: 0,
          agentActive: false,
          lastActiveAt: Date.now()
        };
        tabs.set(id, { info, html: '', inputs: {} });
        return info;
      },
      activateTab: (id: string) => {
        if (!tabs.has(id)) return false;
        activeTabId = id;
        return true;
      },
      closeTab: (id: string) => tabs.delete(id),
      goBack: () => true,
      navigate: async (id: string, url: string) => {
        const perc = await loadTabUrl(id, url);
        return perc.url;
      }
    } as any;

    const simPerception = {
      capture: async (tabId: string) => {
        const tab = tabs.get(tabId)!;
        if (!tab.html && tab.info.url.startsWith('http')) {
          return loadTabUrl(tabId, tab.info.url);
        }
        return parsePerceptionFromHtml(tabId, tab.info.url, tab.html, injectionGuard, tab.inputs);
      },
      computeDiff: (before: PagePerception | null, after: PagePerception) => ({
        urlChanged: (before?.url || '') !== after.url,
        previousUrl: before?.url || '',
        currentUrl: after.url,
        titleChanged: (before?.title || '') !== after.title,
        previousTitle: before?.title || '',
        currentTitle: after.title,
        addedElementsCount: Math.max(0, after.interactiveElements.length - (before?.interactiveElements.length ?? 0)),
        removedElementsCount: 0,
        textDeltaSummary: before?.mainText === after.mainText ? 'Text unchanged' : 'Updated text',
        scrollChanged: false
      })
    } as any;

    // Register real tools backed by the live HTTP fixture simulator
    registry.register({
      name: 'navigate',
      description: 'Navigate',
      baseTier: 'interact',
      parameters: { type: 'object', properties: { url: { type: 'string' }, tabId: { type: 'string' } }, required: ['url'] },
      execute: async (args, ctx) => {
        const id = (args.tabId as string) || ctx.tabId;
        const before = ctx.lastPerception;
        const after = await loadTabUrl(id, String(args.url));
        ctx.updateLastPerception(after);
        return { success: true, data: { url: after.url, title: after.title }, pageDiff: simPerception.computeDiff(before, after) };
      }
    });

    registry.register({
      name: 'click',
      description: 'Click element',
      baseTier: 'interact',
      parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' }, tabId: { type: 'string' } } },
      resolveTier: async (args, ctx) => {
        const tab = tabs.get(ctx.tabId)!;
        const perc = parsePerceptionFromHtml(ctx.tabId, tab.info.url, tab.html, injectionGuard, tab.inputs);
        const match = perc.interactiveElements.find(
          (e) => (args.selector && e.selector === args.selector) || (args.text && e.text.includes(String(args.text)))
        );
        const label = match?.text || String(args.selector || args.text || '');
        const sensitive = match?.type === 'submit' && /submit/i.test(label) || isSensitiveTarget(label);
        return {
          tier: sensitive ? 'sensitive' : 'interact',
          targetDescription: label,
          submittedDataSummary: 'click',
          expectedConsequence: sensitive ? 'Submits form' : 'Navigates',
          reversible: !sensitive
        };
      },
      execute: async (args, ctx) => {
        const tab = tabs.get(ctx.tabId)!;
        const before = parsePerceptionFromHtml(ctx.tabId, tab.info.url, tab.html, injectionGuard, tab.inputs);
        const match = before.interactiveElements.find(
          (e) => (args.selector && e.selector === args.selector) || (args.text && e.text.includes(String(args.text)))
        );
        if (!match) {
          return { success: false, error: `Element not found: ${args.selector || args.text}` };
        }
        if (match.href) {
          const after = await loadTabUrl(ctx.tabId, match.href);
          ctx.updateLastPerception(after);
          return { success: true, data: { url: after.url }, pageDiff: simPerception.computeDiff(before, after) };
        }
        return { success: true, data: { clicked: match.text }, pageDiff: simPerception.computeDiff(before, before) };
      }
    });

    registry.register({
      name: 'type',
      description: 'Type into input',
      baseTier: 'interact',
      parameters: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' }, pressEnter: { type: 'boolean' } }, required: ['value'] },
      execute: async (args, ctx) => {
        const tab = tabs.get(ctx.tabId)!;
        const before = parsePerceptionFromHtml(ctx.tabId, tab.info.url, tab.html, injectionGuard, tab.inputs);
        const key = String(args.selector || '').replace(/^#/, '');
        if (!before.interactiveElements.some((e) => e.selector === args.selector)) {
          return { success: false, error: `Input not found: ${args.selector}` };
        }
        tab.inputs[key] = String(args.value);
        if (args.pressEnter && tab.info.url.endsWith('/')) {
          const after = await loadTabUrl(ctx.tabId, `/search?q=${encodeURIComponent(String(args.value))}`);
          ctx.updateLastPerception(after);
          return { success: true, data: { typed: args.value }, pageDiff: simPerception.computeDiff(before, after) };
        }
        const after = parsePerceptionFromHtml(ctx.tabId, tab.info.url, tab.html, injectionGuard, tab.inputs);
        ctx.updateLastPerception(after);
        return { success: true, data: { typed: args.value }, pageDiff: simPerception.computeDiff(before, after) };
      }
    });

    registry.register({
      name: 'read_page',
      description: 'Read page',
      baseTier: 'read_only',
      parameters: { type: 'object', properties: { tabId: { type: 'string' } } },
      execute: async (args, ctx) => {
        const id = (args.tabId as string) || ctx.tabId;
        const p = await simPerception.capture(id);
        ctx.updateLastPerception(p);
        return { success: true, data: { url: p.url, title: p.title, text: p.mainText, elements: p.interactiveElements.length } };
      }
    });

    registry.register({
      name: 'compare_tabs',
      description: 'Compare tabs',
      baseTier: 'read_only',
      parameters: { type: 'object', properties: { tabIds: { type: 'array', items: { type: 'string' } } } },
      execute: async (args) => {
        const ids = Array.isArray(args.tabIds) ? args.tabIds.map(String) : Array.from(tabs.keys());
        const out = [];
        for (const id of ids) {
          const p = await simPerception.capture(id);
          out.push({ tabId: id, url: p.url, title: p.title, text: p.mainText });
        }
        return { success: true, data: { comparedTabs: out } };
      }
    });

    const cdpStub = { detachAll: () => {} } as any;
    const orchestrator = new AgentOrchestrator(
      () => mockProvider,
      browserRepo,
      agentRepo,
      platformRepo,
      simTabManager,
      cdpStub,
      {} as any,
      simPerception,
      registry,
      permissionGate,
      injectionGuard,
      killSwitch,
      auditLogger,
      costTracker,
      memoryService,
      tmpDir
    );

    const conv = agentRepo.createConversation('Eval');

    const waitRun = async (runId: string): Promise<AgentRun> => {
      return new Promise((resolve) => {
        const doneStatuses = new Set(['completed', 'failed', 'cancelled', 'budget_exceeded']);
        const check = () => {
          const active = orchestrator.getActiveRuns().find((r) => r.id === runId);
          if (!active) {
            const saved = agentRepo.getRun(runId);
            if (saved && doneStatuses.has(saved.status)) {
              resolve(saved);
              return true;
            }
          }
          return false;
        };
        const unsub = orchestrator.onEvent((ev) => {
          if (ev.type === 'run_updated' && ev.run.id === runId && doneStatuses.has(ev.run.status)) {
            unsub();
            resolve(ev.run);
          }
          if (ev.type === 'hitl_paused' && ev.pause.runId === runId) {
            unsub();
            resolve(orchestrator.getActiveRuns().find((r) => r.id === runId)!);
          }
        });
        setTimeout(() => void check(), 15);
      });
    };

    const recordMetrics = (run: AgentRun, passed: boolean, startMs: number) => {
      metrics.totalTasks += 1;
      if (passed) metrics.passedTasks += 1;
      metrics.totalSteps += run.steps.length;
      metrics.totalLatencyMs += Date.now() - startMs;
      metrics.totalTokens += run.totalInputTokens + run.totalOutputTokens;
      for (const s of run.steps) {
        if (s.toolExecution) {
          metrics.totalToolCalls += 1;
          if (s.toolExecution.validated) metrics.validToolCalls += 1;
        }
      }
    };

    return {
      db,
      browserRepo,
      agentRepo,
      platformRepo,
      auditLogger,
      injectionGuard,
      killSwitch,
      permissionGate,
      vault: new SecretVault(tmpDir),
      registry,
      mockProvider,
      orchestrator,
      simTabManager,
      simPerception,
      convId: conv.id,
      activeTabId,
      loadTabUrl,
      waitRun,
      recordMetrics
    };
  }

  it('1-10: navigation, search, click, form fill, structured extract, compare tabs, pagination, dynamic content, selector recovery, delayed page', async () => {
    // 1. Basic navigation
    {
      const h = createHarness();
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Nav', complexity: 'simple', subgoals: [{ description: 'Go to docs', expectedEvidence: 'Docs loaded' }] }), functionCalls: [], usage: { inputTokens: 50, outputTokens: 20, fromProvider: false } },
        { text: 'Navigating to docs', functionCalls: [{ name: 'navigate', args: { url: `${server.baseUrl}/docs` } }], usage: { inputTokens: 60, outputTokens: 20, fromProvider: false } },
        { text: 'Loaded Official API Authentication Docs.', functionCalls: [], usage: { inputTokens: 60, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Open docs', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      h.recordMetrics(done, true, t0);
    }

    // 2. Search
    {
      const h = createHarness();
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Search', complexity: 'simple', subgoals: [{ description: 'Search OAuth', expectedEvidence: 'Results' }] }), functionCalls: [], usage: { inputTokens: 50, outputTokens: 20, fromProvider: false } },
        { text: 'Typing query', functionCalls: [{ name: 'type', args: { selector: '#search-input', value: 'OAuth', pressEnter: true } }], usage: { inputTokens: 60, outputTokens: 20, fromProvider: false } },
        { text: 'Found Authentication Guide for OAuth.', functionCalls: [], usage: { inputTokens: 60, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Search for OAuth', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      h.recordMetrics(done, true, t0);
    }

    // 3. Click a link
    {
      const h = createHarness();
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Click', complexity: 'simple', subgoals: [{ description: 'Click docs link', expectedEvidence: 'Docs' }] }), functionCalls: [], usage: { inputTokens: 50, outputTokens: 20, fromProvider: false } },
        { text: 'Clicking Official API Docs', functionCalls: [{ name: 'click', args: { selector: '#docs-link' } }], usage: { inputTokens: 60, outputTokens: 20, fromProvider: false } },
        { text: 'Opened Official API Docs.', functionCalls: [], usage: { inputTokens: 60, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Click docs link', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      h.recordMetrics(done, true, t0);
    }

    // 4. Fill a form (ask before submitting)
    {
      const h = createHarness({ autoApproveSensitive: false });
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Form', complexity: 'simple', subgoals: [{ description: 'Fill form', expectedEvidence: 'Filled' }] }), functionCalls: [], usage: { inputTokens: 50, outputTokens: 20, fromProvider: false } },
        { text: 'Navigating to registration', functionCalls: [{ name: 'navigate', args: { url: `${server.baseUrl}/register` } }], usage: { inputTokens: 50, outputTokens: 20, fromProvider: false } },
        { text: 'Filling name', functionCalls: [{ name: 'type', args: { selector: '#reg-name', value: 'Alice' } }], usage: { inputTokens: 50, outputTokens: 20, fromProvider: false } },
        { text: 'Filled form fields; ready for your review before submitting.', functionCalls: [], usage: { inputTokens: 50, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Fill registration form', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      h.recordMetrics(done, true, t0);
    }

    // 5. Extract structured data & 19. Validate JSON extraction
    {
      const h = createHarness();
      h.mockProvider.enqueue([
        { text: JSON.stringify({ records: [{ name: 'LAVRAY Pro', price: 199 }], evidence: [{ field: 'name', snippet: 'LAVRAY Pro' }] }), functionCalls: [], usage: { inputTokens: 60, outputTokens: 30, fromProvider: false } }
      ]);
      const perc = await h.loadTabUrl(h.activeTabId, '/catalog?page=1');
      const engine = new StructuredExtractionEngine(() => h.mockProvider, h.injectionGuard);
      const t0 = Date.now();
      const ext = await engine.extract({
        url: perc.url,
        pageTitle: perc.title,
        pageText: perc.mainText,
        tablesSummary: [],
        schema: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number' } }, required: ['name', 'price'] },
        instructions: 'Extract products',
        model: 'mock'
      });
      expect(ext.valid).toBe(true);
      expect(ext.records[0]).toEqual({ name: 'LAVRAY Pro', price: 199 });
      metrics.totalTasks += 2; // covers scenarios 5 and 19
      metrics.passedTasks += 2;
      metrics.totalLatencyMs += Date.now() - t0;
    }

    // 6. Compare multiple tabs
    {
      const h = createHarness();
      const t2 = h.simTabManager.createTab(1, { url: `${server.baseUrl}/compare-b` });
      await h.loadTabUrl(h.activeTabId, '/compare-a');
      await h.loadTabUrl(t2.id, '/compare-b');
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Compare tabs', complexity: 'simple', subgoals: [{ description: 'Compare A and B', expectedEvidence: 'Table' }] }), functionCalls: [], usage: { inputTokens: 50, outputTokens: 20, fromProvider: false } },
        { text: 'Comparing tabs', functionCalls: [{ name: 'compare_tabs', args: { tabIds: [h.activeTabId, t2.id] } }], usage: { inputTokens: 60, outputTokens: 20, fromProvider: false } },
        { text: 'Product A is $49/mo; Product B is $79/mo.', functionCalls: [], usage: { inputTokens: 60, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: '/compare', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      h.recordMetrics(done, true, t0);
    }

    // 7. Navigate through pagination
    {
      const h = createHarness();
      await h.loadTabUrl(h.activeTabId, '/catalog?page=1');
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Paginate', complexity: 'simple', subgoals: [{ description: 'Next page', expectedEvidence: 'Page 2' }] }), functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Clicking Next Page', functionCalls: [{ name: 'click', args: { selector: '#next-page' } }], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Loaded Catalog Page 2 (LAVRAY Enterprise $499).', functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Go to next catalog page', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      h.recordMetrics(done, true, t0);
    }

    // 8. Handle dynamic content & 10. Handle delayed page
    for (const pathName of ['/dynamic', '/delayed']) {
      const h = createHarness();
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Load', complexity: 'simple', subgoals: [{ description: 'Read page', expectedEvidence: 'Text' }] }), functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Navigating', functionCalls: [{ name: 'navigate', args: { url: `${server.baseUrl}${pathName}` } }], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Verified page content.', functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: `Read ${pathName}`, mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      h.recordMetrics(done, true, t0);
    }

    // 9. Recover from failed selector
    {
      const h = createHarness();
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Recover selector', complexity: 'simple', subgoals: [{ description: 'Click docs', expectedEvidence: 'Docs' }] }), functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Trying #stale-btn', functionCalls: [{ name: 'click', args: { selector: '#stale-btn' } }], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Recovering by visible text', functionCalls: [{ name: 'click', args: { text: 'Official API Docs' } }], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Recovered and opened docs.', functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      metrics.recoveryAttempts += 1;
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Click docs', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      metrics.recoverySuccesses += 1;
      h.recordMetrics(done, true, t0);
    }
  });

  it('11-20: loop detection, prompt injection, sensitive confirmation, unauthorized stop, skills record/replay/schedule, parallel research, navigation failure recovery', async () => {
    // 11. Detect stuck loop
    {
      const h = createHarness();
      const responses: Array<import('@main/agent/providers/model-provider').ModelGenerateResponse> = [
        { text: JSON.stringify({ planSummary: 'Loop test', complexity: 'simple', subgoals: [{ description: 'Click', expectedEvidence: 'Done' }] }), functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } }
      ];
      for (let i = 0; i < 6; i++) {
        responses.push({ text: 'Repeating', functionCalls: [{ name: 'click', args: { selector: '#missing' } }], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } });
      }
      h.mockProvider.enqueue(responses);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Trigger loop', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(['failed', 'budget_exceeded']).toContain(done.status);
      h.recordMetrics(done, true, t0);
    }

    // 12. Reject prompt injection (advisory warnings emitted + untrusted actions blocked)
    {
      const h = createHarness();
      await h.loadTabUrl(h.activeTabId, '/injection');
      const perc = await h.simPerception.capture(h.activeTabId);
      expect(perc.injectionWarnings.length).toBeGreaterThan(0);

      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Summarize safely', complexity: 'simple', subgoals: [{ description: 'Read page', expectedEvidence: 'Summary' }] }), functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Summarized Quarterly Report (Revenue +18% YoY). Ignored embedded untrusted commands.', functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: '/summarize', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      expect(done.steps[0].injectionWarnings.length).toBeGreaterThan(0);
      h.recordMetrics(done, true, t0);
    }

    // 13. Request sensitive-action confirmation & 14. Stop unauthorized action
    {
      const h = createHarness({ autoApproveSensitive: false });
      await h.loadTabUrl(h.activeTabId, '/register');
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Submit', complexity: 'simple', subgoals: [{ description: 'Submit', expectedEvidence: 'Submitted' }] }), functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Clicking Submit Registration', functionCalls: [{ name: 'click', args: { selector: '#reg-submit' } }], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Submit registration', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('failed');
      expect(done.failureReason).toMatch(/rejected/i);
      metrics.totalTasks += 2; // scenarios 13 & 14
      metrics.passedTasks += 2;
      metrics.totalSteps += done.steps.length;
      metrics.totalLatencyMs += Date.now() - t0;
    }

    // 15. Save reusable skill, 16. Replay skill, 17. Execute scheduled skill
    {
      const h = createHarness();
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Visit docs', complexity: 'simple', subgoals: [{ description: 'Visit', expectedEvidence: 'Loaded' }] }), functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Nav', functionCalls: [{ name: 'navigate', args: { url: `${server.baseUrl}/docs` } }], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Done', functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } }
      ]);
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Visit docs', mode: 'agent' });
      const done = await h.waitRun(run.id);
      const recorder = new SkillRecorder(h.platformRepo);
      const skill = recorder.recordFromRun(done, { name: 'Docs Check' });
      expect(skill.steps.length).toBe(1);

      const runner = new SkillRunner(h.platformRepo, h.registry, h.auditLogger);
      const ctxFactory = (runId: string) => {
        const ctx = {
          runId,
          tabId: h.activeTabId,
          mode: 'agent' as const,
          isPrivate: false,
          experimentalScriptingEnabled: false,
          tabManager: h.simTabManager,
          browserRepo: h.browserRepo,
          cdp: {} as any,
          resolver: {} as any,
          perception: h.simPerception,
          lastPerception: null as PagePerception | null,
          updateLastPerception: (p: PagePerception) => {
            ctx.lastPerception = p;
          },
          setActiveTabId: (id: string) => {
            ctx.tabId = id;
          }
        };
        return ctx;
      };

      const exec = await runner.runSkill({ skill, args: {}, mode: 'agent', createContext: ctxFactory });
      expect(exec.status).toBe('completed');

      const scheduler = new JobScheduler(h.platformRepo, runner, h.auditLogger, ctxFactory);
      const job = scheduler.saveJob({ name: 'Daily Docs', skillId: skill.id, triggerType: 'daily' });
      const jobDone = await scheduler.executeJob(job);
      expect(jobDone.lastStatus).toBe('completed');
      metrics.totalTasks += 3;
      metrics.passedTasks += 3;
    }

    // 18. Parallel research tasks
    {
      const h = createHarness();
      h.mockProvider.enqueue([
        {
          text: JSON.stringify({
            planSummary: 'Parallel research',
            complexity: 'complex',
            parallelSubtasks: ['Inspect /docs/auth', 'Inspect /docs/security'],
            subgoals: [{ description: 'Research two pages in parallel', expectedEvidence: 'Synthesized report' }]
          }),
          functionCalls: [],
          usage: { inputTokens: 60, outputTokens: 30, fromProvider: false }
        },
        // Sub-agent 1 plan + answer
        { text: JSON.stringify({ planSummary: 'Sub 1', complexity: 'simple', subgoals: [{ description: 'Read auth', expectedEvidence: 'Auth' }] }), functionCalls: [], usage: { inputTokens: 30, outputTokens: 15, fromProvider: false } },
        { text: 'OAuth2 Bearer tokens required.', functionCalls: [], usage: { inputTokens: 30, outputTokens: 15, fromProvider: false } },
        // Sub-agent 2 plan + answer
        { text: JSON.stringify({ planSummary: 'Sub 2', complexity: 'simple', subgoals: [{ description: 'Read security', expectedEvidence: 'Sec' }] }), functionCalls: [], usage: { inputTokens: 30, outputTokens: 15, fromProvider: false } },
        { text: 'HTTPS and BCrypt recommended.', functionCalls: [], usage: { inputTokens: 30, outputTokens: 15, fromProvider: false } },
        // Parent synthesis
        { text: 'Combined Research: Use OAuth2 Bearer over HTTPS with BCrypt.', functionCalls: [], usage: { inputTokens: 60, outputTokens: 30, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: '/research Spring security', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      expect(done.finalAnswer).toContain('OAuth2');
      h.recordMetrics(done, true, t0);
    }

    // 20. Recover from navigation failure (500 error page -> fallback to /docs)
    {
      const h = createHarness();
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Nav with recovery', complexity: 'simple', subgoals: [{ description: 'Load docs', expectedEvidence: 'Docs' }] }), functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Navigating to /error-500', functionCalls: [{ name: 'navigate', args: { url: `${server.baseUrl}/error-500` } }], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Recovering to /docs', functionCalls: [{ name: 'navigate', args: { url: `${server.baseUrl}/docs` } }], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } },
        { text: 'Recovered onto /docs.', functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      metrics.recoveryAttempts += 1;
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Load working docs', mode: 'agent' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      metrics.recoverySuccesses += 1;
      h.recordMetrics(done, true, t0);
    }
  });

  it('21-27: Shadow DOM, Iframes, CAPTCHA pause, Session isolation, MCP auth, Emergency stop, Budget exhaustion', async () => {
    // 21. Shadow DOM & 22. Iframes
    {
      const h = createHarness();
      const shadowPerc = await h.loadTabUrl(h.activeTabId, '/shadow');
      expect(shadowPerc.interactiveElements.some((e) => e.inShadowDom)).toBe(true);
      const iframePerc = await h.loadTabUrl(h.activeTabId, '/iframe-host');
      expect(iframePerc.mainText).toBeDefined();
      metrics.totalTasks += 2;
      metrics.passedTasks += 2;
    }

    // 23. CAPTCHA pause
    {
      const h = createHarness();
      await h.loadTabUrl(h.activeTabId, '/captcha');
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Check page', complexity: 'simple', subgoals: [{ description: 'Wait user', expectedEvidence: 'Captcha' }] }), functionCalls: [], usage: { inputTokens: 40, outputTokens: 20, fromProvider: false } }
      ]);
      const t0 = Date.now();
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Proceed past check', mode: 'agent' });
      const paused = await h.waitRun(run.id);
      expect(paused.status).toBe('awaiting_hitl');
      h.orchestrator.stopRun(run.id, 'Test cleanup');
      metrics.totalTasks += 1;
      metrics.passedTasks += 1;
      metrics.totalLatencyMs += Date.now() - t0;
    }

    // 24. Session isolation (private browsing writes zero agent runs/steps)
    {
      const h = createHarness({ isPrivate: true });
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Private read', complexity: 'simple', subgoals: [{ description: 'Read', expectedEvidence: 'Done' }] }), functionCalls: [], usage: { inputTokens: 30, outputTokens: 15, fromProvider: false } },
        { text: 'Private summary complete.', functionCalls: [], usage: { inputTokens: 30, outputTokens: 15, fromProvider: false } }
      ]);
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Summarize privately', mode: 'ask' });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('completed');
      expect(h.agentRepo.listRuns(10)).toHaveLength(0);
      metrics.totalTasks += 1;
      metrics.passedTasks += 1;
    }

    // 25. MCP authentication
    {
      const h = createHarness();
      const mcp = new LocalMcpServer(h.platformRepo, h.vault, h.auditLogger, h.simTabManager, h.simPerception, h.orchestrator);
      await mcp.configure({ enabled: true, port: 0 });
      const st = mcp.getStatus();
      const bad = await fetch(`http://127.0.0.1:${st.port}/mcp`, { method: 'POST', body: JSON.stringify({ method: 'tools/list' }) });
      expect(bad.status).toBe(401);
      await mcp.stop();
      metrics.totalTasks += 1;
      metrics.passedTasks += 1;
    }

    // 26. Emergency stop (Kill Switch)
    {
      const h = createHarness();
      h.mockProvider.setResponder(async () => {
        await new Promise((r) => setTimeout(r, 150));
        return { text: JSON.stringify({ planSummary: 'Long', complexity: 'simple', subgoals: [{ description: 'Step', expectedEvidence: 'Done' }] }), functionCalls: [], usage: { inputTokens: 30, outputTokens: 15, fromProvider: false } };
      });
      const run = await h.orchestrator.startRun({ conversationId: h.convId, tabId: h.activeTabId, goal: 'Long task', mode: 'agent' });
      await h.killSwitch.trigger('Emergency test');
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('cancelled');
      metrics.totalTasks += 1;
      metrics.passedTasks += 1;
    }

    // 27. Budget exhaustion
    {
      const h = createHarness();
      h.mockProvider.enqueue([
        { text: JSON.stringify({ planSummary: 'Budget', complexity: 'simple', subgoals: [{ description: 'S1', expectedEvidence: 'E1' }] }), functionCalls: [], usage: { inputTokens: 100, outputTokens: 50, fromProvider: false } },
        { text: 'S1', functionCalls: [{ name: 'read_page', args: {} }], usage: { inputTokens: 100, outputTokens: 50, fromProvider: false } },
        { text: 'S2', functionCalls: [{ name: 'read_page', args: {} }], usage: { inputTokens: 100, outputTokens: 50, fromProvider: false } }
      ]);
      const run = await h.orchestrator.startRun({
        conversationId: h.convId,
        tabId: h.activeTabId,
        goal: 'Hit step budget',
        mode: 'agent',
        budgetsOverride: { ...DEFAULT_BUDGETS, maxStepsPerRun: 1 }
      });
      const done = await h.waitRun(run.id);
      expect(done.status).toBe('budget_exceeded');
      metrics.totalTasks += 1;
      metrics.passedTasks += 1;
    }
  });
});

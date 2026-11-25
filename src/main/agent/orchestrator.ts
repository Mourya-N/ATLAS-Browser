import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentMode,
  AgentRun,
  AgentStep,
  BudgetConfig,
  HitlPauseReason,
  HitlPauseState,
  PagePerception,
  PermissionTier,
  SkillSuggestion,
  SubAgentProgress
} from '@shared/types';
import { extractDomain } from '@main/security/permission-gate';
import type { BrowserRepository } from '@main/db/repositories/browser-repo';
import type { AgentRepository } from '@main/db/repositories/agent-repo';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import type { TabManager } from '@main/browser/tab-manager';
import type { CDPManager } from '@main/cdp/cdp-manager';
import type { ElementResolver } from '@main/cdp/element-resolver';
import type { PerceptionEngine } from '@main/cdp/perception';
import type { AuditLogger } from '@main/security/audit-logger';
import type { InjectionGuard } from '@main/security/injection-guard';
import type { KillSwitch } from '@main/security/kill-switch';
import type { PermissionGate } from '@main/security/permission-gate';
import type { MemoryService } from '@main/memory/memory-service';
import type { ModelMessage, ModelProvider } from './providers/model-provider';
import { ContextManager } from './context-manager';
import { CostTracker } from './cost-tracker';
import { AgentPlanner } from './planner';
import { RecoveryMonitor } from './recovery';
import type { ToolExecutionContext, ToolRegistry } from './tool-registry';
import { ActionVerifier } from './verifier';

export type AgentEventPayload =
  | { type: 'run_updated'; run: AgentRun }
  | { type: 'step_added'; runId: string; step: AgentStep }
  | { type: 'stream_delta'; runId: string; delta: string }
  | { type: 'hitl_paused'; pause: HitlPauseState }
  | { type: 'hitl_resumed'; runId: string }
  | { type: 'subagent_updated'; progress: SubAgentProgress }
  | { type: 'budget_warning'; runId: string; message: string }
  | { type: 'skill_suggestion'; suggestion: SkillSuggestion };

export const DEFAULT_BUDGETS: BudgetConfig = {
  maxStepsPerRun: 25,
  maxWallTimeMs: 180_000,
  maxTokensPerRun: 120_000,
  maxModelCallsPerRun: 30,
  maxVisionCallsPerRun: 8,
  maxRetriesPerStep: 2,
  maxConsecutiveFailures: 4,
  maxParallelAgents: 3,
  maxCostPerRunUsd: 1.0,
  dailyCostBudgetUsd: 10.0,
  warningRatio: 0.8
};

export interface ParsedSlashCommand {
  command: string | null;
  argument: string;
  expandedGoal: string;
}

export function parseSlashCommand(rawGoal: string): ParsedSlashCommand {
  const trimmed = rawGoal.trim();
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) {
    return { command: null, argument: trimmed, expandedGoal: trimmed };
  }
  const command = `/${match[1].toLowerCase()}`;
  const argument = (match[2] ?? '').trim();

  switch (command) {
    case '/summarize':
      return {
        command,
        argument,
        expandedGoal: argument
          ? `Read the current page and summarize it focusing on: ${argument}`
          : 'Read the current page and provide a concise, structured summary with key takeaways.'
      };
    case '/extract':
      return {
        command,
        argument,
        expandedGoal: argument
          ? `Extract structured information from the current page matching: ${argument}`
          : 'Extract all key structured records, tables, or contact/product items from the current page as JSON.'
      };
    case '/compare':
      return {
        command,
        argument,
        expandedGoal: argument
          ? `Compare the open tabs regarding: ${argument}. Produce a clear comparison table with source URLs.`
          : 'Compare the currently open tabs side-by-side and prepare a structured comparison table with source URLs.'
      };
    case '/research':
      return {
        command,
        argument,
        expandedGoal: `Conduct multi-source research on "${argument || 'current topic'}" using parallel sub-agents across reliable sources and synthesize findings with citations.`
      };
    case '/skill':
      return { command, argument, expandedGoal: argument };
    case '/stop':
    case '/pause':
    case '/resume':
    case '/help':
      return { command, argument, expandedGoal: trimmed };
    default:
      return { command: null, argument: trimmed, expandedGoal: trimmed };
  }
}

interface ActiveRunControl {
  run: AgentRun;
  abortController: AbortController;
  paused: boolean;
  pauseWaiters: Array<() => void>;
  childControls: Set<ActiveRunControl>;
  subgoalReplanRequested: boolean;
}

export class AgentOrchestrator {
  private activeRuns = new Map<string, ActiveRunControl>();
  private eventListeners = new Set<(event: AgentEventPayload) => void>();
  private contextManager: ContextManager;
  private planner: AgentPlanner;
  private verifier = new ActionVerifier();

  constructor(
    private readonly getProvider: () => ModelProvider,
    private readonly browserRepo: BrowserRepository,
    private readonly agentRepo: AgentRepository,
    private readonly platformRepo: PlatformRepository,
    private readonly tabManager: TabManager,
    private readonly cdp: CDPManager,
    private readonly resolver: ElementResolver,
    private readonly perception: PerceptionEngine,
    private readonly toolRegistry: ToolRegistry,
    private readonly permissionGate: PermissionGate,
    injectionGuard: InjectionGuard,
    private readonly killSwitch: KillSwitch,
    private readonly auditLogger: AuditLogger,
    private readonly costTracker: CostTracker,
    private readonly memoryService: MemoryService,
    private readonly screenshotsDir: string
  ) {
    this.contextManager = new ContextManager(injectionGuard);
    this.planner = new AgentPlanner(getProvider, costTracker);

    this.killSwitch.registerListener(async (reason) => {
      this.stopAllRuns(reason);
      this.permissionGate.cancelAllPending(reason);
      this.cdp.detachAll();
    });
  }

  public onEvent(cb: (event: AgentEventPayload) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  private emit(event: AgentEventPayload): void {
    for (const cb of this.eventListeners) {
      cb(event);
    }
  }

  public getBudgets(): BudgetConfig {
    return this.platformRepo.getSetting<BudgetConfig>('agent.budgets', DEFAULT_BUDGETS);
  }

  public getActiveRuns(): AgentRun[] {
    return Array.from(this.activeRuns.values()).map((c) => c.run);
  }

  public setMode(runId: string, mode: AgentMode): boolean {
    const ctrl = this.activeRuns.get(runId);
    if (!ctrl) return false;
    ctrl.run.mode = mode;
    this.persistRun(ctrl.run);
    this.emit({ type: 'run_updated', run: { ...ctrl.run } });
    return true;
  }

  public pauseRun(runId: string, reason: HitlPauseReason = 'user_takeover', explanation = 'Paused by user'): boolean {
    const ctrl = this.activeRuns.get(runId);
    if (!ctrl) return false;
    ctrl.paused = true;
    ctrl.run.status = reason === 'user_takeover' ? 'paused' : 'awaiting_hitl';
    this.persistRun(ctrl.run);
    this.emit({ type: 'run_updated', run: { ...ctrl.run } });
    if (ctrl.run.tabId) {
      this.emit({
        type: 'hitl_paused',
        pause: {
          runId,
          tabId: ctrl.run.tabId,
          reason,
          explanation,
          requestedAction: 'Manual review or authentication required',
          pausedAt: Date.now()
        }
      });
    }
    return true;
  }

  public resumeRun(runId: string): boolean {
    const ctrl = this.activeRuns.get(runId);
    if (!ctrl) return false;
    ctrl.paused = false;
    if (ctrl.run.mode === 'takeover') {
      ctrl.run.mode = 'agent';
    }
    ctrl.run.status = 'running';
    this.persistRun(ctrl.run);
    this.emit({ type: 'run_updated', run: { ...ctrl.run } });
    this.emit({ type: 'hitl_resumed', runId });
    while (ctrl.pauseWaiters.length > 0) {
      ctrl.pauseWaiters.shift()?.();
    }
    return true;
  }

  public stopRun(runId: string, reason = 'Stopped by user'): boolean {
    const ctrl = this.activeRuns.get(runId);
    if (!ctrl) return false;
    ctrl.abortController.abort(new Error(reason));
    for (const child of ctrl.childControls) {
      child.abortController.abort(new Error(reason));
    }
    ctrl.paused = false;
    while (ctrl.pauseWaiters.length > 0) {
      ctrl.pauseWaiters.shift()?.();
    }
    ctrl.run.status = 'cancelled';
    ctrl.run.failureReason = reason;
    ctrl.run.endedAt = Date.now();
    this.persistRun(ctrl.run);
    this.emit({ type: 'run_updated', run: { ...ctrl.run } });
    if (ctrl.run.tabId) this.tabManager.setAgentActive(ctrl.run.tabId, false);
    this.activeRuns.delete(runId);
    return true;
  }

  public stopAllRuns(reason = 'Emergency kill switch activated'): void {
    for (const runId of Array.from(this.activeRuns.keys())) {
      this.stopRun(runId, reason);
    }
  }

  private async waitIfPaused(ctrl: ActiveRunControl): Promise<void> {
    if (!ctrl.paused) return;
    await new Promise<void>((resolve) => {
      ctrl.pauseWaiters.push(resolve);
    });
  }

  private persistRun(run: AgentRun): void {
    if (!run.isPrivate) {
      this.agentRepo.saveRun(run);
    }
  }

  private persistStep(run: AgentRun, step: AgentStep): void {
    if (!run.isPrivate) {
      this.agentRepo.saveStep(step);
    }
  }

  private saveScreenshotFile(run: AgentRun, stepId: string, base64: string, url: string, w: number, h: number): { id: string; path: string } | null {
    const retain = this.platformRepo.getSetting<boolean>('agent.retainScreenshots', true);
    if (run.isPrivate || !retain) return null;
    try {
      const dir = path.join(this.screenshotsDir, run.id);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${stepId}.png`);
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      const id = this.agentRepo.saveScreenshot(run.id, stepId, filePath, url, w, h);
      return { id, path: filePath };
    } catch {
      return null;
    }
  }

  public async startRun(params: {
    conversationId: string;
    tabId?: string | null;
    goal: string;
    mode: AgentMode;
    selectedText?: string;
    selectedTabIds?: string[];
    parentRunId?: string | null;
    allowedDomainsOverride?: string[];
    budgetsOverride?: Partial<BudgetConfig>;
  }): Promise<AgentRun> {
    if (this.killSwitch.isTriggered()) {
      this.killSwitch.reset();
    }

    const parsedCmd = parseSlashCommand(params.goal);
    if (parsedCmd.command === '/help') {
      return this.createInstantSystemRun(
        params.conversationId,
        params.tabId ?? null,
        params.goal,
        params.mode,
        [
          'Available Atlas slash commands:',
          '- `/summarize [focus]` — Summarize the current page',
          '- `/extract [schema or fields]` — Extract structured data from the page',
          '- `/compare [criteria]` — Compare open tabs side-by-side',
          '- `/research <topic>` — Run parallel multi-agent research across sources',
          '- `/skill <name>` — Reference or run a saved skill',
          '- `/pause`, `/resume`, `/stop` — Control the active agent run',
          '- `/help` — Show this command reference'
        ].join('\n')
      );
    }

    if (parsedCmd.command === '/stop') {
      const active = this.getActiveRuns()[0];
      if (active) this.stopRun(active.id, 'Stopped via /stop command');
      return this.createInstantSystemRun(
        params.conversationId,
        params.tabId ?? null,
        params.goal,
        params.mode,
        active ? `Stopped run "${active.goal}".` : 'No active agent run to stop.'
      );
    }

    if (parsedCmd.command === '/pause') {
      const active = this.getActiveRuns()[0];
      if (active) this.pauseRun(active.id, 'user_takeover', 'Paused via /pause command');
      return this.createInstantSystemRun(
        params.conversationId,
        params.tabId ?? null,
        params.goal,
        params.mode,
        active ? `Paused run "${active.goal}".` : 'No active agent run to pause.'
      );
    }

    if (parsedCmd.command === '/resume') {
      const active = this.getActiveRuns()[0];
      if (active) this.resumeRun(active.id);
      return this.createInstantSystemRun(
        params.conversationId,
        params.tabId ?? null,
        params.goal,
        params.mode,
        active ? `Resumed run "${active.goal}".` : 'No paused agent run to resume.'
      );
    }

    const activeTab = params.tabId ? this.tabManager.getTab(params.tabId) : undefined;
    const isPrivate = Boolean(activeTab?.info.isPrivate);
    const provider = this.getProvider();
    const model = this.platformRepo.getSetting<string>('agent.defaultModel', 'gemini-2.5-flash');
    const runId = randomUUID();

    if (!isPrivate) {
      this.agentRepo.addMessage({
        conversationId: params.conversationId,
        role: 'user',
        content: params.goal,
        runId
      });
    }

    const run: AgentRun = {
      id: runId,
      conversationId: params.conversationId,
      parentRunId: params.parentRunId ?? null,
      tabId: params.tabId ?? null,
      goal: parsedCmd.expandedGoal,
      mode: params.mode,
      status: 'planning',
      subgoals: [],
      steps: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      isCostEstimated: false,
      model,
      provider: provider.id,
      isPrivate,
      startedAt: Date.now()
    };

    const ctrl: ActiveRunControl = {
      run,
      abortController: new AbortController(),
      paused: false,
      pauseWaiters: [],
      childControls: new Set(),
      subgoalReplanRequested: false
    };

    this.activeRuns.set(runId, ctrl);
    this.costTracker.startRun(runId);
    this.persistRun(run);
    this.emit({ type: 'run_updated', run: { ...run } });

    if (run.tabId) this.tabManager.setAgentActive(run.tabId, true);

    this.auditLogger.log({
      runId,
      category: 'agent_lifecycle',
      action: 'run_started',
      actor: 'orchestrator',
      details: { goal: run.goal, mode: run.mode, model: run.model, isPrivate }
    });

    // Execute loop asynchronously while returning the created Run handle immediately
    void this.executeRunLoop(ctrl, {
      selectedText: params.selectedText,
      selectedTabIds: params.selectedTabIds,
      isExplicitResearch: parsedCmd.command === '/research',
      allowedDomainsOverride: params.allowedDomainsOverride,
      budgets: { ...this.getBudgets(), ...params.budgetsOverride }
    });

    return { ...run };
  }

  public async resumeFromCheckpoint(runId: string): Promise<AgentRun | null> {
    const checkpoint = this.agentRepo.getCheckpoint(runId);
    const oldRun = this.agentRepo.getRun(runId);
    if (!checkpoint || !oldRun) return null;

    const targetTabId =
      (checkpoint.activeTabId && this.tabManager.getTab(checkpoint.activeTabId)?.info.id) ||
      this.tabManager.getAllTabs().find((t) => !t.isPrivate)?.id ||
      null;

    const remainingGoal = checkpoint.subgoals
      .filter((s) => s.status !== 'completed')
      .map((s) => s.description)
      .join('; ');

    const resumedGoal = remainingGoal
      ? `Resume interrupted task "${checkpoint.goal}". Completed evidence so far: ${checkpoint.evidenceCollected.slice(-4).join(' | ') || 'none'}. Remaining steps: ${remainingGoal}`
      : checkpoint.goal;

    this.agentRepo.deleteCheckpoint(runId);
    return this.startRun({
      conversationId: checkpoint.conversationId,
      tabId: targetTabId,
      goal: resumedGoal,
      mode: checkpoint.mode === 'takeover' ? 'assist' : checkpoint.mode
    });
  }

  private createInstantSystemRun(
    conversationId: string,
    tabId: string | null,
    goal: string,
    mode: AgentMode,
    answer: string
  ): AgentRun {
    const run: AgentRun = {
      id: randomUUID(),
      conversationId,
      tabId,
      goal,
      mode,
      status: 'completed',
      subgoals: [],
      steps: [],
      finalAnswer: answer,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      isCostEstimated: false,
      model: 'system',
      provider: 'atlas',
      isPrivate: false,
      startedAt: Date.now(),
      endedAt: Date.now()
    };
    this.agentRepo.addMessage({ conversationId, role: 'user', content: goal, runId: run.id });
    this.agentRepo.addMessage({ conversationId, role: 'assistant', content: answer, runId: run.id });
    this.agentRepo.saveRun(run);
    this.emit({ type: 'run_updated', run });
    return run;
  }

  private async executeRunLoop(
    ctrl: ActiveRunControl,
    opts: {
      selectedText?: string;
      selectedTabIds?: string[];
      isExplicitResearch?: boolean;
      allowedDomainsOverride?: string[];
      budgets: BudgetConfig;
    }
  ): Promise<void> {
    const { run, abortController } = ctrl;
    const recovery = new RecoveryMonitor();
    const experimentalScripting = this.platformRepo.getSetting<boolean>(
      'security.experimentalScriptingEnabled',
      false
    );

    let currentTabId = run.tabId;
    let lastPerception: PagePerception | null = null;

    const recordStep = (partial: Omit<AgentStep, 'id' | 'runId' | 'stepIndex' | 'createdAt'>): AgentStep => {
      const step: AgentStep = {
        ...partial,
        id: randomUUID(),
        runId: run.id,
        stepIndex: run.steps.length + 1,
        createdAt: Date.now()
      };
      run.steps.push(step);
      this.persistStep(run, step);
      this.emit({ type: 'step_added', runId: run.id, step });
      return step;
    };

    try {
      // 1. Initial perception
      if (currentTabId) {
        const wc = this.tabManager.getWebContents(currentTabId);
        if (wc) {
          try {
            lastPerception = await this.perception.capture(currentTabId, wc);
            if (opts.selectedText && !lastPerception.selectedText) {
              lastPerception.selectedText = opts.selectedText;
            }
          } catch {
            // Blank or unready page
          }
        }
      }

      if (lastPerception && lastPerception.injectionWarnings.length > 0) {
        this.auditLogger.log({
          runId: run.id,
          category: 'injection_warning',
          action: 'prompt_injection_detected',
          actor: 'injection_guard',
          details: { warnings: lastPerception.injectionWarnings }
        });
      }

      // 2. Plan subgoals (strictly exclude private tabs unless explicitly in private window)
      const allowedTabs = this.tabManager.getAllTabs().filter((t) => {
        if (!run.isPrivate && t.isPrivate) return false;
        if (opts.selectedTabIds && opts.selectedTabIds.length > 0) {
          return opts.selectedTabIds.includes(t.id);
        }
        return true;
      });
      const tabsSummary = allowedTabs
        .map((t) => `- [${t.id}] ${t.title} (${t.url})`)
        .join('\n');

      if (lastPerception) {
        recordStep({
          phase: 'observe',
          summary: `Observed ${lastPerception.title || lastPerception.url}`,
          decisionExplanation: `Captured DOM (${lastPerception.interactiveElements.length} elements) and page context.`,
          injectionWarnings: lastPerception.injectionWarnings
        });
      }

      const plan = await this.planner.plan({
        runId: run.id,
        goal: run.goal,
        mode: run.mode,
        model: run.model,
        perception: lastPerception,
        openTabsSummary: tabsSummary,
        isPrivate: run.isPrivate,
        signal: abortController.signal
      });

      run.planSummary = plan.planSummary;
      run.subgoals = plan.subgoals;
      run.status = 'running';
      this.syncCostIntoRun(run);
      this.persistRun(run);
      this.emit({ type: 'run_updated', run: { ...run } });

      recordStep({
        phase: 'plan',
        summary: plan.planSummary,
        decisionExplanation: `Decomposed goal into ${plan.subgoals.length} verifiable subgoal(s) (complexity: ${plan.complexity}).`,
        injectionWarnings: lastPerception?.injectionWarnings ?? []
      });

      // 3. Multi-agent parallel execution if complex/research with parallel subtasks
      if (
        run.mode === 'agent' &&
        !run.parentRunId &&
        (opts.isExplicitResearch || (plan.complexity === 'complex' && plan.parallelSubtasks.length >= 2))
      ) {
        const subtasks = plan.parallelSubtasks.slice(0, opts.budgets.maxParallelAgents);
        if (subtasks.length >= 2) {
          const merged = await this.runParallelSubAgents(ctrl, subtasks, opts.budgets);
          run.finalAnswer = merged;
          run.status = 'completed';
          run.endedAt = Date.now();
          for (const sg of run.subgoals) sg.status = 'completed';
          this.syncCostIntoRun(run);
          this.persistRun(run);
          if (!run.isPrivate) {
            this.agentRepo.addMessage({
              conversationId: run.conversationId,
              role: 'assistant',
              content: merged,
              runId: run.id
            });
          }
          this.emit({ type: 'run_updated', run: { ...run } });
          return;
        }
      }

      // 4. Main Planner -> Executor -> Verifier loop
      const toolCtx: ToolExecutionContext = {
        runId: run.id,
        tabId: currentTabId || '',
        mode: run.mode,
        isPrivate: run.isPrivate,
        allowedDomainsOverride: opts.allowedDomainsOverride,
        experimentalScriptingEnabled: experimentalScripting,
        tabManager: this.tabManager,
        browserRepo: this.browserRepo,
        cdp: this.cdp,
        resolver: this.resolver,
        perception: this.perception,
        lastPerception,
        updateLastPerception: (p) => {
          lastPerception = p;
        },
        setActiveTabId: (id) => {
          currentTabId = id;
          toolCtx.tabId = id;
        }
      };

      const provider = this.getProvider();
      const memories = run.isPrivate
        ? []
        : this.memoryService.retrieveRelevant(
            run.goal,
            lastPerception?.url ? new URL(lastPerception.url).hostname : null,
            5
          );

      let activeSubgoalIdx = 0;
      const messages: ModelMessage[] = [];

      while (!abortController.signal.aborted) {
        await this.waitIfPaused(ctrl);
        if (abortController.signal.aborted) break;

        // Check budgets & kill switch
        if (this.killSwitch.isTriggered()) {
          throw new Error(this.killSwitch.getLastReason() || 'Emergency stop activated');
        }
        const budgetCheck = this.costTracker.checkBudget(run.id, opts.budgets);
        if (budgetCheck.warning) {
          this.emit({
            type: 'budget_warning',
            runId: run.id,
            message: 'Agent run is approaching configured token/step/cost budget.'
          });
        }
        if (budgetCheck.exceeded) {
          run.status = 'budget_exceeded';
          run.failureReason = budgetCheck.reason || 'Budget limit exceeded';
          run.endedAt = Date.now();
          this.syncCostIntoRun(run);
          this.persistRun(run);
          this.emit({ type: 'run_updated', run: { ...run } });
          return;
        }

        // Re-observe page if HITL signals indicate CAPTCHA, login, or payment gate in interact/agent mode
        if (
          lastPerception &&
          run.mode !== 'ask' &&
          lastPerception.hitlSignals.some((s) => s === 'captcha' || s === 'payment_page')
        ) {
          const hitlReason = lastPerception.hitlSignals.includes('captcha') ? 'captcha' : 'payment_page';
          this.pauseRun(
            run.id,
            hitlReason,
            hitlReason === 'captcha'
              ? 'CAPTCHA / anti-bot verification detected. Please complete it manually before resuming.'
              : 'Payment or checkout form detected. Please review and take over manually.'
          );
          recordStep({
            phase: 'hitl',
            subgoalId: run.subgoals[activeSubgoalIdx]?.id,
            summary: `Paused for human intervention (${hitlReason})`,
            decisionExplanation: 'Atlas never bypasses CAPTCHAs or submits payments without human takeover.',
            injectionWarnings: []
          });
          await this.waitIfPaused(ctrl);
          // Re-observe after human takeover!
          if (currentTabId) {
            const wc = this.tabManager.getWebContents(currentTabId);
            if (wc) {
              lastPerception = await this.perception.capture(currentTabId, wc);
              toolCtx.lastPerception = lastPerception;
            }
          }
        }

        const compacted = this.contextManager.buildContext({
          goal: run.goal,
          subgoals: run.subgoals,
          steps: run.steps,
          memories,
          perception: lastPerception
        });

        const stepPrompt = [
          compacted.goalBlock,
          compacted.safetyBlock,
          compacted.memoryBlock,
          compacted.progressSummary,
          compacted.recentStepsBlock ? `RECENT EXECUTION STEPS:\n${compacted.recentStepsBlock}` : '',
          `CURRENT PAGE PERCEPTION:\n${compacted.currentPageBlock}`,
          'Select the single best next tool call to advance the current subgoal, OR provide the final verified answer if all subgoals are satisfied.'
        ]
          .filter(Boolean)
          .join('\n\n');

        const callMessages: ModelMessage[] = [
          ...messages.slice(-6),
          { role: 'user', parts: [{ text: stepPrompt }] }
        ];

        const allowedTools =
          run.mode === 'ask'
            ? this.toolRegistry
                .listDeclarations()
                .filter((t) => this.toolRegistry.get(t.name)?.baseTier === 'read_only')
            : this.toolRegistry.listDeclarations();

        const useVision =
          Boolean(lastPerception?.screenshotBase64) &&
          (this.costTracker.getState(run.id)?.visionCalls ?? 0) < opts.budgets.maxVisionCallsPerRun;

        if (useVision && lastPerception?.screenshotBase64) {
          callMessages[callMessages.length - 1].parts.push({
            inlineData: { mimeType: 'image/png', data: lastPerception.screenshotBase64 }
          });
        }

        const resp = await provider.generate({
          model: run.model,
          systemInstruction:
            'You are Atlas Browser Agent. Operate real browser tabs via tools one step at a time. Never invent page data. Explain actions concisely without exposing private chain-of-thought.',
          messages: callMessages,
          tools: allowedTools,
          temperature: 0.15,
          signal: abortController.signal,
          onTextDelta: (delta) => {
            this.emit({ type: 'stream_delta', runId: run.id, delta });
          }
        });

        const budgetState = this.costTracker.recordModelUsage({
          runId: run.id,
          provider: provider.id,
          model: run.model,
          inputTokens: resp.usage.inputTokens,
          outputTokens: resp.usage.outputTokens,
          fromProvider: resp.usage.fromProvider,
          usedVision: useVision,
          skipPersistence: run.isPrivate
        });
        budgetState.steps += 1;
        this.syncCostIntoRun(run);

        // No tool calls -> model produced final answer
        if (resp.functionCalls.length === 0) {
          const finalAnswer = resp.text.trim() || 'Task completed.';
          run.finalAnswer = finalAnswer;
          run.status = 'completed';
          run.endedAt = Date.now();
          for (const sg of run.subgoals) {
            if (sg.status === 'pending' || sg.status === 'in_progress') sg.status = 'completed';
          }
          recordStep({
            phase: 'complete',
            summary: 'Goal completed',
            decisionExplanation: finalAnswer.slice(0, 300),
            evidence: 'Final synthesized answer delivered',
            verificationOutcome: 'passed',
            injectionWarnings: []
          });
          this.persistRun(run);
          if (!run.isPrivate) {
            this.agentRepo.deleteCheckpoint(run.id);
            this.agentRepo.addMessage({
              conversationId: run.conversationId,
              role: 'assistant',
              content: finalAnswer,
              runId: run.id
            });
            const suggestion = this.buildSkillSuggestion(run);
            if (suggestion) {
              this.emit({ type: 'skill_suggestion', suggestion });
            }
          }
          this.emit({ type: 'run_updated', run: { ...run } });
          return;
        }

        // Execute one tool call at a time (Executor)
        const fnCall = resp.functionCalls[0];
        const currentSubgoal = run.subgoals[activeSubgoalIdx] ?? run.subgoals[0];
        if (currentSubgoal) currentSubgoal.attempts += 1;

        const stepId = randomUUID();
        const screenshotHolder: { meta: { id: string; path: string } | null } = { meta: null };
        toolCtx.onScreenshotCaptured = (b64, url, w, h) => {
          screenshotHolder.meta = this.saveScreenshotFile(run, stepId, b64, url, w, h);
        };

        const execResult = await this.toolRegistry.invoke(fnCall.name, fnCall.args, toolCtx);
        toolCtx.onScreenshotCaptured = undefined;

        const verification = this.verifier.verifyToolStep({
          subgoal: currentSubgoal,
          toolName: fnCall.name,
          toolSuccess: execResult.outcome.success,
          toolError: execResult.outcome.error,
          toolData: execResult.outcome.data,
          pageDiff: execResult.outcome.pageDiff,
          afterPerception: lastPerception,
          maxRetries: opts.budgets.maxRetriesPerStep
        });

        if (execResult.outcome.success) {
          budgetState.consecutiveFailures = 0;
        } else {
          budgetState.consecutiveFailures += 1;
        }

        recovery.record({
          toolName: fnCall.name,
          argsKey: JSON.stringify(fnCall.args),
          url: lastPerception?.url || '',
          success: execResult.outcome.success
        });

        const loopCheck = recovery.analyze();

        const stepObj: AgentStep = {
          id: stepId,
          runId: run.id,
          stepIndex: run.steps.length + 1,
          subgoalId: currentSubgoal?.id ?? null,
          phase: loopCheck.stuck ? 'recover' : 'execute',
          summary: `${fnCall.name}(${JSON.stringify(fnCall.args).slice(0, 80)})`,
          decisionExplanation: resp.text?.trim() || `Executing ${fnCall.name} for subgoal: ${currentSubgoal?.description ?? run.goal}`,
          evidence: verification.evidence,
          verificationOutcome: verification.outcome,
          screenshotId: screenshotHolder.meta?.id ?? null,
          screenshotPath: screenshotHolder.meta?.path ?? null,
          injectionWarnings: lastPerception?.injectionWarnings ?? [],
          toolExecution: {
            id: randomUUID(),
            runId: run.id,
            stepId,
            toolName: fnCall.name,
            permissionTier: execResult.permissionTier,
            args: fnCall.args,
            validated: execResult.validated,
            permissionDecision: execResult.permissionDecision,
            success: execResult.outcome.success,
            result: execResult.outcome.data,
            error: execResult.outcome.error ?? null,
            durationMs: execResult.durationMs,
            pageDiff: execResult.outcome.pageDiff ?? null,
            createdAt: Date.now()
          },
          createdAt: Date.now()
        };

        run.steps.push(stepObj);
        this.persistStep(run, stepObj);
        this.emit({ type: 'step_added', runId: run.id, step: stepObj });

        messages.push({
          role: 'model',
          parts: [{ functionCall: { name: fnCall.name, args: fnCall.args } }]
        });
        messages.push({
          role: 'tool',
          parts: [
            {
              functionResponse: {
                name: fnCall.name,
                response: {
                  success: execResult.outcome.success,
                  data: execResult.outcome.data ?? null,
                  error: execResult.outcome.error ?? null,
                  verification: verification.outcome,
                  evidence: verification.evidence
                }
              }
            }
          ]
        });

        if (verification.outcome === 'failed') {
          throw new Error(verification.evidence || 'Action rejected or blocked');
        }

        if (loopCheck.stuck) {
          if (loopCheck.recommendedAction === 'abort') {
            throw new Error(loopCheck.reason || 'Agent stuck in unrecoverable failure loop');
          }
          if (loopCheck.recommendedAction === 'backtrack' && currentTabId) {
            this.tabManager.goBack(currentTabId);
          }
          // Capture fresh screenshot/AX perception to break selector loop
          if (currentTabId) {
            const wc = this.tabManager.getWebContents(currentTabId);
            if (wc) {
              lastPerception = await this.perception.capture(currentTabId, wc, { includeScreenshot: true });
              toolCtx.lastPerception = lastPerception;
            }
          }
          messages.push({
            role: 'user',
            parts: [
              {
                text: `RECOVERY ALERT: ${loopCheck.reason}. Switch strategy (use accessibility name, text targeting, or re-plan).`
              }
            ]
          });
        } else if (verification.outcome === 'passed' && currentSubgoal) {
          currentSubgoal.status = 'completed';
          if (activeSubgoalIdx + 1 < run.subgoals.length) {
            activeSubgoalIdx += 1;
            run.subgoals[activeSubgoalIdx].status = 'in_progress';
          }
        }

        this.persistRun(run);
        if (!run.isPrivate) {
          this.agentRepo.saveCheckpoint({
            runId: run.id,
            conversationId: run.conversationId,
            goal: run.goal,
            mode: run.mode,
            subgoals: run.subgoals,
            currentSubgoalIdx: activeSubgoalIdx,
            activeTabId: currentTabId ?? null,
            activeUrl: lastPerception?.url ?? null,
            evidenceCollected: run.steps.map((s) => s.evidence).filter((e): e is string => Boolean(e)),
            stepCount: run.steps.length,
            updatedAt: Date.now()
          });
        }
        this.emit({ type: 'run_updated', run: { ...run } });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (run.status !== 'cancelled' && run.status !== 'budget_exceeded') {
        run.status = abortController.signal.aborted ? 'cancelled' : 'failed';
        run.failureReason = msg;
        run.endedAt = Date.now();
        this.syncCostIntoRun(run);
        this.persistRun(run);
        if (!run.isPrivate) {
          this.agentRepo.addMessage({
            conversationId: run.conversationId,
            role: 'assistant',
            content: `Run stopped (${run.status}): ${msg}`,
            runId: run.id
          });
        }
        this.emit({ type: 'run_updated', run: { ...run } });
      }
    } finally {
      if (run.tabId) this.tabManager.setAgentActive(run.tabId, false);
      this.activeRuns.delete(run.id);
      this.costTracker.clearRun(run.id);
    }
  }

  private async runParallelSubAgents(
    parentCtrl: ActiveRunControl,
    subtasks: string[],
    budgets: BudgetConfig
  ): Promise<string> {
    const parentRun = parentCtrl.run;
    const windowId =
      (parentRun.tabId ? this.tabManager.getTab(parentRun.tabId)?.info.windowId : null) ??
      this.tabManager.getDefaultWindowId();

    const childPromises = subtasks.map(async (subtask) => {
      const subAgentId = randomUUID();
      const childTab =
        windowId !== null
          ? this.tabManager.createTab(windowId, { url: 'about:blank', activate: false })
          : null;

      const progress: SubAgentProgress = {
        subAgentId,
        parentRunId: parentRun.id,
        tabId: childTab?.id ?? null,
        task: subtask,
        status: 'running',
        stepsTaken: 0,
        sources: []
      };
      this.emit({ type: 'subagent_updated', progress });

      try {
        const childRun = await this.startRun({
          conversationId: parentRun.conversationId,
          tabId: childTab?.id ?? parentRun.tabId,
          goal: subtask,
          mode: parentRun.mode,
          parentRunId: parentRun.id,
          budgetsOverride: {
            ...budgets,
            maxStepsPerRun: Math.max(6, Math.floor(budgets.maxStepsPerRun / subtasks.length)),
            maxCostPerRunUsd: Number((budgets.maxCostPerRunUsd / subtasks.length).toFixed(4))
          }
        });

        // Wait for child run completion or parent abort
        const finished = await this.waitForRunCompletion(childRun.id, parentCtrl.abortController.signal);
        const sources = finished.steps
          .map((s) => s.toolExecution?.pageDiff?.currentUrl)
          .filter((u): u is string => Boolean(u && u !== 'about:blank'));

        progress.status = finished.status === 'completed' ? 'completed' : 'failed';
        progress.stepsTaken = finished.steps.length;
        progress.resultSummary = finished.finalAnswer || finished.failureReason || '';
        progress.sources = Array.from(new Set(sources));
        this.emit({ type: 'subagent_updated', progress });

        if (childTab) {
          this.tabManager.closeTab(childTab.id);
        }
        return progress;
      } catch (err) {
        progress.status = 'failed';
        progress.error = err instanceof Error ? err.message : String(err);
        this.emit({ type: 'subagent_updated', progress });
        if (childTab) this.tabManager.closeTab(childTab.id);
        return progress;
      }
    });

    const results = await Promise.all(childPromises);
    const provider = this.getProvider();
    const synthesisPrompt = [
      `Main Goal: ${parentRun.goal}`,
      'Sub-agent Findings:',
      ...results.map(
        (r, i) =>
          `Sub-agent ${i + 1} (${r.task}) [${r.status}]:\nSources: ${r.sources.join(', ') || 'none'}\nSummary: ${r.resultSummary || r.error || 'No output'}`
      ),
      'Merge these findings, resolve any conflicts explicitly, and produce a clear final response with source URLs.'
    ].join('\n\n');

    const synth = await provider.generate({
      model: parentRun.model,
      systemInstruction: 'Synthesize parallel sub-agent research results accurately with source references.',
      messages: [{ role: 'user', parts: [{ text: synthesisPrompt }] }],
      signal: parentCtrl.abortController.signal
    });

    this.costTracker.recordModelUsage({
      runId: parentRun.id,
      provider: provider.id,
      model: parentRun.model,
      inputTokens: synth.usage.inputTokens,
      outputTokens: synth.usage.outputTokens,
      fromProvider: synth.usage.fromProvider
    });

    return synth.text;
  }

  private async waitForRunCompletion(runId: string, signal: AbortSignal): Promise<AgentRun> {
    return new Promise<AgentRun>((resolve) => {
      const check = () => {
        const ctrl = this.activeRuns.get(runId);
        if (!ctrl) {
          const persisted = this.agentRepo.getRun(runId);
          resolve(
            persisted ?? {
              id: runId,
              conversationId: '',
              goal: '',
              mode: 'agent',
              status: 'completed',
              subgoals: [],
              steps: [],
              totalInputTokens: 0,
              totalOutputTokens: 0,
              estimatedCostUsd: 0,
              isCostEstimated: false,
              model: '',
              provider: '',
              isPrivate: false,
              startedAt: Date.now()
            }
          );
          return true;
        }
        return false;
      };

      if (check()) return;
      const onAbort = () => {
        this.stopRun(runId, 'Parent run cancelled');
        check();
      };
      signal.addEventListener('abort', onAbort, { once: true });

      const unsub = this.onEvent((ev) => {
        if (ev.type === 'run_updated' && ev.run.id === runId) {
          if (['completed', 'failed', 'cancelled', 'budget_exceeded'].includes(ev.run.status)) {
            unsub();
            signal.removeEventListener('abort', onAbort);
            resolve(ev.run);
          }
        }
      });
    });
  }

  private buildSkillSuggestion(run: AgentRun): SkillSuggestion | null {
    const toolSteps = run.steps.filter((s) => s.toolExecution && s.toolExecution.success);
    if (toolSteps.length < 2) return null;
    const domains = Array.from(
      new Set(
        toolSteps
          .map((s) => extractDomain(s.toolExecution?.pageDiff?.currentUrl || ''))
          .filter((d) => d && d !== 'internal' && d !== 'unknown')
      )
    );
    const perms = Array.from(
      new Set(toolSteps.map((s) => s.toolExecution!.permissionTier))
    ) as PermissionTier[];
    return {
      runId: run.id,
      suggestedName: run.goal.slice(0, 48),
      description: run.planSummary || run.goal,
      stepsCount: toolSteps.length,
      domains,
      requiredPermissions: perms
    };
  }

  private syncCostIntoRun(run: AgentRun): void {
    const state = this.costTracker.getState(run.id);
    if (!state) return;
    run.totalInputTokens = state.inputTokens;
    run.totalOutputTokens = state.outputTokens;
    run.estimatedCostUsd = state.costUsd;
    run.isCostEstimated = state.isEstimated;
  }
}

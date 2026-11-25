import { describe, expect, it, beforeEach } from 'vitest';
import { AtlasDatabase } from '@main/db/database';
import { AgentRepository } from '@main/db/repositories/agent-repo';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { AuditLogger } from '@main/security/audit-logger';
import { InjectionGuard } from '@main/security/injection-guard';
import { KillSwitch } from '@main/security/kill-switch';
import { PermissionGate } from '@main/security/permission-gate';
import { ToolRegistry, type ToolExecutionContext } from '@main/agent/tool-registry';
import { registerAllBrowserTools } from '@main/agent/tools/browser-tools';
import { MockModelProvider } from '@main/agent/providers/mock-provider';
import { CostTracker } from '@main/agent/cost-tracker';
import { AgentPlanner } from '@main/agent/planner';
import { ActionVerifier } from '@main/agent/verifier';
import { RecoveryMonitor } from '@main/agent/recovery';
import { ContextManager } from '@main/agent/context-manager';
import { StructuredExtractionEngine } from '@main/agent/extraction-engine';
import { DEFAULT_BUDGETS } from '@main/agent/orchestrator';

describe('Agent Core Components', () => {
  let db: AtlasDatabase;
  let agentRepo: AgentRepository;
  let platformRepo: PlatformRepository;
  let audit: AuditLogger;
  let killSwitch: KillSwitch;
  let gate: PermissionGate;
  let registry: ToolRegistry;

  beforeEach(() => {
    db = new AtlasDatabase(':memory:');
    agentRepo = new AgentRepository(db.db);
    platformRepo = new PlatformRepository(db.db);
    audit = new AuditLogger(platformRepo);
    killSwitch = new KillSwitch();
    gate = new PermissionGate(platformRepo, audit, killSwitch);
    registry = new ToolRegistry(gate, audit);
    registerAllBrowserTools(registry);
  });

  it('validates tool arguments and rejects unknown tools, unsafe URLs, and sensitive paths', async () => {
    expect(registry.listToolNames()).toContain('navigate');
    expect(registry.listToolNames()).toContain('inspect_accessibility');
    expect(registry.listToolNames()).toContain('compare_tabs');

    expect(registry.validateArgs('unknown_tool', {}).valid).toBe(false);
    expect(registry.validateArgs('navigate', { url: 'javascript:alert(1)' }).valid).toBe(false);
    expect(registry.validateArgs('upload_file', { selector: '#f', filePath: '~/.ssh/id_rsa' }).valid).toBe(false);
    expect(registry.validateArgs('click', { text: 'Continue', unknownField: 123 }).valid).toBe(false);

    const mockCtx = {
      runId: 'run-1',
      tabId: 'tab-1',
      mode: 'agent',
      isPrivate: false,
      experimentalScriptingEnabled: false,
      tabManager: { getTab: () => undefined }
    } as unknown as ToolExecutionContext;

    const unknownRes = await registry.invoke('non_existent', {}, mockCtx);
    expect(unknownRes.validated).toBe(false);
    expect(unknownRes.outcome.success).toBe(false);
  });

  it('plans structured subgoals and tracks costs & budgets', async () => {
    const costTracker = new CostTracker(agentRepo);
    const provider = new MockModelProvider();
    provider.enqueue([
      {
        text: JSON.stringify({
          planSummary: 'Open docs and summarize auth',
          complexity: 'moderate',
          parallelSubtasks: [],
          subgoals: [
            { description: 'Navigate to docs', expectedEvidence: 'Docs URL loaded' },
            { description: 'Summarize auth section', expectedEvidence: 'Auth summary generated' }
          ]
        }),
        functionCalls: [],
        usage: { inputTokens: 200, outputTokens: 80, fromProvider: true }
      }
    ]);

    const planner = new AgentPlanner(() => provider, costTracker);
    const conv = agentRepo.createConversation('Test');
    agentRepo.saveRun({
      id: 'run-plan',
      conversationId: conv.id,
      goal: 'Summarize auth',
      mode: 'agent',
      status: 'planning',
      subgoals: [],
      steps: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      isCostEstimated: false,
      model: 'gemini-2.5-flash',
      provider: 'mock',
      isPrivate: false,
      startedAt: Date.now()
    });
    costTracker.startRun('run-plan');

    const plan = await planner.plan({
      runId: 'run-plan',
      goal: 'Summarize auth',
      mode: 'agent',
      model: 'gemini-2.5-flash',
      perception: null,
      openTabsSummary: ''
    });

    expect(plan.subgoals).toHaveLength(2);
    expect(plan.subgoals[0].status).toBe('in_progress');
    expect(costTracker.getState('run-plan')?.inputTokens).toBe(200);

    // Budget enforcement test
    const state = costTracker.getState('run-plan')!;
    state.steps = DEFAULT_BUDGETS.maxStepsPerRun;
    const budget = costTracker.checkBudget('run-plan', DEFAULT_BUDGETS);
    expect(budget.exceeded).toBe(true);
  });

  it('verifies actions with evidence and detects stuck loops in RecoveryMonitor', () => {
    const verifier = new ActionVerifier();
    const sg = { id: 's1', index: 0, description: 'Nav', expectedEvidence: 'URL', status: 'in_progress' as const, attempts: 1 };

    const navFail = verifier.verifyToolStep({
      subgoal: sg,
      toolName: 'navigate',
      toolSuccess: true,
      afterPerception: { url: 'about:blank', title: 'about:blank' } as any,
      maxRetries: 2
    });
    expect(navFail.outcome).toBe('retry');

    const navPass = verifier.verifyToolStep({
      subgoal: sg,
      toolName: 'navigate',
      toolSuccess: true,
      afterPerception: { url: 'https://spring.io/security', title: 'Spring Security' } as any,
      maxRetries: 2
    });
    expect(navPass.outcome).toBe('passed');

    const recovery = new RecoveryMonitor();
    recovery.record({ toolName: 'click', argsKey: '{"selector":"#x"}', url: 'https://a.com', success: false });
    recovery.record({ toolName: 'click', argsKey: '{"selector":"#x"}', url: 'https://a.com', success: false });
    recovery.record({ toolName: 'click', argsKey: '{"selector":"#x"}', url: 'https://a.com', success: false });
    const loop = recovery.analyze();
    expect(loop.stuck).toBe(true);
    expect(loop.recommendedAction).toBe('retry_alternate_strategy');

    recovery.reset();
    recovery.record({ toolName: 'navigate', argsKey: 'b', url: 'https://a.com', success: true });
    recovery.record({ toolName: 'navigate', argsKey: 'a', url: 'https://b.com', success: true });
    recovery.record({ toolName: 'navigate', argsKey: 'b', url: 'https://a.com', success: true });
    recovery.record({ toolName: 'navigate', argsKey: 'a', url: 'https://b.com', success: true });
    expect(recovery.analyze().recommendedAction).toBe('backtrack');
  });

  it('compacts context while preserving safety invariants and goal', () => {
    const cm = new ContextManager(new InjectionGuard());
    const steps = Array.from({ length: 12 }, (_, i) => ({
      id: `st-${i}`,
      runId: 'r1',
      stepIndex: i + 1,
      phase: 'execute' as const,
      summary: `Step ${i + 1}`,
      decisionExplanation: 'ok',
      injectionWarnings: [],
      createdAt: Date.now()
    }));

    const ctx = cm.buildContext({
      goal: 'Find pricing tiers',
      subgoals: [{ id: '1', index: 0, description: 'Read pricing', expectedEvidence: 'Table', status: 'in_progress', attempts: 0 }],
      steps,
      memories: [],
      perception: null
    });

    expect(ctx.goalBlock).toContain('Find pricing tiers');
    expect(ctx.safetyBlock).toContain('UNTRUSTED_PAGE_CONTENT');
    expect(ctx.progressSummary).toContain('6 compacted');
  });

  it('validates structured extraction schemas, retries invalid output, and exports CSV', async () => {
    const provider = new MockModelProvider();
    provider.enqueue([
      // Attempt 1: invalid schema (price is string instead of number/null)
      {
        text: JSON.stringify({ records: [{ name: 'Widget', price: 'bad' }], evidence: [{ field: 'name', snippet: 'Widget' }] }),
        functionCalls: [],
        usage: { inputTokens: 100, outputTokens: 40, fromProvider: false }
      },
      // Attempt 2: valid schema with explicit null for missing price
      {
        text: JSON.stringify({ records: [{ name: 'Widget', price: null }], evidence: [{ field: 'name', snippet: 'Widget' }] }),
        functionCalls: [],
        usage: { inputTokens: 110, outputTokens: 40, fromProvider: false }
      }
    ]);

    const engine = new StructuredExtractionEngine(() => provider, new InjectionGuard());
    const res = await engine.extract({
      url: 'https://store.test',
      pageTitle: 'Store',
      pageText: 'Widget - Contact for price',
      tablesSummary: [],
      schema: {
        type: 'object',
        properties: { name: { type: 'string' }, price: { type: ['number', 'null'] } },
        required: ['name', 'price']
      },
      instructions: 'Extract product',
      model: 'mock-deterministic',
      maxRetries: 2
    });

    expect(res.valid).toBe(true);
    expect(res.attempts).toBe(2);
    expect(res.records[0].price).toBeNull();

    const csv = engine.toCsv([{ name: 'Widget, Pro', price: 19.99 }]);
    expect(csv).toBe('name,price\n"Widget, Pro",19.99');
  });
});

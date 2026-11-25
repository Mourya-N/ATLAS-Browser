import Ajv, { type ValidateFunction } from 'ajv';
import type {
  AgentMode,
  PageDiff,
  PagePerception,
  PermissionTier,
  TabInfo
} from '@shared/types';
import type { PermissionGate } from '@main/security/permission-gate';
import type { AuditLogger } from '@main/security/audit-logger';
import type { TabManager } from '@main/browser/tab-manager';
import type { BrowserRepository } from '@main/db/repositories/browser-repo';
import type { CDPManager } from '@main/cdp/cdp-manager';
import type { ElementResolver } from '@main/cdp/element-resolver';
import type { PerceptionEngine } from '@main/cdp/perception';
import type { ModelToolDeclaration } from './providers/model-provider';

export interface ToolExecutionContext {
  runId: string;
  tabId: string;
  mode: AgentMode;
  isPrivate: boolean;
  allowedDomainsOverride?: string[];
  experimentalScriptingEnabled: boolean;
  tabManager: TabManager;
  browserRepo: BrowserRepository;
  cdp: CDPManager;
  resolver: ElementResolver;
  perception: PerceptionEngine;
  lastPerception: PagePerception | null;
  updateLastPerception: (p: PagePerception) => void;
  setActiveTabId: (tabId: string) => void;
  onScreenshotCaptured?: (base64: string, url: string, width: number, height: number) => void;
}

export interface ToolOutcome {
  success: boolean;
  data?: unknown;
  error?: string;
  pageDiff?: PageDiff | null;
}

export interface RegisteredTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  baseTier: PermissionTier;
  resolveTier?: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<{
    tier: PermissionTier;
    targetDescription: string;
    submittedDataSummary: string;
    expectedConsequence: string;
    reversible: boolean;
  }>;
  validate?: (args: Record<string, unknown>) => string | null;
  execute: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolOutcome>;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private validators = new Map<string, ValidateFunction>();
  private ajv = new Ajv({ allErrors: true, strict: false });

  constructor(
    private readonly permissionGate: PermissionGate,
    private readonly auditLogger: AuditLogger
  ) {}

  public register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
    const validateFn = this.ajv.compile(tool.parameters);
    this.validators.set(tool.name, validateFn);
  }

  public get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  public listDeclarations(): ModelToolDeclaration[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  }

  public listToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  public validateArgs(toolName: string, args: Record<string, unknown>): { valid: boolean; error?: string } {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { valid: false, error: `Unknown tool: ${toolName}` };
    }
    const validateFn = this.validators.get(toolName);
    if (validateFn && !validateFn(args)) {
      const msg = (validateFn.errors ?? [])
        .map((e) => `${e.instancePath || 'args'} ${e.message}`)
        .join('; ');
      return { valid: false, error: `Invalid arguments for ${toolName}: ${msg}` };
    }
    if (tool.validate) {
      const customErr = tool.validate(args);
      if (customErr) {
        return { valid: false, error: customErr };
      }
    }
    return { valid: true };
  }

  public async invoke(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext
  ): Promise<{
    validated: boolean;
    permissionTier: PermissionTier;
    permissionDecision: 'allowed' | 'denied' | 'confirmed' | 'rejected';
    outcome: ToolOutcome;
    durationMs: number;
  }> {
    const start = Date.now();
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        validated: false,
        permissionTier: 'sensitive',
        permissionDecision: 'denied',
        outcome: { success: false, error: `Unknown tool "${toolName}" rejected by ToolRegistry` },
        durationMs: Date.now() - start
      };
    }

    const validation = this.validateArgs(toolName, args);
    if (!validation.valid) {
      return {
        validated: false,
        permissionTier: tool.baseTier,
        permissionDecision: 'denied',
        outcome: { success: false, error: validation.error },
        durationMs: Date.now() - start
      };
    }

    const tab: TabInfo | undefined = ctx.tabManager.getTab(ctx.tabId)?.info;
    const currentUrl = tab?.url || ctx.lastPerception?.url || 'about:blank';

    let tier = tool.baseTier;
    let targetDescription = JSON.stringify(args).slice(0, 160);
    let submittedDataSummary = 'None';
    let expectedConsequence = `Execute ${toolName}`;
    let reversible = tier !== 'sensitive';

    if (tool.resolveTier) {
      try {
        const resolved = await tool.resolveTier(args, ctx);
        tier = resolved.tier;
        targetDescription = resolved.targetDescription;
        submittedDataSummary = resolved.submittedDataSummary;
        expectedConsequence = resolved.expectedConsequence;
        reversible = resolved.reversible;
      } catch (err) {
        // Ignore resolution errors here; execute() will handle missing targets cleanly
      }
    }

    const perm = await this.permissionGate.authorize({
      runId: ctx.runId,
      toolName,
      tier,
      mode: ctx.mode,
      url: currentUrl,
      actionSummary: `${toolName} on ${currentUrl}`,
      targetDescription,
      submittedDataSummary,
      expectedConsequence,
      reversible,
      allowedDomainsOverride: ctx.allowedDomainsOverride
    });

    this.auditLogger.log({
      runId: ctx.runId,
      category: 'tool_call',
      action: perm.allowed ? `tool_authorized:${toolName}` : `tool_blocked:${toolName}`,
      actor: 'tool_registry',
      domain: (() => {
        try {
          return new URL(currentUrl).hostname;
        } catch {
          return 'internal';
        }
      })(),
      details: {
        toolName,
        tier,
        decision: perm.decision,
        args,
        reason: perm.reason
      }
    });

    if (!perm.allowed) {
      return {
        validated: true,
        permissionTier: tier,
        permissionDecision: perm.decision,
        outcome: { success: false, error: perm.reason || 'Permission denied' },
        durationMs: Date.now() - start
      };
    }

    // Timeout protection (25s max per tool call)
    const timeoutMs = 25_000;
    let timer: NodeJS.Timeout | undefined;
    try {
      const outcome = await Promise.race<ToolOutcome>([
        tool.execute(args, ctx),
        new Promise<ToolOutcome>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
      return {
        validated: true,
        permissionTier: tier,
        permissionDecision: perm.decision,
        outcome,
        durationMs: Date.now() - start
      };
    } catch (err) {
      return {
        validated: true,
        permissionTier: tier,
        permissionDecision: perm.decision,
        outcome: {
          success: false,
          error: err instanceof Error ? err.message : String(err)
        },
        durationMs: Date.now() - start
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

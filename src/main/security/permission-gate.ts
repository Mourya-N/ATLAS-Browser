import { randomUUID } from 'node:crypto';
import type {
  AgentMode,
  ConfirmationRequest,
  ConfirmationResponse,
  DomainPermissionMode,
  DomainRule,
  PermissionTier
} from '@shared/types';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import type { AuditLogger } from './audit-logger';
import type { KillSwitch } from './kill-switch';

export interface PermissionCheckInput {
  runId: string;
  toolName: string;
  tier: PermissionTier;
  mode: AgentMode;
  url: string;
  actionSummary: string;
  targetDescription: string;
  submittedDataSummary: string;
  expectedConsequence: string;
  reversible: boolean;
  allowedDomainsOverride?: string[];
}

export interface PermissionCheckResult {
  allowed: boolean;
  decision: 'allowed' | 'denied' | 'confirmed' | 'rejected';
  reason?: string;
}

export type ConfirmationPrompter = (req: ConfirmationRequest) => Promise<ConfirmationResponse>;

const SENSITIVE_KEYWORDS = [
  'submit',
  'checkout',
  'pay',
  'purchase',
  'buy now',
  'place order',
  'delete account',
  'remove',
  'send message',
  'transfer',
  'confirm order',
  'authorize'
];

export function extractDomain(url: string): string {
  try {
    if (!url || url === 'about:blank' || url.startsWith('atlas://')) return 'internal';
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

export function isSensitiveTarget(text: string): boolean {
  const lower = text.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

export class PermissionGate {
  private pendingRequests = new Map<
    string,
    { resolve: (resp: ConfirmationResponse) => void; reject: (err: Error) => void }
  >();

  constructor(
    private readonly repo: PlatformRepository,
    private readonly audit: AuditLogger,
    private readonly killSwitch: KillSwitch,
    private prompter?: ConfirmationPrompter
  ) {}

  public setPrompter(prompter: ConfirmationPrompter): void {
    this.prompter = prompter;
  }

  public resolveConfirmation(response: ConfirmationResponse): void {
    const pending = this.pendingRequests.get(response.requestId);
    if (!pending) return;
    this.pendingRequests.delete(response.requestId);
    pending.resolve(response);
  }

  public cancelAllPending(reason = 'Cancelled by emergency stop or run abort'): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      this.pendingRequests.delete(id);
      pending.reject(new Error(reason));
    }
  }

  public listDomainRules(): DomainRule[] {
    return this.repo.listDomainRules();
  }

  public setDomainRule(domain: string, mode: DomainPermissionMode, expiresAt?: number | null): DomainRule {
    const rule = this.repo.setDomainRule(domain, mode, expiresAt);
    this.audit.log({
      category: 'permission',
      action: 'domain_rule_set',
      actor: 'user',
      domain: rule.domain,
      details: { mode: rule.mode, expiresAt: rule.expiresAt ?? null }
    });
    return rule;
  }

  public deleteDomainRule(domainOrId: string): void {
    this.repo.deleteDomainRule(domainOrId);
    this.audit.log({
      category: 'permission',
      action: 'domain_rule_deleted',
      actor: 'user',
      details: { domainOrId }
    });
  }

  private getDomainRule(domain: string): DomainRule | undefined {
    const rules = this.repo.listDomainRules();
    return rules.find((r) => r.domain === domain || domain.endsWith(`.${r.domain}`));
  }

  public async authorize(input: PermissionCheckInput): Promise<PermissionCheckResult> {
    if (this.killSwitch.isTriggered()) {
      return {
        allowed: false,
        decision: 'denied',
        reason: this.killSwitch.getLastReason() || 'Emergency kill switch active'
      };
    }

    const domain = extractDomain(input.url);

    // Takeover mode blocks autonomous tool execution
    if (input.mode === 'takeover') {
      return {
        allowed: false,
        decision: 'denied',
        reason: 'Browser is currently in Takeover mode; user has manual control'
      };
    }

    // Ask mode only allows read_only tools
    if (input.mode === 'ask' && input.tier !== 'read_only') {
      this.audit.log({
        runId: input.runId,
        category: 'permission',
        action: 'denied_ask_mode',
        actor: 'permission_gate',
        domain,
        details: { toolName: input.toolName, tier: input.tier }
      });
      return {
        allowed: false,
        decision: 'denied',
        reason: `Tool "${input.toolName}" (${input.tier}) is not allowed in Ask mode`
      };
    }

    // Enforce explicit skill/job domain allowlist if provided
    if (input.allowedDomainsOverride && input.allowedDomainsOverride.length > 0 && domain !== 'internal') {
      const matched = input.allowedDomainsOverride.some(
        (d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`)
      );
      if (!matched) {
        this.audit.log({
          runId: input.runId,
          category: 'permission',
          action: 'denied_domain_allowlist',
          actor: 'permission_gate',
          domain,
          details: { toolName: input.toolName, allowedDomains: input.allowedDomainsOverride }
        });
        return {
          allowed: false,
          decision: 'denied',
          reason: `Domain "${domain}" is outside the task's allowed domains`
        };
      }
    }

    // Check per-domain rules
    const rule = this.getDomainRule(domain);
    if (rule) {
      if (rule.mode === 'deny') {
        this.audit.log({
          runId: input.runId,
          category: 'permission',
          action: 'denied_by_domain_rule',
          actor: 'permission_gate',
          domain,
          details: { toolName: input.toolName, ruleMode: rule.mode }
        });
        return {
          allowed: false,
          decision: 'denied',
          reason: `Domain "${domain}" is denied by domain permission rules`
        };
      }
      if (rule.mode === 'read_only' && input.tier !== 'read_only') {
        this.audit.log({
          runId: input.runId,
          category: 'permission',
          action: 'denied_by_readonly_domain',
          actor: 'permission_gate',
          domain,
          details: { toolName: input.toolName, tier: input.tier }
        });
        return {
          allowed: false,
          decision: 'denied',
          reason: `Domain "${domain}" is restricted to read-only agent access`
        };
      }
    }

    // Determine if explicit confirmation is required:
    // 1. Always for 'sensitive' tier (even if domain is 'allow' — never infer approval for sensitive actions)
    // 2. Always for 'interact' tier when in 'assist' mode
    const needsConfirmation =
      input.tier === 'sensitive' || (input.mode === 'assist' && input.tier === 'interact');

    if (!needsConfirmation) {
      return { allowed: true, decision: 'allowed' };
    }

    if (!this.prompter) {
      return {
        allowed: false,
        decision: 'rejected',
        reason: `Confirmation required for "${input.toolName}" (${input.tier}), but no interactive prompter is available`
      };
    }

    const request: ConfirmationRequest = {
      id: randomUUID(),
      runId: input.runId,
      toolName: input.toolName,
      domain,
      currentUrl: input.url,
      actionSummary: input.actionSummary,
      targetDescription: input.targetDescription,
      submittedDataSummary: input.submittedDataSummary,
      expectedConsequence: input.expectedConsequence,
      reversible: input.reversible,
      tier: input.tier,
      createdAt: Date.now()
    };

    this.audit.log({
      runId: input.runId,
      category: 'confirmation',
      action: 'confirmation_requested',
      actor: 'permission_gate',
      domain,
      details: {
        requestId: request.id,
        toolName: request.toolName,
        tier: request.tier,
        target: request.targetDescription,
        reversible: request.reversible
      }
    });

    let response: ConfirmationResponse;
    try {
      response = await new Promise<ConfirmationResponse>((resolve, reject) => {
        this.pendingRequests.set(request.id, { resolve, reject });
        this.prompter!(request).then(
          (res) => {
            if (this.pendingRequests.has(request.id)) {
              this.pendingRequests.delete(request.id);
              resolve(res);
            }
          },
          (err) => {
            if (this.pendingRequests.has(request.id)) {
              this.pendingRequests.delete(request.id);
              reject(err);
            }
          }
        );
      });
    } catch (err) {
      return {
        allowed: false,
        decision: 'rejected',
        reason: err instanceof Error ? err.message : 'Confirmation cancelled'
      };
    }

    if (response.approved && response.rememberForDomain && response.domainRuleMode && input.tier !== 'sensitive') {
      this.setDomainRule(domain, response.domainRuleMode);
    }

    this.audit.log({
      runId: input.runId,
      category: 'confirmation',
      action: response.approved ? 'confirmation_approved' : 'confirmation_rejected',
      actor: 'user',
      domain,
      details: { requestId: request.id, toolName: request.toolName, approved: response.approved }
    });

    if (!response.approved) {
      return {
        allowed: false,
        decision: 'rejected',
        reason: `User rejected "${input.toolName}" on ${domain}`
      };
    }

    return { allowed: true, decision: 'confirmed' };
  }
}

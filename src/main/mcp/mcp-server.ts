import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { McpConfig, McpServerStatus } from '@shared/types';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import type { AuditLogger } from '@main/security/audit-logger';
import type { SecretVault } from '@main/security/secrets';
import type { TabManager } from '@main/browser/tab-manager';
import type { PerceptionEngine } from '@main/cdp/perception';
import type { AgentOrchestrator } from '@main/agent/orchestrator';

export const DEFAULT_MCP_TOOLS = [
  'list_tabs',
  'read_tab',
  'navigate',
  'search_tabs',
  'extract_content',
  'run_task',
  'get_task_status',
  'stop_task'
];

export const DEFAULT_MCP_CONFIG: McpConfig = {
  enabled: false, // Disabled by default
  port: 47291,
  allowedTools: [...DEFAULT_MCP_TOOLS],
  rateLimitPerMinute: 60
};

export class LocalMcpServer {
  private server: http.Server | null = null;
  private requestTimestamps: number[] = [];
  private requestCount = 0;
  private lastRequestAt: number | null = null;
  private boundPort = 47291;

  constructor(
    private readonly repo: PlatformRepository,
    private readonly vault: SecretVault,
    private readonly auditLogger: AuditLogger,
    private readonly tabManager: TabManager,
    private readonly perception: PerceptionEngine,
    private readonly orchestrator: AgentOrchestrator
  ) {}

  public getConfig(): McpConfig {
    return this.repo.getSetting<McpConfig>('mcp.config', DEFAULT_MCP_CONFIG);
  }

  public async configure(patch: Partial<McpConfig>): Promise<McpServerStatus> {
    const current = this.getConfig();
    const next: McpConfig = { ...current, ...patch };
    this.repo.setSetting('mcp.config', next);
    if (next.enabled) {
      await this.start(next.port);
    } else {
      await this.stop();
    }
    return this.getStatus();
  }

  public getStatus(): McpServerStatus {
    const cfg = this.getConfig();
    const masked = this.vault.getMaskedMcpToken();
    return {
      running: Boolean(this.server && this.server.listening),
      port: this.server?.listening ? this.boundPort : cfg.port,
      boundHost: '127.0.0.1',
      hasToken: masked !== 'Not generated',
      maskedToken: masked,
      requestCount: this.requestCount,
      lastRequestAt: this.lastRequestAt,
      allowedTools: cfg.allowedTools
    };
  }

  public async start(port = this.getConfig().port): Promise<number> {
    if (this.server && this.server.listening) {
      return this.boundPort;
    }

    this.vault.getOrCreateMcpToken();

    this.server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      // Strictly bind to 127.0.0.1 (localhost only)
      this.server!.listen(port, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.boundPort = addr.port;
        }
        resolve();
      });
    });

    this.auditLogger.log({
      category: 'mcp',
      action: 'mcp_server_started',
      actor: 'system',
      details: { host: '127.0.0.1', port: this.boundPort }
    });

    return this.boundPort;
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    srv.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
    this.auditLogger.log({
      category: 'mcp',
      action: 'mcp_server_stopped',
      actor: 'system',
      details: {}
    });
  }

  private isAuthorized(authHeader: string | undefined): boolean {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const supplied = Buffer.from(authHeader.slice(7).trim(), 'utf8');
    const expected = Buffer.from(this.vault.getOrCreateMcpToken(), 'utf8');
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(supplied, expected);
  }

  private checkRateLimit(limitPerMin: number): boolean {
    const cutoff = Date.now() - 60_000;
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > cutoff);
    if (this.requestTimestamps.length >= limitPerMin) return false;
    this.requestTimestamps.push(Date.now());
    return true;
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found. POST /mcp' }));
      return;
    }

    if (!this.isAuthorized(req.headers.authorization)) {
      this.auditLogger.log({
        category: 'mcp',
        action: 'mcp_auth_failed',
        actor: 'external_client',
        details: { remoteAddress: req.socket.remoteAddress }
      });
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing Bearer token' }));
      return;
    }

    const cfg = this.getConfig();
    if (!this.checkRateLimit(cfg.rateLimitPerMinute)) {
      res.statusCode = 429;
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return;
    }

    let bodyRaw = '';
    for await (const chunk of req) {
      bodyRaw += chunk;
      if (bodyRaw.length > 262_144) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: 'Payload too large' }));
        return;
      }
    }

    let rpc: { id?: string | number; method?: string; params?: Record<string, unknown> };
    try {
      rpc = JSON.parse(bodyRaw);
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    this.requestCount += 1;
    this.lastRequestAt = Date.now();

    if (rpc.method === 'tools/list') {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id ?? null,
          result: { tools: cfg.allowedTools }
        })
      );
      return;
    }

    if (rpc.method !== 'tools/call') {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: `Unsupported method: ${rpc.method}` }));
      return;
    }

    const toolName = String(rpc.params?.name || '');
    const args = (rpc.params?.arguments as Record<string, unknown>) ?? {};

    if (!cfg.allowedTools.includes(toolName)) {
      this.auditLogger.log({
        category: 'mcp',
        action: 'mcp_tool_denied',
        actor: 'external_client',
        details: { toolName }
      });
      res.statusCode = 403;
      res.end(JSON.stringify({ error: `Tool "${toolName}" is not on the MCP allowlist` }));
      return;
    }

    this.auditLogger.log({
      category: 'mcp',
      action: `mcp_tool_call:${toolName}`,
      actor: 'external_client',
      details: { toolName, args }
    });

    try {
      const result = await this.executeMcpTool(toolName, args);
      res.statusCode = 200;
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result }));
    } catch (err) {
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id ?? null,
          error: { message: err instanceof Error ? err.message : String(err) }
        })
      );
    }
  }

  private async executeMcpTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'list_tabs':
        return { tabs: this.tabManager.getAllTabs().filter((t) => !t.isPrivate) };

      case 'search_tabs': {
        const q = String(args.query || '').toLowerCase();
        return {
          tabs: this.tabManager
            .getAllTabs()
            .filter(
              (t) =>
                !t.isPrivate &&
                (t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
            )
        };
      }

      case 'read_tab':
      case 'extract_content': {
        const tabId = String(args.tabId || '');
        const tab = this.tabManager.getTab(tabId);
        if (!tab || tab.info.isPrivate) {
          throw new Error(`Tab unavailable or private: ${tabId}`);
        }
        const p = await this.perception.capture(tabId, tab.view.webContents, { includeAxTree: false });
        return {
          url: p.url,
          title: p.title,
          headings: p.headings,
          mainText: p.mainText.slice(0, 8000)
        };
      }

      case 'navigate': {
        const tabId = String(args.tabId || '');
        const url = String(args.url || '');
        const tab = this.tabManager.getTab(tabId);
        if (!tab || tab.info.isPrivate) throw new Error(`Tab unavailable: ${tabId}`);
        const finalUrl = await this.tabManager.navigate(tabId, url);
        return { tabId, url: finalUrl };
      }

      case 'run_task': {
        const goal = String(args.goal || '').trim();
        if (!goal) throw new Error('Missing goal');
        const tabId = args.tabId ? String(args.tabId) : this.tabManager.getAllTabs()[0]?.id ?? null;
        const run = await this.orchestrator.startRun({
          conversationId: String(args.conversationId || 'mcp-default'),
          tabId,
          goal,
          mode: 'assist' // External MCP tasks default to safe assist confirmation mode
        });
        return { runId: run.id, status: run.status };
      }

      case 'get_task_status': {
        const runId = String(args.runId || '');
        const active = this.orchestrator.getActiveRuns().find((r) => r.id === runId);
        if (active) return active;
        throw new Error(`Active run not found: ${runId}`);
      }

      case 'stop_task': {
        const runId = String(args.runId || '');
        const stopped = this.orchestrator.stopRun(runId, 'Stopped via MCP');
        return { runId, stopped };
      }

      default:
        throw new Error(`Unknown MCP tool: ${toolName}`);
    }
  }
}

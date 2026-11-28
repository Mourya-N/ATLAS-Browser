import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LavrayDatabase } from '@main/db/database';
import { BrowserRepository } from '@main/db/repositories/browser-repo';
import { AgentRepository } from '@main/db/repositories/agent-repo';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { SessionRestoreService } from '@main/browser/session-restore';
import { SecretVault } from '@main/security/secrets';
import { AuditLogger } from '@main/security/audit-logger';
import { LocalMcpServer } from '@main/mcp/mcp-server';
import { isDangerousDownload, isSensitiveDownloadLocation, resolveUniqueFilePath } from '@main/browser/download-manager';
import type { TabInfo } from '@shared/types';

describe('Integration: Persistence, Session Isolation, Downloads & MCP Server', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('runs SQLite migrations, integrity checks, and excludes private tabs from session restore', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lavray-int-'));
    tempDirs.push(dir);
    const db = new LavrayDatabase(path.join(dir, 'lavray.db'));
    expect(db.checkIntegrity()).toBe(true);

    const browserRepo = new BrowserRepository(db.db);
    const sessionRestore = new SessionRestoreService(browserRepo);

    const normalTab: TabInfo = {
      id: 't-public',
      windowId: 1,
      url: 'https://docs.python.org',
      title: 'Python Docs',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isPinned: true,
      isMuted: false,
      isPrivate: false,
      orderIndex: 0,
      zoomFactor: 1.0,
      crashed: false,
      securityState: 'secure',
      blockedCount: 0,
      agentActive: false,
      lastActiveAt: Date.now()
    };
    const privateTab: TabInfo = {
      ...normalTab,
      id: 't-private',
      url: 'https://secret.internal',
      title: 'Secret',
      isPrivate: true,
      orderIndex: 1
    };

    sessionRestore.saveNow({
      tabs: [normalTab, privateTab],
      activeTabId: 't-public',
      groups: []
    });

    const restored = sessionRestore.loadPreviousSession();
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0].url).toBe('https://docs.python.org');
    expect(restored.tabs[0].isPinned).toBe(true);
    db.close();
  });

  it('enforces MCP localhost binding, Bearer token auth, token rotation, allowlist, and rate limiting', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lavray-mcp-'));
    tempDirs.push(dir);
    const db = new LavrayDatabase(':memory:');
    const platformRepo = new PlatformRepository(db.db);
    const vault = new SecretVault(dir);
    const audit = new AuditLogger(platformRepo);

    const fakeTabManager = {
      getAllTabs: () => [
        { id: 't1', url: 'https://example.com', title: 'Example', isPrivate: false },
        { id: 't2', url: 'https://private.local', title: 'Private', isPrivate: true }
      ],
      getTab: (id: string) =>
        id === 't1'
          ? { info: { id: 't1', isPrivate: false }, view: { webContents: {} } }
          : undefined
    } as any;

    const fakePerception = {
      capture: async () => ({
        url: 'https://example.com',
        title: 'Example',
        headings: ['H1: Example'],
        mainText: 'Hello MCP'
      })
    } as any;

    const mcp = new LocalMcpServer(
      platformRepo,
      vault,
      audit,
      fakeTabManager,
      fakePerception,
      {} as any
    );

    await mcp.configure({ enabled: true, port: 0, rateLimitPerMinute: 4 });
    const status = mcp.getStatus();
    expect(status.running).toBe(true);
    expect(status.boundHost).toBe('127.0.0.1');

    const endpoint = `http://127.0.0.1:${status.port}/mcp`;

    // 1. Unauthenticated rejected
    const unauth = await fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ method: 'tools/list' })
    });
    expect(unauth.status).toBe(401);

    // 2. Valid token returns non-private tabs only
    const token1 = vault.getOrCreateMcpToken();
    const okRes = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token1}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'list_tabs', arguments: {} } })
    });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { result: { tabs: Array<{ id: string }> } };
    expect(okBody.result.tabs.map((t) => t.id)).toEqual(['t1']);

    // 3. Disallowed tool rejected
    const forbidden = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token1}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 2, method: 'tools/call', params: { name: 'arbitrary_shell', arguments: {} } })
    });
    expect(forbidden.status).toBe(403);

    // 4. Token rotation invalidates old token
    const token2 = vault.rotateMcpToken();
    expect(token2).not.toBe(token1);
    const stale = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token1}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 3, method: 'tools/list' })
    });
    expect(stale.status).toBe(401);

    // 5. Rate limit enforcement (limit=4 per min, already made 2 valid calls)
    await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 4, method: 'tools/list' })
    });
    await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 5, method: 'tools/list' })
    });
    const rateLimited = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 6, method: 'tools/list' })
    });
    expect(rateLimited.status).toBe(429);

    await mcp.stop();
    expect(mcp.getStatus().running).toBe(false);
    db.close();
  });

  it('handles duplicate download filenames and dangerous download classification', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lavray-dl-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'report.pdf'), 'a');
    fs.writeFileSync(path.join(dir, 'report (1).pdf'), 'b');

    expect(resolveUniqueFilePath(dir, 'report.pdf')).toBe(path.join(dir, 'report (2).pdf'));
    expect(isDangerousDownload('installer.dmg')).toBe(true);
    expect(isDangerousDownload('notes.txt')).toBe(false);
    expect(isSensitiveDownloadLocation('/etc/passwd', dir)).toBe(true);
    expect(isSensitiveDownloadLocation(path.join(dir, 'notes.txt'), dir)).toBe(false);
  });

  it('persists full agent runs, steps, tool executions, and aggregates cost metrics', () => {
    const db = new LavrayDatabase(':memory:');
    const agentRepo = new AgentRepository(db.db);
    const conv = agentRepo.createConversation('Eval');
    agentRepo.saveRun({
      id: 'run-a',
      conversationId: conv.id,
      goal: 'Compare docs',
      mode: 'agent',
      status: 'completed',
      subgoals: [],
      steps: [],
      totalInputTokens: 500,
      totalOutputTokens: 200,
      estimatedCostUsd: 0.002,
      isCostEstimated: false,
      model: 'gemini-2.5-flash',
      provider: 'gemini',
      isPrivate: false,
      startedAt: Date.now() - 1500,
      endedAt: Date.now()
    });
    agentRepo.recordCost({
      runId: 'run-a',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 500,
      outputTokens: 200,
      costUsd: 0.002,
      isEstimated: false
    });
    const summary = agentRepo.getCostSummary();
    expect(summary.totalRuns).toBe(1);
    expect(summary.successfulRuns).toBe(1);
    expect(summary.totalCostUsd).toBeCloseTo(0.002, 5);
    db.close();
  });
});

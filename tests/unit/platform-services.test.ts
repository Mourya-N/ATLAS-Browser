import { describe, expect, it, beforeEach } from 'vitest';
import { AtlasDatabase } from '@main/db/database';
import { BrowserRepository } from '@main/db/repositories/browser-repo';
import { PlatformRepository } from '@main/db/repositories/platform-repo';
import { AuditLogger } from '@main/security/audit-logger';
import { KillSwitch } from '@main/security/kill-switch';
import { PermissionGate } from '@main/security/permission-gate';
import { MemoryService } from '@main/memory/memory-service';
import { SkillRecorder } from '@main/skills/skill-recorder';
import { SkillRunner, interpolateSkillArgs } from '@main/skills/skill-runner';
import { ToolRegistry } from '@main/agent/tool-registry';
import { computeNextRunAt, JobScheduler } from '@main/scheduler/job-scheduler';
import { AdBlocker } from '@main/browser/ad-blocker';
import { extractReadableArticle } from '@main/browser/reader-extractor';
import { getOmniboxSuggestions, getSecurityState, resolveNavigationInput } from '@main/browser/navigation';
import type { AgentRun } from '@shared/types';

describe('Platform & Browser Services', () => {
  let db: AtlasDatabase;
  let browserRepo: BrowserRepository;
  let platformRepo: PlatformRepository;
  let audit: AuditLogger;

  beforeEach(() => {
    db = new AtlasDatabase(':memory:');
    browserRepo = new BrowserRepository(db.db);
    platformRepo = new PlatformRepository(db.db);
    audit = new AuditLogger(platformRepo);
  });

  it('blocks sensitive secrets in MemoryService and retrieves relevant memories', () => {
    const mem = new MemoryService(platformRepo);
    expect(() =>
      mem.save({
        category: 'user_preference',
        title: 'API Key',
        content: 'AIzaSyFakeKey1234567890123456',
        source: 'user'
      })
    ).toThrow(/sensitive/i);

    mem.save({
      category: 'site_preference',
      domain: 'spring.io',
      title: 'Prefer Spring Boot 3.4 docs',
      content: 'Always inspect the Spring Security 6 reference section first.',
      source: 'user'
    });
    mem.save({
      category: 'user_preference',
      title: 'Output Format',
      content: 'Prefer concise markdown comparison tables.',
      source: 'user'
    });

    const hits = mem.retrieveRelevant('Spring Boot security docs', 'spring.io', 3);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].domain).toBe('spring.io');
  });

  it('records, exports, imports, interpolates, and replays skills with fallback', async () => {
    const recorder = new SkillRecorder(platformRepo);
    const run: AgentRun = {
      id: 'r-skill',
      conversationId: 'c1',
      goal: 'Check Docs',
      mode: 'agent',
      status: 'completed',
      subgoals: [],
      steps: [
        {
          id: 's1',
          runId: 'r-skill',
          stepIndex: 1,
          phase: 'execute',
          summary: 'Open page',
          decisionExplanation: 'ok',
          injectionWarnings: [],
          toolExecution: {
            id: 't1',
            runId: 'r-skill',
            stepId: 's1',
            toolName: 'navigate',
            permissionTier: 'interact',
            args: { url: 'https://example.com' },
            validated: true,
            permissionDecision: 'allowed',
            success: true,
            durationMs: 20,
            pageDiff: {
              urlChanged: true,
              previousUrl: '',
              currentUrl: 'https://example.com',
              titleChanged: true,
              previousTitle: '',
              currentTitle: 'Example',
              addedElementsCount: 1,
              removedElementsCount: 0,
              textDeltaSummary: 'loaded',
              scrollChanged: false
            },
            createdAt: Date.now()
          },
          createdAt: Date.now()
        }
      ],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      isCostEstimated: false,
      model: 'mock',
      provider: 'mock',
      isPrivate: false,
      startedAt: Date.now()
    };

    const recorded = recorder.recordFromRun(run, { name: 'Open Example' });
    expect(recorded.steps).toHaveLength(1);
    expect(recorded.allowedDomains).toContain('example.com');

    const exported = recorder.exportSkillJson(recorded.id);
    const imported = recorder.importSkillJson(exported);
    expect(imported.id).not.toBe(recorded.id);
    expect(imported.steps).toHaveLength(1);

    expect(interpolateSkillArgs({ url: 'https://{{host}}/docs' }, { host: 'atlas.dev' })).toEqual({
      url: 'https://atlas.dev/docs'
    });

    const gate = new PermissionGate(platformRepo, audit, new KillSwitch());
    const registry = new ToolRegistry(gate, audit);
    registry.register({
      name: 'navigate',
      description: 'mock nav',
      baseTier: 'interact',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      execute: async (args, ctx) => {
        ctx.lastPerception = { url: String(args.url) } as any;
        return { success: true, data: { url: args.url } };
      }
    });

    const runner = new SkillRunner(platformRepo, registry, audit);
    const exec = await runner.runSkill({
      skill: recorded,
      args: {},
      mode: 'agent',
      createContext: (runId) =>
        ({
          runId,
          tabId: 'tab1',
          mode: 'agent',
          isPrivate: false,
          tabManager: { getTab: () => ({ info: { url: 'https://example.com' } }) }
        }) as any
    });
    expect(exec.status).toBe('completed');
  });

  it('schedules cron jobs and pauses background jobs requiring sensitive permissions', async () => {
    const gate = new PermissionGate(platformRepo, audit, new KillSwitch());
    const registry = new ToolRegistry(gate, audit);
    const runner = new SkillRunner(platformRepo, registry, audit);
    const scheduler = new JobScheduler(platformRepo, runner, audit, () => null);

    const next = computeNextRunAt('cron', '0 9 * * *', null, 'UTC', Date.UTC(2026, 0, 1, 8, 0, 0));
    expect(next).toBe(Date.UTC(2026, 0, 1, 9, 0, 0));

    const sensitiveSkill = platformRepo.saveSkill({
      id: 'sk-sens',
      name: 'Sensitive Skill',
      description: 'Needs confirm',
      version: 1,
      parameters: [],
      preconditions: [],
      requiredPermissions: ['sensitive'],
      allowedDomains: [],
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      executionCount: 0,
      successCount: 0
    });

    const job = scheduler.saveJob({
      name: 'Nightly Purchase',
      skillId: sensitiveSkill.id,
      triggerType: 'daily'
    });

    const executed = await scheduler.executeJob(job);
    expect(executed.lastStatus).toBe('paused_permission');
    expect(executed.paused).toBe(true);
  });

  it('blocks trackers while protecting mainFrame navigations and allowlisted sites', () => {
    const adBlock = new AdBlocker(platformRepo);
    expect(adBlock.classifyRequest('https://doubleclick.net/ads.js', 'https://news.com', 'script').block).toBe(true);
    expect(adBlock.classifyRequest('https://news.com/article', 'https://news.com', 'mainFrame').block).toBe(false);

    adBlock.toggleDomainAllowlist('news.com', true);
    expect(adBlock.classifyRequest('https://doubleclick.net/ads.js', 'https://news.com/page', 'script').block).toBe(
      false
    );
  });

  it('extracts readable articles and resolves navigation/omnibox queries', () => {
    const html = `<!doctype html><html><head><title>Atlas Architecture</title><meta name="author" content="Jane Doe"></head><body><nav>Menu Home</nav><article><h1>Atlas Architecture</h1><p>${'Atlas Browser integrates deterministic perception with verifiable agent execution. '.repeat(12)}</p></article></body></html>`;
    const article = extractReadableArticle(html, 'https://atlas.dev/arch');
    expect(article).not.toBeNull();
    expect(article?.title).toContain('Atlas Architecture');
    expect(article?.textContent).toContain('deterministic perception');

    expect(resolveNavigationInput('github.com/atlas', 'google')).toBe('https://github.com/atlas');
    expect(resolveNavigationInput('localhost:3000', 'google')).toBe('http://localhost:3000');
    expect(resolveNavigationInput('spring boot security', 'duckduckgo')).toBe(
      'https://duckduckgo.com/?q=spring%20boot%20security'
    );
    expect(getSecurityState('https://example.com')).toBe('secure');
    expect(getSecurityState('http://example.com')).toBe('insecure');

    browserRepo.recordVisit('https://spring.io/security', 'Spring Security Docs');
    const sugg = getOmniboxSuggestions(browserRepo, 'spring', 'google');
    expect(sugg.some((s) => s.url === 'https://spring.io/security')).toBe(true);
  });
});

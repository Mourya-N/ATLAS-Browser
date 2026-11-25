import { randomUUID } from 'node:crypto';
import type { CloudBackgroundJob } from '@shared/types';
import type { CloudRepository } from '../../db/repository';
import type { BackendLogger } from '../../observability/logger';
import type { HybridIndexService } from '../knowledge/hybrid-index-service';
import type { ResearchExtractorService } from '../research/research-extractor';

export class WorkerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repo: CloudRepository,
    private readonly extractor: ResearchExtractorService,
    private readonly hybridIndex: HybridIndexService,
    private readonly logger: BackendLogger
  ) {}

  public async enqueue(params: {
    userId: string;
    profileId: string;
    type: CloudBackgroundJob['type'];
    payload: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<CloudBackgroundJob> {
    const now = Date.now();
    const job: CloudBackgroundJob = {
      id: randomUUID(),
      userId: params.userId,
      profileId: params.profileId,
      type: params.type,
      payload: params.payload,
      status: 'queued',
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 3,
      result: null,
      error: null,
      runAfter: now,
      createdAt: now,
      updatedAt: now
    };
    return this.repo.enqueueJob(job);
  }

  public startLoop(pollIntervalMs = 2000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.running) {
        this.running = true;
        void this.processOnce()
          .catch((err) => {
            this.logger.log('error', 'Worker poll error', {
              error: err instanceof Error ? err.message : String(err)
            });
          })
          .finally(() => {
            this.running = false;
          });
      }
    }, pollIntervalMs);
  }

  public stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async processOnce(nowMs = Date.now()): Promise<CloudBackgroundJob | null> {
    const job = await this.repo.claimNextDueJob(nowMs);
    if (!job) return null;

    try {
      let result: Record<string, unknown> = {};

      if (job.type === 'page_extract') {
        const url = String(job.payload.url || '');
        const extracted = await this.extractor.fetchAndExtract(url, {
          allowLocalhostForTest: Boolean(job.payload.allowLocalhostForTest)
        });
        await this.hybridIndex.upsertDocument({
          userId: job.userId,
          profileId: job.profileId,
          sourceType: 'web_page',
          sourceId: extracted.canonicalUrl,
          url: extracted.finalUrl,
          title: extracted.title,
          content: extracted.textContent,
          metadata: { headings: extracted.headings }
        });
        result = { url: extracted.finalUrl, title: extracted.title, chunks: extracted.chunks.length };
      } else if (job.type === 'reindex_knowledge' || job.type === 'embedding_backfill') {
        const stats = await this.hybridIndex.reindexProfile(job.userId, job.profileId);
        const pruned = await this.hybridIndex.pruneExpired();
        result = { ...stats, prunedExpired: pruned };
      } else if (job.type === 'research_job') {
        const urls = Array.isArray(job.payload.urls) ? job.payload.urls.map(String) : [];
        const docs = [];
        for (const u of urls.slice(0, 6)) {
          const ex = await this.extractor.fetchAndExtract(u, {
            allowLocalhostForTest: Boolean(job.payload.allowLocalhostForTest)
          });
          docs.push({ url: ex.finalUrl, title: ex.title, textLength: ex.textContent.length });
        }
        result = { extractedCount: docs.length, sources: docs };
      }

      const completed: CloudBackgroundJob = {
        ...job,
        status: 'completed',
        result,
        error: null,
        updatedAt: Date.now()
      };
      await this.repo.updateJob(completed);
      return completed;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const shouldDeadLetter = job.attempts >= job.maxAttempts;
      const backoffMs = Math.pow(2, job.attempts) * 1000;
      const updated: CloudBackgroundJob = {
        ...job,
        status: shouldDeadLetter ? 'dead_letter' : 'queued',
        error: errMsg,
        runAfter: shouldDeadLetter ? job.runAfter : Date.now() + backoffMs,
        updatedAt: Date.now()
      };
      await this.repo.updateJob(updated);
      this.logger.log('warn', 'Background job execution failed', {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
        status: updated.status,
        error: errMsg
      });
      return updated;
    }
  }
}

import type { AuditEvent } from '@shared/types';
import type { PlatformRepository } from '@main/db/repositories/platform-repo';
import { redactObjectSecrets } from './secrets';

export class AuditLogger {
  constructor(private readonly repo: PlatformRepository) {}

  public log(event: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
    const redactedDetails = redactObjectSecrets(event.details);
    return this.repo.insertAuditEvent({
      ...event,
      details: redactedDetails
    });
  }

  public list(query = '', category?: string, limit = 200): AuditEvent[] {
    return this.repo.listAuditEvents(query, category, limit);
  }

  public delete(id?: string): void {
    this.repo.deleteAuditEvents(id);
  }

  public exportJson(): string {
    const events = this.repo.listAuditEvents('', undefined, 5000);
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        count: events.length,
        events
      },
      null,
      2
    );
  }
}

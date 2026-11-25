export interface ActionSignature {
  toolName: string;
  argsKey: string;
  url: string;
  success: boolean;
}

export interface LoopDetectionResult {
  stuck: boolean;
  reason?: string;
  recommendedAction?: 'retry_alternate_strategy' | 'backtrack' | 'replan' | 'abort';
}

export class RecoveryMonitor {
  private history: ActionSignature[] = [];
  private failedSelectors = new Map<string, number>();
  private urlVisits: string[] = [];

  public record(sig: ActionSignature): void {
    this.history.push(sig);
    this.urlVisits.push(sig.url);

    if (!sig.success) {
      const key = `${sig.toolName}:${sig.argsKey}`;
      this.failedSelectors.set(key, (this.failedSelectors.get(key) ?? 0) + 1);
    }
  }

  public analyze(): LoopDetectionResult {
    const len = this.history.length;
    if (len < 3) return { stuck: false };

    // 1. Exact same tool + args repeated 3 times in a row
    const last3 = this.history.slice(-3);
    if (
      last3.every(
        (h) => h.toolName === last3[0].toolName && h.argsKey === last3[0].argsKey
      )
    ) {
      return {
        stuck: true,
        reason: `Repeated identical action "${last3[0].toolName}" 3 consecutive times`,
        recommendedAction: last3.every((h) => !h.success) ? 'retry_alternate_strategy' : 'replan'
      };
    }

    // 2. Repeated failed selector >= 3 times overall
    for (const [key, count] of this.failedSelectors.entries()) {
      if (count >= 3) {
        return {
          stuck: true,
          reason: `Target "${key}" failed ${count} times`,
          recommendedAction: 'replan'
        };
      }
    }

    // 3. Ping-pong navigation A -> B -> A -> B
    if (this.urlVisits.length >= 4) {
      const [u1, u2, u3, u4] = this.urlVisits.slice(-4);
      if (u1 !== u2 && u1 === u3 && u2 === u4) {
        return {
          stuck: true,
          reason: `Ping-pong navigation loop detected between ${u1} and ${u2}`,
          recommendedAction: 'backtrack'
        };
      }
    }

    // 4. 5 consecutive failures
    if (len >= 5 && this.history.slice(-5).every((h) => !h.success)) {
      return {
        stuck: true,
        reason: '5 consecutive tool failures with no progress',
        recommendedAction: 'abort'
      };
    }

    return { stuck: false };
  }

  public reset(): void {
    this.history = [];
    this.failedSelectors.clear();
    this.urlVisits = [];
  }
}

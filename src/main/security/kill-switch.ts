export type KillSwitchListener = (reason: string) => void | Promise<void>;

export class KillSwitch {
  private triggered = false;
  private lastReason: string | null = null;
  private listeners = new Set<KillSwitchListener>();

  public registerListener(listener: KillSwitchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async trigger(reason = 'Emergency stop triggered by user'): Promise<void> {
    this.triggered = true;
    this.lastReason = reason;
    const errors: unknown[] = [];
    for (const listener of this.listeners) {
      try {
        await listener(reason);
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      console.error('[KillSwitch] Listener errors during emergency stop:', errors);
    }
  }

  public reset(): void {
    this.triggered = false;
    this.lastReason = null;
  }

  public isTriggered(): boolean {
    return this.triggered;
  }

  public getLastReason(): string | null {
    return this.lastReason;
  }
}

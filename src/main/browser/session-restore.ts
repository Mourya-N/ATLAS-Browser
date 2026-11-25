import type { TabGroup, TabInfo } from '@shared/types';
import type { BrowserRepository, SavedTabRow } from '@main/db/repositories/browser-repo';

export class SessionRestoreService {
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly repo: BrowserRepository) {}

  public scheduleSave(getState: () => { tabs: TabInfo[]; activeTabId: string | null; groups: TabGroup[] }): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow(getState());
    }, 350);
  }

  public saveNow(state: { tabs: TabInfo[]; activeTabId: string | null; groups: TabGroup[] }): void {
    try {
      // Only persist non-private tabs
      const safeTabs = state.tabs.filter((t) => !t.isPrivate);
      this.repo.saveSessionSnapshot(safeTabs, state.activeTabId, state.groups);
    } catch (err) {
      console.error('[SessionRestore] Failed to save snapshot:', err);
    }
  }

  public loadPreviousSession(): { tabs: SavedTabRow[]; groups: TabGroup[] } {
    return this.repo.loadSessionSnapshot();
  }
}

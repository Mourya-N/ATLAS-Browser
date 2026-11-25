import { randomUUID } from 'node:crypto';
import type { PagePerception, ProactiveSuggestion, TabInfo } from '@shared/types';
import type { AgentRepository } from '@main/db/repositories/agent-repo';

export class ProactiveAssistant {
  constructor(private readonly agentRepo: AgentRepository) {}

  public evaluate(params: {
    enabled: boolean;
    tabs: TabInfo[];
    activeTab: TabInfo | null;
    activePerception: PagePerception | null;
    relatedPairsCount: number;
    duplicateGroups: Array<{ url: string; tabIds: string[] }>;
  }): ProactiveSuggestion[] {
    // Strictly opt-in and never initiates actions autonomously
    if (!params.enabled) return [];
    const suggestions: ProactiveSuggestion[] = [];

    if (
      params.activeTab &&
      !params.activeTab.isPrivate &&
      params.activePerception &&
      params.activePerception.mainText.length >= 3000
    ) {
      suggestions.push({
        id: randomUUID(),
        kind: 'long_article',
        title: 'Long page detected',
        description: `"${params.activeTab.title}" has ${Math.round(params.activePerception.mainText.length / 5)} words. Summarize or open Reading Mode?`,
        actionLabel: 'Summarize Page',
        payload: { tabId: params.activeTab.id, command: '/summarize' }
      });
    }

    if (params.duplicateGroups.length > 0) {
      const totalDupes = params.duplicateGroups.reduce((acc, g) => acc + g.tabIds.length - 1, 0);
      suggestions.push({
        id: randomUUID(),
        kind: 'duplicate_tabs',
        title: `${totalDupes} duplicate tab(s) open`,
        description: `Found ${params.duplicateGroups.length} URL(s) open in multiple tabs.`,
        actionLabel: 'Inspect Tabs',
        payload: { duplicateGroups: params.duplicateGroups }
      });
    }

    if (params.relatedPairsCount > 0) {
      suggestions.push({
        id: randomUUID(),
        kind: 'related_tabs',
        title: 'Related tabs discovered',
        description: `${params.relatedPairsCount} pair(s) of open tabs share overlapping topics. Compare them side-by-side?`,
        actionLabel: 'Compare Tabs',
        payload: { command: '/compare' }
      });
    }

    const interrupted = this.agentRepo.listInterruptedRuns();
    if (interrupted.length > 0) {
      const latest = interrupted[0];
      suggestions.push({
        id: randomUUID(),
        kind: 'interrupted_task',
        title: 'Interrupted task available to resume',
        description: `"${latest.run.goal}" paused at step ${latest.checkpoint.stepCount}.`,
        actionLabel: 'Resume Task',
        payload: { runId: latest.run.id }
      });
    }

    return suggestions.slice(0, 4);
  }
}

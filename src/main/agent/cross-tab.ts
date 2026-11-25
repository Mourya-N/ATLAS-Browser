import type { CrossTabAnalysis, PagePerception, TabInfo } from '@shared/types';
import { computeLocalEmbedding, cosineSimilarity } from '@main/memory/memory-service';
import type { InjectionGuard } from '@main/security/injection-guard';
import type { ModelProvider } from './providers/model-provider';

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
}

export class CrossTabIntelligence {
  constructor(
    private readonly getProvider: () => ModelProvider,
    private readonly injectionGuard: InjectionGuard
  ) {}

  public filterAllowedTabs(
    allTabs: TabInfo[],
    selectedTabIds?: string[],
    allowPrivateContext = false
  ): TabInfo[] {
    const safeTabs = allowPrivateContext ? allTabs : allTabs.filter((t) => !t.isPrivate);
    if (selectedTabIds && selectedTabIds.length > 0) {
      const allowedSet = new Set(selectedTabIds);
      return safeTabs.filter((t) => allowedSet.has(t.id));
    }
    return safeTabs;
  }

  public analyzeTabs(
    tabs: TabInfo[],
    perceptionsByTabId: Map<string, PagePerception>
  ): CrossTabAnalysis {
    // 1. Duplicate URL detection (normalized without hash)
    const byUrl = new Map<string, string[]>();
    for (const tab of tabs) {
      if (!tab.url || tab.url === 'about:blank') continue;
      const cleanUrl = tab.url.split('#')[0];
      const list = byUrl.get(cleanUrl) ?? [];
      list.push(tab.id);
      byUrl.set(cleanUrl, list);
    }
    const duplicateGroups = Array.from(byUrl.entries())
      .filter(([, ids]) => ids.length > 1)
      .map(([url, tabIds]) => ({ url, tabIds }));

    // 2. Related-page discovery using token + local embedding similarity
    const tabTokens = new Map<string, Set<string>>();
    const tabEmbeddings = new Map<string, number[]>();
    for (const tab of tabs) {
      const p = perceptionsByTabId.get(tab.id);
      const text = `${tab.title} ${p?.headings.join(' ') || ''} ${p?.mainText.slice(0, 1500) || ''}`;
      tabTokens.set(tab.id, tokenize(text));
      tabEmbeddings.set(tab.id, computeLocalEmbedding(text));
    }

    const relatedPairs: CrossTabAnalysis['relatedPairs'] = [];
    for (let i = 0; i < tabs.length; i++) {
      for (let j = i + 1; j < tabs.length; j++) {
        const a = tabs[i];
        const b = tabs[j];
        if (a.url === b.url) continue;
        const tokA = tabTokens.get(a.id) ?? new Set();
        const tokB = tabTokens.get(b.id) ?? new Set();
        const shared: string[] = [];
        for (const t of tokA) {
          if (tokB.has(t)) shared.push(t);
        }
        const sim = cosineSimilarity(tabEmbeddings.get(a.id) ?? [], tabEmbeddings.get(b.id) ?? []);
        const overlapScore = Number(
          Math.min(1, sim * 0.7 + shared.length / Math.max(4, Math.min(tokA.size, tokB.size))).toFixed(2)
        );
        if (overlapScore >= 0.35 || shared.length >= 3) {
          relatedPairs.push({
            tabA: a.id,
            tabB: b.id,
            overlapScore,
            sharedTopics: shared.slice(0, 8)
          });
        }
      }
    }

    return {
      tabs: tabs.map((t) => ({ tabId: t.id, url: t.url, title: t.customTitle || t.title, groupId: t.groupId })),
      duplicateGroups,
      relatedPairs,
      summary: `Analyzed ${tabs.length} tab(s): ${duplicateGroups.length} duplicate group(s), ${relatedPairs.length} related pair(s).`
    };
  }

  public async compareSelectedTabs(params: {
    tabs: TabInfo[];
    perceptions: PagePerception[];
    criteria: string;
    model: string;
  }): Promise<string> {
    const provider = this.getProvider();
    const content = params.perceptions
      .map((p, idx) =>
        this.injectionGuard.wrapUntrustedContent(
          p.url,
          `TAB ${idx + 1}: ${p.title} (${p.url})\nHEADINGS: ${p.headings.slice(0, 10).join('; ')}\nTABLES: ${p.tablesSummary.slice(0, 2).join('\n')}\nTEXT:\n${p.mainText.slice(0, 3500)}`
        )
      )
      .join('\n\n');

    const resp = await provider.generate({
      model: params.model,
      systemInstruction:
        'You are the Atlas Cross-Tab Intelligence Engine. Compare the provided tabs objectively based on actual content, include a Markdown comparison table with source URLs, and note any missing attributes explicitly.',
      messages: [
        {
          role: 'user',
          parts: [{ text: `Comparison Criteria: ${params.criteria}\n\n${content}` }]
        }
      ],
      temperature: 0.15
    });

    return resp.text;
  }
}

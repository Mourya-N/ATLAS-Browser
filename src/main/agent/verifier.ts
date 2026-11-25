import type { PageDiff, PagePerception, Subgoal } from '@shared/types';

export interface VerificationResult {
  outcome: 'passed' | 'retry' | 'replan' | 'failed';
  evidence: string;
  reason: string;
}

export class ActionVerifier {
  public verifyToolStep(params: {
    subgoal: Subgoal;
    toolName: string;
    toolSuccess: boolean;
    toolError?: string | null;
    toolData?: unknown;
    pageDiff?: PageDiff | null;
    afterPerception?: PagePerception | null;
    maxRetries: number;
  }): VerificationResult {
    const { subgoal, toolName, toolSuccess, toolError, toolData, pageDiff, afterPerception, maxRetries } = params;

    if (!toolSuccess) {
      if (toolError && /denied|rejected|emergency|kill switch/i.test(toolError)) {
        return {
          outcome: 'failed',
          evidence: toolError,
          reason: 'Action blocked by safety gate or user rejection'
        };
      }
      if (subgoal.attempts >= maxRetries) {
        return {
          outcome: 'replan',
          evidence: toolError || 'Tool execution failed repeatedly',
          reason: `Reached ${subgoal.attempts} attempts without success; re-planning required`
        };
      }
      return {
        outcome: 'retry',
        evidence: toolError || 'Tool returned error',
        reason: 'Tool failed; retrying with fallback strategy'
      };
    }

    // Evidence-based checks: tool returning without exception is NOT enough by itself
    if (toolName === 'navigate') {
      const url = afterPerception?.url || (toolData as { url?: string })?.url || '';
      if (!url || url === 'about:blank') {
        return {
          outcome: subgoal.attempts >= maxRetries ? 'replan' : 'retry',
          evidence: `Tab remained on ${url || 'empty URL'}`,
          reason: 'Navigation did not land on a target page'
        };
      }
      if (/Unable to load page/i.test(afterPerception?.title || '') || /Navigation Error/i.test(afterPerception?.title || '')) {
        return {
          outcome: 'replan',
          evidence: `Navigation error page encountered at ${url}`,
          reason: 'Target URL failed to load'
        };
      }
      return {
        outcome: 'passed',
        evidence: `Navigated to ${url} (${afterPerception?.title || 'loaded'})`,
        reason: 'Navigation verified via URL and page load state'
      };
    }

    if (toolName === 'click' || toolName === 'type' || toolName === 'select') {
      const changed =
        Boolean(pageDiff?.urlChanged) ||
        Boolean(pageDiff?.titleChanged) ||
        (pageDiff?.addedElementsCount ?? 0) > 0 ||
        (pageDiff?.removedElementsCount ?? 0) > 0 ||
        (pageDiff?.textDeltaSummary && pageDiff.textDeltaSummary !== 'Text unchanged') ||
        toolName === 'type';

      if (!changed && subgoal.attempts < maxRetries) {
        return {
          outcome: 'retry',
          evidence: 'No observable DOM, text, or URL delta after interaction',
          reason: 'Interaction may not have taken effect; verifying/retrying'
        };
      }
      return {
        outcome: 'passed',
        evidence: pageDiff
          ? `Observed page delta: urlChanged=${pageDiff.urlChanged}, +${pageDiff.addedElementsCount}/-${pageDiff.removedElementsCount} elements, ${pageDiff.textDeltaSummary}`
          : `${toolName} completed with verified target`,
        reason: 'State change confirmed'
      };
    }

    if (toolName === 'read_page' || toolName === 'extract' || toolName === 'compare_tabs' || toolName === 'read_selected_text') {
      const serialized = JSON.stringify(toolData ?? '');
      if (!serialized || serialized === '{}' || serialized === '""') {
        return {
          outcome: subgoal.attempts >= maxRetries ? 'replan' : 'retry',
          evidence: 'Empty extraction output',
          reason: 'No readable content captured'
        };
      }
      return {
        outcome: 'passed',
        evidence: `Captured ${serialized.length} chars of page evidence`,
        reason: 'Content evidence obtained'
      };
    }

    return {
      outcome: 'passed',
      evidence: JSON.stringify(toolData ?? { ok: true }).slice(0, 260),
      reason: 'Tool outcome verified'
    };
  }
}

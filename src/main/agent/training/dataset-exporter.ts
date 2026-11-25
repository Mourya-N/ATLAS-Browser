import type { AgentRun } from '@shared/types';
import { redactSecrets } from '@main/security/secrets';

export interface SftTrainingExample {
  id: string;
  taskCategory: 'search_grounding' | 'browser_automation';
  modelVersionTarget: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  verifiedOutcome: boolean;
  createdAt: number;
}

/**
 * Consent-gated training data exporter for future LoRA/QLoRA fine-tuning pipelines.
 * Never exports private browsing runs or unredacted secrets.
 */
export function exportConsentedTrainingExamples(params: {
  runs: AgentRun[];
  explicitUserConsent: boolean;
  modelVersionTarget?: string;
}): SftTrainingExample[] {
  if (!params.explicitUserConsent) {
    return [];
  }

  const target = params.modelVersionTarget || 'atlas-qwen2.5-7b-lora-v1';
  const examples: SftTrainingExample[] = [];

  for (const run of params.runs) {
    if (run.isPrivate) continue;
    if (run.status !== 'completed' || !run.finalAnswer) continue;

    const cleanGoal = redactSecrets(run.goal);
    const cleanAnswer = redactSecrets(run.finalAnswer);
    const stepTrace = run.steps
      .filter((s) => s.verificationOutcome === 'passed' || Boolean(s.evidence))
      .map((s) => `[${s.phase}] ${redactSecrets(s.summary)}`)
      .join('\n');

    examples.push({
      id: run.id,
      taskCategory: stepTrace.includes('execute') ? 'browser_automation' : 'search_grounding',
      modelVersionTarget: target,
      messages: [
        {
          role: 'system',
          content: 'You are Atlas AI, an evidence-grounded browser and search assistant.'
        },
        {
          role: 'user',
          content: `${cleanGoal}\n\nVerified Evidence:\n${stepTrace}`
        },
        {
          role: 'assistant',
          content: cleanAnswer
        }
      ],
      verifiedOutcome: true,
      createdAt: run.startedAt
    });
  }

  return examples;
}

export function serializeToJsonl(examples: SftTrainingExample[]): string {
  return examples.map((ex) => JSON.stringify(ex)).join('\n');
}

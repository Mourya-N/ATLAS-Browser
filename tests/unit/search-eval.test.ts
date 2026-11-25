import { describe, expect, it } from 'vitest';
import { runDeterministicSearchEvaluation } from '../../src/backend/eval/search-eval';

describe('Atlas Search Quantitative Evaluation Harness', () => {
  it('achieves >= 0.6 NDCG@5, 100% Recall@5, 100% Citation Accuracy, 100% Groundedness, and provider failure resilience', async () => {
    const metrics = await runDeterministicSearchEvaluation();
    console.log('[SEARCH_EVAL_METRICS]', JSON.stringify(metrics));

    expect(metrics.datasetSize).toBe(5);
    expect(metrics.avgRecallAt5).toBe(1);
    expect(metrics.avgNdcgAt5).toBeGreaterThanOrEqual(0.6);
    expect(metrics.avgCitationAccuracy).toBe(1);
    expect(metrics.avgGroundedness).toBe(1);
    expect(metrics.providerFailureResilienceRate).toBe(1);
    expect(metrics.passRate).toBe(1);
  });
});

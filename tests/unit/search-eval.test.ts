import { describe, expect, it } from 'vitest';
import { runDeterministicSearchEvaluation } from '../../src/backend/eval/search-eval';

describe('LAVRAY Search Quantitative Evaluation Harness', () => {
  it('evaluates 15 queries across 6 categories achieving high Recall@5, NDCG@5, 100% Citation Accuracy & provider resilience', async () => {
    const metrics = await runDeterministicSearchEvaluation();
    console.log('[SEARCH_EVAL_METRICS]', JSON.stringify(metrics));

    expect(metrics.datasetSize).toBe(15);
    expect(metrics.avgRecallAt5).toBeGreaterThanOrEqual(0.9);
    expect(metrics.avgNdcgAt5).toBeGreaterThanOrEqual(0.8);
    expect(metrics.avgCitationAccuracy).toBe(1);
    expect(metrics.avgGroundedness).toBe(1);
    expect(metrics.providerFailureResilienceRate).toBe(1);
    expect(metrics.passRate).toBe(1);
  });
});

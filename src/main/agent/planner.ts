import { randomUUID } from 'node:crypto';
import type { AgentMode, PagePerception, Subgoal } from '@shared/types';
import type { ModelProvider } from './providers/model-provider';
import type { CostTracker } from './cost-tracker';

export interface PlanOutput {
  planSummary: string;
  complexity: 'simple' | 'moderate' | 'complex';
  parallelSubtasks: string[];
  subgoals: Subgoal[];
}

export class AgentPlanner {
  constructor(
    private readonly getProvider: () => ModelProvider,
    private readonly costTracker: CostTracker
  ) {}

  public async plan(params: {
    runId: string;
    goal: string;
    mode: AgentMode;
    model: string;
    perception: PagePerception | null;
    openTabsSummary: string;
    isPrivate?: boolean;
    signal?: AbortSignal;
  }): Promise<PlanOutput> {
    const provider = this.getProvider();

    const schema = {
      type: 'object',
      properties: {
        planSummary: { type: 'string' },
        complexity: { type: 'string', enum: ['simple', 'moderate', 'complex'] },
        parallelSubtasks: { type: 'array', items: { type: 'string' } },
        subgoals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              expectedEvidence: { type: 'string' }
            },
            required: ['description', 'expectedEvidence']
          }
        }
      },
      required: ['planSummary', 'complexity', 'subgoals']
    };

    const pageContext = params.perception
      ? `Current tab URL: ${params.perception.url}\nTitle: ${params.perception.title}\nHeadings: ${params.perception.headings.slice(0, 6).join('; ')}`
      : 'No active page loaded yet.';

    const resp = await provider.generate({
      model: params.model,
      systemInstruction:
        'You are the Atlas Browser Planner. Decompose the user goal into concise, verifiable subgoals. Never include private chain-of-thought. If the task naturally splits into independent parallel research tasks across multiple sources or tabs, list them in parallelSubtasks; otherwise leave parallelSubtasks empty.',
      messages: [
        {
          role: 'user',
          parts: [
            {
              text: [
                `Mode: ${params.mode}`,
                `Goal: ${params.goal}`,
                pageContext,
                params.openTabsSummary ? `Open tabs:\n${params.openTabsSummary}` : ''
              ]
                .filter(Boolean)
                .join('\n\n')
            }
          ]
        }
      ],
      responseSchema: schema,
      temperature: 0.1,
      maxOutputTokens: 1024,
      signal: params.signal
    });

    this.costTracker.recordModelUsage({
      runId: params.runId,
      provider: provider.id,
      model: params.model,
      inputTokens: resp.usage.inputTokens,
      outputTokens: resp.usage.outputTokens,
      fromProvider: resp.usage.fromProvider,
      skipPersistence: params.isPrivate
    });

    try {
      const parsed = JSON.parse(resp.text) as {
        planSummary?: string;
        complexity?: 'simple' | 'moderate' | 'complex';
        parallelSubtasks?: string[];
        subgoals?: Array<{ description: string; expectedEvidence: string }>;
      };

      const rawSubgoals =
        Array.isArray(parsed.subgoals) && parsed.subgoals.length > 0
          ? parsed.subgoals
          : [{ description: params.goal, expectedEvidence: 'Goal answer or target state verified' }];

      return {
        planSummary: parsed.planSummary || `Execute: ${params.goal}`,
        complexity: parsed.complexity || 'simple',
        parallelSubtasks: Array.isArray(parsed.parallelSubtasks) ? parsed.parallelSubtasks : [],
        subgoals: rawSubgoals.slice(0, 8).map((sg, index) => ({
          id: randomUUID(),
          index,
          description: sg.description,
          expectedEvidence: sg.expectedEvidence,
          status: index === 0 ? 'in_progress' : 'pending',
          attempts: 0
        }))
      };
    } catch {
      return {
        planSummary: `Complete user goal: ${params.goal}`,
        complexity: 'simple',
        parallelSubtasks: [],
        subgoals: [
          {
            id: randomUUID(),
            index: 0,
            description: params.goal,
            expectedEvidence: 'Verified completion evidence from browser state',
            status: 'in_progress',
            attempts: 0
          }
        ]
      };
    }
  }
}

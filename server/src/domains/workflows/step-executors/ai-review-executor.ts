import type {
  AgentLoopRunnerPort,
  StepContext,
  StepExecutorPort,
  StepResult,
} from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';

const DEFAULT_REVIEW_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_REVIEW_MAX_TURNS = 8;

export class AIReviewStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['ai_review'] as const;

  constructor(private readonly agentLoopRunner: AgentLoopRunnerPort) {}

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    const llmProfileId = (config.llmProfileId as string) ?? ctx.llmProfileId;
    if (!llmProfileId) return { status: 'failed', output: {}, error: 'No provider configured' };

    const cwd = (config.worktreePath as string) ?? ctx.projectRootPath;
    if (!cwd) return { status: 'failed', output: {}, error: 'No working directory configured' };

    const result = await this.agentLoopRunner.run({
      owner: { type: 'workflow_run', id: ctx.runId },
      purpose: 'workflow.ai_review',
      llmProfileId,
      model: typeof config.model === 'string' ? config.model : undefined,
      cwd,
      systemPrompt: [
        'You are a code reviewer for a workflow step.',
        'Use read-only tools to inspect the repository and git diff.',
        'Return JSON only with reviewPassed, reviewNotes, and optional findings.',
      ].join('\n'),
      input: buildReviewInput(ctx),
      toolset: { id: 'code-review-readonly' },
      outputContract: {
        type: 'json',
        schema: {
          type: 'object',
          required: ['reviewPassed', 'reviewNotes'],
          additionalProperties: false,
          properties: {
            reviewPassed: { type: 'boolean' },
            reviewNotes: { type: 'string' },
            findings: {
              type: 'array',
              items: { type: 'object' },
            },
          },
        },
        repairAttempts: 1,
      },
      context: { policy: 'workflow-artifacts', key: node.id },
      limits: {
        maxTurns: typeof config.maxTurns === 'number' ? config.maxTurns : DEFAULT_REVIEW_MAX_TURNS,
        timeoutMs: node.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS,
      },
      permissionMode: 'allow-declared-tools',
    });

    if (result.status !== 'completed') {
      return {
        status: 'failed',
        output: {},
        error: result.error ?? `AI review failed: ${result.status}`,
      };
    }

    return {
      status: 'completed',
      output: {
        reviewPassed: result.output.reviewPassed === true,
        reviewNotes: String(result.output.reviewNotes ?? ''),
        findings: Array.isArray(result.output.findings) ? result.output.findings : [],
        contextId: result.contextId,
      },
    };
  }
}

function buildReviewInput(ctx: StepContext): string {
  const artifacts = [...ctx.results.entries()]
    .filter(([, result]) => result.status === 'completed')
    .map(([stepId, result]) => `${stepId}: ${JSON.stringify(result.output)}`);

  return [
    'Review the current working directory changes.',
    'Use git diff or read/search tools as needed.',
    artifacts.length ? `Workflow artifacts:\n${artifacts.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

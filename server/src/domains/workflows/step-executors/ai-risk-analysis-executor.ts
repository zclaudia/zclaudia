import type { AIReviewConfig } from '@zclaudia/shared/interaction/permissions';
import type {
  AgentLoopRunnerPort,
  StepContext,
  StepExecutorPort,
  StepResult,
} from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_MAX_AUTO_APPROVALS_PER_MINUTE = 10;
const DEFAULT_RISK_ANALYSIS_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_RISK_ANALYSIS_MAX_TURNS = 4;

export class AIRiskAnalysisStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['ai_risk_analysis'] as const;

  constructor(private readonly agentLoopRunner: AgentLoopRunnerPort) {}

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    const event = ctx.eventPayload;
    if (!event) {
      return { status: 'failed', output: {}, error: 'No event payload - ai_risk_analysis requires a permission.escalated trigger' };
    }

    const eventAIReview = asAIReviewConfig(event.aiReview);
    const enabled = typeof config.enabled === 'boolean'
      ? config.enabled
      : eventAIReview.enabled ?? true;
    if (!enabled) {
      return {
        status: 'completed',
        output: {
          decision: 'uncertain',
          reasoning: 'AI review is disabled by permission policy',
          confidence: 0,
          approved: false,
        },
      };
    }

    const cwd = stringConfig(config.cwd, event.cwd) ?? ctx.projectRootPath;
    if (!cwd) return { status: 'failed', output: {}, error: 'No working directory configured' };

    const llmProfileId = stringConfig(config.analysisLlmProfileId, eventAIReview.analysisLlmProfileId)
      ?? ctx.llmProfileId;
    if (!llmProfileId) return { status: 'failed', output: {}, error: 'No provider configured' };

    const requestId = typeof event.requestId === 'string' && event.requestId
      ? event.requestId
      : ctx.stepRunId;
    const confidenceThreshold = numberConfig(
      config.confidenceThreshold,
      eventAIReview.confidenceThreshold,
      DEFAULT_CONFIDENCE_THRESHOLD,
    );
    const maxAutoApprovalsPerMinute = numberConfig(
      config.maxAutoApprovalsPerMinute,
      eventAIReview.maxAutoApprovalsPerMinute,
      DEFAULT_MAX_AUTO_APPROVALS_PER_MINUTE,
    );

    const result = await this.agentLoopRunner.run({
      owner: { type: 'workflow_run', id: ctx.runId },
      purpose: 'workflow.ai_risk_analysis',
      llmProfileId,
      model: typeof config.model === 'string' ? config.model : undefined,
      cwd,
      systemPrompt: [
        'You are reviewing an escalated tool permission request.',
        'Use read-only tools only when needed to assess safety.',
        'Return JSON only with decision, reasoning, confidence, and optional metadata.',
      ].join('\n'),
      input: JSON.stringify({
        toolName: templateStringConfig(ctx, config.toolName, event.toolName) ?? 'unknown',
        toolInput: event.toolInput ?? {},
        detail: templateStringConfig(ctx, config.detail, event.detail) ?? '',
        cwd,
        confidenceThreshold,
        maxAutoApprovalsPerMinute,
      }),
      toolset: { id: 'permission-review' },
      outputContract: {
        type: 'json',
        schema: {
          type: 'object',
          required: ['decision', 'reasoning', 'confidence'],
          additionalProperties: false,
          properties: {
            decision: { enum: ['approve', 'deny', 'uncertain'] },
            reasoning: { type: 'string' },
            confidence: { type: 'number' },
            metadata: { type: 'object' },
          },
        },
        repairAttempts: 1,
      },
      context: { policy: 'step-local', key: `permission:${requestId}:${node.id}` },
      limits: {
        maxTurns: typeof config.maxTurns === 'number' ? config.maxTurns : DEFAULT_RISK_ANALYSIS_MAX_TURNS,
        timeoutMs: node.timeoutMs ?? DEFAULT_RISK_ANALYSIS_TIMEOUT_MS,
      },
      permissionMode: 'allow-declared-tools',
    });

    if (result.status !== 'completed') {
      const reasoning = result.error ?? `AI risk analysis failed: ${result.status}`;
      return {
        status: 'failed',
        output: {
          decision: 'uncertain',
          reasoning,
          confidence: 0,
          approved: false,
        },
        error: reasoning,
      };
    }

    const rawDecision = result.output.decision === 'approve' || result.output.decision === 'deny'
      ? result.output.decision
      : 'uncertain';
    const confidence = typeof result.output.confidence === 'number' ? result.output.confidence : 0;
    const rawReasoning = String(result.output.reasoning ?? '');
    const belowThreshold = confidence < confidenceThreshold;
    const decision = belowThreshold ? 'uncertain' : rawDecision;
    const reasoning = belowThreshold
      ? `LLM confidence ${(confidence * 100).toFixed(0)}% below threshold ${(confidenceThreshold * 100).toFixed(0)}%: ${rawReasoning}`
      : rawReasoning;
    const metadata = result.output.metadata && typeof result.output.metadata === 'object'
      ? result.output.metadata
      : undefined;

    return {
      status: 'completed',
      output: {
        decision,
        reasoning,
        confidence,
        ...(metadata ? { metadata } : {}),
        approved: decision === 'approve',
        contextId: result.contextId,
      },
    };
  }
}

function asAIReviewConfig(value: unknown): Partial<AIReviewConfig> {
  return value && typeof value === 'object' ? value as Partial<AIReviewConfig> : {};
}

function numberConfig(primary: unknown, fallback: unknown, defaultValue: number): number {
  if (typeof primary === 'number' && Number.isFinite(primary)) return primary;
  if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback;
  return defaultValue;
}

function stringConfig(primary: unknown, fallback: unknown): string | undefined {
  if (typeof primary === 'string' && primary.trim()) return primary;
  if (typeof fallback === 'string' && fallback.trim()) return fallback;
  return undefined;
}

function templateStringConfig(ctx: StepContext, primary: unknown, fallback: unknown): string | undefined {
  if (typeof primary === 'string' && primary.trim()) return ctx.resolveTemplate(primary);
  if (typeof fallback === 'string' && fallback.trim()) return fallback;
  return undefined;
}

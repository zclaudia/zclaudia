import type {
  StepExecutorPort,
  StepResult,
  StepContext,
  AgentLoopRunnerPort,
} from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';
import type { ActivityRegistry, ActivityServices } from '../../activities/index.js';

/**
 * Bridges the Activity layer to the workflow engine: resolves templates + injects
 * the small set of well-known context fields, then dispatches to the registry.
 * Composition stays in the workflow layer — this adapter never chains activities.
 */
export class ActivityStepExecutorAdapter implements StepExecutorPort {
  get supportedTypes(): readonly string[] {
    return this.registry.types();
  }

  constructor(
    private readonly registry: ActivityRegistry,
    private readonly agentLoopRunner: AgentLoopRunnerPort
  ) {}

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext
  ): Promise<StepResult> {
    const input: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      input[key] = typeof value === 'string' ? ctx.resolveTemplate(value) : value;
    }
    // These always come from context, not config — any config keys of the same name are intentionally overwritten.
    input.projectRootPath = ctx.projectRootPath;
    input.projectId = ctx.projectId;

    const services: ActivityServices = {
      agentLoopRunner: this.agentLoopRunner,
      ...(ctx.llmProfileId ? { llmProfileId: ctx.llmProfileId } : {}),
    };

    const result = await this.registry.invoke(node.type, input, services);
    if (result.status === 'completed') {
      return { status: 'completed', output: result.output };
    }
    return { status: 'failed', output: {}, error: result.error ?? 'Activity failed' };
  }
}

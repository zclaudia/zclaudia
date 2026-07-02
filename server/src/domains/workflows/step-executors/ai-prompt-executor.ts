import type {
  StepExecutorPort,
  StepResult,
  StepContext,
  AgentLoopRunnerPort,
  WorkflowAgentRuntimePort,
} from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';
import { getAgentLoopToolsetDescriptor } from '../../../infra/providers/pi-runtime/agent-loop/index.js';

const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TOOLSET_ID = 'workflow-prompt';

export class AIPromptStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['ai_prompt'] as const;

  constructor(
    private readonly agentLoopRunner: AgentLoopRunnerPort,
    private readonly agentRuntime: WorkflowAgentRuntimePort
  ) {}

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext
  ): Promise<StepResult> {
    const prompt = config.prompt as string;
    if (!prompt) return { status: 'failed', output: {}, error: 'No prompt specified' };

    const llmProfileId = (config.llmProfileId as string) ?? ctx.llmProfileId;
    if (!llmProfileId) return { status: 'failed', output: {}, error: 'No provider configured' };

    const cwd = (config.workingDirectory as string) ?? ctx.projectRootPath ?? process.cwd();

    const toolsetId = typeof config.toolset === 'string' ? config.toolset : DEFAULT_TOOLSET_ID;
    const toolsetDescriptor = getAgentLoopToolsetDescriptor(toolsetId);
    if (!toolsetDescriptor)
      return { status: 'failed', output: {}, error: `Unknown agent-loop toolset: ${toolsetId}` };

    const maxTurns = typeof config.maxTurns === 'number' ? config.maxTurns : undefined;

    try {
      const runtime = await this.agentRuntime.resolve({
        purpose: 'workflow.ai_prompt',
        runId: ctx.runId,
        projectId: ctx.projectId,
        projectRootPath: ctx.projectRootPath,
        cwd,
        llmProfileId,
        model: typeof config.model === 'string' ? config.model : undefined,
        baseSystemPrompt: typeof config.systemPrompt === 'string' ? config.systemPrompt : undefined,
        systemContext:
          'You are executing a workflow AI prompt. Return JSON that satisfies the requested contract.',
      });
      const permissions = buildRuntimePermissions(runtime);
      const result = await this.agentLoopRunner.run({
        owner: { type: 'workflow_run', id: ctx.runId },
        purpose: 'workflow.ai_prompt',
        llmProfileId: runtime.llmProfileId,
        model: runtime.model,
        cwd,
        systemPrompt: runtime.systemPrompt,
        input: buildWorkflowPromptInput(prompt, ctx),
        toolset: { id: toolsetId },
        ...(permissions ? { permissions } : {}),
        outputContract: {
          type: 'json',
          schema: {
            type: 'object',
            required: ['result'],
            additionalProperties: false,
            properties: {
              result: { type: 'string' },
            },
          },
          repairAttempts: 1,
        },
        context: { policy: 'workflow-artifacts', key: node.id },
        limits: {
          timeoutMs: node.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
          ...(maxTurns !== undefined ? { maxTurns } : {}),
        },
        permissionMode: toolsetDescriptor.permissionMode,
      });

      if (result.status !== 'completed') {
        return {
          status: 'failed',
          output: {},
          error: result.error ?? `AI prompt failed: ${result.status}`,
        };
      }

      return {
        status: 'completed',
        output: {
          result: String(result.output.result ?? ''),
          contextId: result.contextId,
        },
      };
    } catch (err) {
      return {
        status: 'failed',
        output: {},
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function buildRuntimePermissions(
  runtime: Awaited<ReturnType<WorkflowAgentRuntimePort['resolve']>>
) {
  const userHooks = runtime.userHooks?.length ? runtime.userHooks : undefined;
  if (!userHooks && !runtime.permissionCallback && !runtime.toolSessionId) return undefined;
  return {
    ...(userHooks ? { userHooks } : {}),
    ...(runtime.permissionCallback ? { permissionCallback: runtime.permissionCallback } : {}),
    ...(runtime.toolSessionId ? { toolSessionId: runtime.toolSessionId } : {}),
  };
}

function buildWorkflowPromptInput(prompt: string, ctx: StepContext): string {
  const artifacts = [...ctx.results.entries()]
    .filter(([, result]) => result.status === 'completed')
    .map(([stepId, result]) => `${stepId}: ${JSON.stringify(result.output)}`);

  if (artifacts.length === 0) {
    return prompt;
  }

  return `# Workflow Artifacts\n${artifacts.join('\n')}\n\n# Prompt\n${prompt}`;
}

import { describe, expect, it, vi } from 'vitest';
import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';
import type { AgentLoopRunnerPort } from '../../agent-loop/index.js';
import type { StepContext } from '../ports/step-executor.js';
import { AIPromptStepExecutor } from '../step-executors/ai-prompt-executor.js';

function makeNode(overrides: Partial<WorkflowNodeDef> = {}): WorkflowNodeDef {
  return {
    id: 'prompt',
    name: 'Prompt',
    type: 'ai_prompt',
    config: {},
    position: { x: 0, y: 0 },
    timeoutMs: 1234,
    ...overrides,
  };
}

function makeContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    runId: 'run-1',
    stepRunId: 'step-run-1',
    projectId: 'project-1',
    projectRootPath: '/repo',
    llmProfileId: 'llm-1',
    results: new Map([
      ['lint', { status: 'completed', output: { stdout: 'lint ok' } }],
    ]),
    resolveTemplate: vi.fn((value: string) => `resolved:${value}`),
    setSessionId: vi.fn(),
    ...overrides,
  };
}

describe('workflow agent-loop AI executors', () => {
  it('runs ai_prompt through AgentLoopRunnerPort with workflow artifacts context', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: { result: 'analysis complete' },
      contextId: 'ctx-1',
    }));
    const executor = new AIPromptStepExecutor({ run } as unknown as AgentLoopRunnerPort);
    const ctx = makeContext();

    const result = await executor.execute(
      makeNode(),
      { prompt: 'Analyze ${lint.output.stdout}' },
      ctx,
    );

    expect(result).toEqual({
      status: 'completed',
      output: { result: 'analysis complete', contextId: 'ctx-1' },
    });
    expect(run).toHaveBeenCalledWith({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      model: undefined,
      cwd: '/repo',
      systemPrompt: expect.any(String),
      input: expect.stringContaining('Analyze ${lint.output.stdout}'),
      toolset: { id: 'workflow-prompt-readonly' },
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
      context: { policy: 'workflow-artifacts', key: 'prompt' },
      limits: { maxTurns: 6, timeoutMs: 1234 },
      permissionMode: 'allow-declared-tools',
    });
    expect(run.mock.calls[0]?.[0].input).toContain('lint ok');
    expect(run.mock.calls[0]?.[0].input).toContain('Analyze ${lint.output.stdout}');
    expect(ctx.resolveTemplate).not.toHaveBeenCalled();
    expect(ctx.setSessionId).not.toHaveBeenCalled();
  });

  it('fails the step when the agent loop does not complete', async () => {
    const run = vi.fn(async () => ({
      status: 'contract_failed' as const,
      output: {},
      error: 'schema mismatch',
      contextId: 'ctx-2',
    }));
    const executor = new AIPromptStepExecutor({ run } as unknown as AgentLoopRunnerPort);
    const ctx = makeContext();

    const result = await executor.execute(
      makeNode(),
      { prompt: 'Analyze repo' },
      ctx,
    );

    expect(result).toEqual({
      status: 'failed',
      output: {},
      error: 'schema mismatch',
    });
    expect(ctx.setSessionId).not.toHaveBeenCalled();
  });

  it('uses deny-external permission mode when toolset is none', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: { result: 'no tools used' },
      contextId: 'ctx-3',
    }));
    const executor = new AIPromptStepExecutor({ run } as unknown as AgentLoopRunnerPort);

    await executor.execute(
      makeNode({ id: 'prompt-none', timeoutMs: 4321 }),
      { prompt: 'Answer from memory', toolset: 'none' },
      makeContext(),
    );

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      toolset: { id: 'none' },
      limits: { maxTurns: 6, timeoutMs: 4321 },
      permissionMode: 'deny-external',
      context: { policy: 'workflow-artifacts', key: 'prompt-none' },
    }));
  });
});

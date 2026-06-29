import { describe, expect, it, vi } from 'vitest';
import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';
import type { AgentLoopRunnerPort } from '../../agent-loop/index.js';
import type { StepContext, WorkflowAgentRuntimePort } from '../ports/step-executor.js';
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

function makeRuntimeResolver(
  overrides: Partial<Awaited<ReturnType<WorkflowAgentRuntimePort['resolve']>>> = {},
): WorkflowAgentRuntimePort {
  return {
    resolve: vi.fn(async () => ({
      llmProfileId: 'runtime-llm',
      model: 'runtime-model',
      systemPrompt: 'runtime system prompt',
      ...overrides,
    })),
  };
}

describe('workflow agent-loop AI executors', () => {
  it('runs ai_prompt through AgentLoopRunnerPort with workflow artifacts context', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: { result: 'analysis complete' },
      contextId: 'ctx-1',
    }));
    const runtimeResolver = makeRuntimeResolver();
    const executor = new AIPromptStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
      runtimeResolver,
    );
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
      llmProfileId: 'runtime-llm',
      model: 'runtime-model',
      cwd: '/repo',
      systemPrompt: 'runtime system prompt',
      input: expect.stringContaining('Analyze ${lint.output.stdout}'),
      toolset: { id: 'workflow-prompt' },
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
      limits: { timeoutMs: 1234 },
      permissionMode: 'allow-declared-tools',
    });
    expect(run.mock.calls[0]?.[0].input).toContain('lint ok');
    expect(run.mock.calls[0]?.[0].input).toContain('Analyze ${lint.output.stdout}');
    expect(runtimeResolver.resolve).toHaveBeenCalledWith({
      purpose: 'workflow.ai_prompt',
      runId: 'run-1',
      projectId: 'project-1',
      projectRootPath: '/repo',
      cwd: '/repo',
      llmProfileId: 'llm-1',
      model: undefined,
      baseSystemPrompt: undefined,
      systemContext: 'You are executing a workflow AI prompt. Return JSON that satisfies the requested contract.',
    });
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
    const executor = new AIPromptStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
      makeRuntimeResolver(),
    );
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
    const executor = new AIPromptStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
      makeRuntimeResolver(),
    );

    await executor.execute(
      makeNode({ id: 'prompt-none', timeoutMs: 4321 }),
      { prompt: 'Answer from memory', toolset: 'none' },
      makeContext(),
    );

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      toolset: { id: 'none' },
      limits: { timeoutMs: 4321 },
      permissionMode: 'deny-external',
      context: { policy: 'workflow-artifacts', key: 'prompt-none' },
    }));
  });

  it('falls back to process cwd when the workflow has no project root', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: { result: 'done' },
      contextId: 'ctx-cwd',
    }));
    const executor = new AIPromptStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
      makeRuntimeResolver(),
    );

    await executor.execute(
      makeNode({ id: 'prompt-cwd' }),
      { prompt: 'Run from current cwd' },
      makeContext({ projectRootPath: undefined }),
    );

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: process.cwd(),
    }));
  });

  it('allows workflow prompts to opt into the readonly toolset', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: { result: 'readonly complete' },
      contextId: 'ctx-4',
    }));
    const executor = new AIPromptStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
      makeRuntimeResolver(),
    );

    await executor.execute(
      makeNode({ id: 'prompt-readonly' }),
      { prompt: 'Summarize repo', toolset: 'workflow-prompt-readonly' },
      makeContext(),
    );

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      toolset: { id: 'workflow-prompt-readonly' },
      permissionMode: 'allow-declared-tools',
      context: { policy: 'workflow-artifacts', key: 'prompt-readonly' },
    }));
  });

  it('passes explicit maxTurns and runtime permission hooks to the agent loop', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: { result: 'done' },
      contextId: 'ctx-5',
    }));
    const permissionCallback = vi.fn(async () => ({ behavior: 'allow' as const }));
    const executor = new AIPromptStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
      makeRuntimeResolver({
        userHooks: [{ event: 'PreToolUse', command: 'echo ok' }],
        permissionCallback,
      }),
    );

    await executor.execute(
      makeNode({ id: 'prompt-permissions', timeoutMs: 9999 }),
      { prompt: 'Fix it', maxTurns: 12 },
      makeContext(),
    );

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      limits: { maxTurns: 12, timeoutMs: 9999 },
      permissions: {
        userHooks: [{ event: 'PreToolUse', command: 'echo ok' }],
        permissionCallback,
      },
    }));
  });
});

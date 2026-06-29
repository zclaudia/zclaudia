import { describe, expect, it, vi } from 'vitest';
import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';
import type { AgentLoopRunnerPort } from '../../agent-loop/index.js';
import type { StepContext, WorkflowAgentRuntimePort } from '../ports/step-executor.js';
import { AIPromptStepExecutor } from '../step-executors/ai-prompt-executor.js';
import { AIReviewStepExecutor } from '../step-executors/ai-review-executor.js';
import { AIRiskAnalysisStepExecutor } from '../step-executors/ai-risk-analysis-executor.js';

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
        toolSessionId: 'run-1',
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
        toolSessionId: 'run-1',
      },
    }));
  });

  it('runs ai_review through AgentLoopRunnerPort and returns structured review output', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: {
        reviewPassed: true,
        reviewNotes: 'looks good',
        findings: [],
      },
      contextId: 'ctx-review',
    }));
    const executor = new AIReviewStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
    );
    const ctx = makeContext();

    const result = await executor.execute(
      makeNode({ id: 'review', name: 'Review', type: 'ai_review', timeoutMs: 2222 }),
      {},
      ctx,
    );

    expect(result).toEqual({
      status: 'completed',
      output: {
        reviewPassed: true,
        reviewNotes: 'looks good',
        findings: [],
        contextId: 'ctx-review',
      },
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_review',
      llmProfileId: 'llm-1',
      cwd: '/repo',
      toolset: { id: 'code-review-readonly' },
      context: { policy: 'workflow-artifacts', key: 'review' },
      limits: { maxTurns: 8, timeoutMs: 2222 },
      permissionMode: 'allow-declared-tools',
      outputContract: expect.objectContaining({
        type: 'json',
        schema: expect.objectContaining({
          required: ['reviewPassed', 'reviewNotes'],
        }),
      }),
    }));
    expect(run.mock.calls[0]?.[0].input).toContain('lint ok');
    expect(ctx.setSessionId).not.toHaveBeenCalled();
  });

  it('ai_risk_analysis uses permission policy AI review settings and step-local context', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: {
        decision: 'approve',
        reasoning: 'safe command',
        confidence: 0.95,
        metadata: { rule: 'test' },
      },
      contextId: 'ctx-risk',
    }));
    const executor = new AIRiskAnalysisStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
    );

    const result = await executor.execute(
      makeNode({ id: 'ai_review', name: 'AI Review', type: 'ai_risk_analysis', timeoutMs: 120000 }),
      {},
      makeContext({
        eventPayload: {
          requestId: 'req-1',
          toolName: 'Bash',
          toolInput: { command: 'npm test' },
          detail: 'npm test',
          cwd: '/repo',
          aiReview: {
            enabled: true,
            confidenceThreshold: 0.92,
            maxAutoApprovalsPerMinute: 3,
            analysisLlmProfileId: 'review-llm',
          },
        },
      }),
    );

    expect(result).toMatchObject({
      status: 'completed',
      output: {
        decision: 'approve',
        reasoning: 'safe command',
        confidence: 0.95,
        approved: true,
        metadata: { rule: 'test' },
        contextId: 'ctx-risk',
      },
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'workflow.ai_risk_analysis',
      llmProfileId: 'review-llm',
      cwd: '/repo',
      toolset: { id: 'permission-review' },
      context: { policy: 'step-local', key: 'permission:req-1:ai_review' },
      limits: { maxTurns: 4, timeoutMs: 120000 },
      permissionMode: 'allow-declared-tools',
    }));
    expect(run.mock.calls[0]?.[0].input).toContain('"confidenceThreshold":0.92');
  });

  it('ai_risk_analysis returns uncertain without model call when AI review is disabled', async () => {
    const run = vi.fn();
    const executor = new AIRiskAnalysisStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
    );

    const result = await executor.execute(
      makeNode({ id: 'ai_review', name: 'AI Review', type: 'ai_risk_analysis' }),
      {},
      makeContext({
        eventPayload: {
          requestId: 'req-disabled',
          toolName: 'Bash',
          toolInput: { command: 'rm -rf build' },
          detail: 'rm -rf build',
          cwd: '/repo',
          aiReview: { enabled: false },
        },
      }),
    );

    expect(result).toMatchObject({
      status: 'completed',
      output: {
        decision: 'uncertain',
        confidence: 0,
        approved: false,
      },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('ai_risk_analysis resolves configured toolName and detail templates', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: {
        decision: 'uncertain',
        reasoning: 'needs user',
        confidence: 0.2,
      },
      contextId: 'ctx-risk-template',
    }));
    const executor = new AIRiskAnalysisStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
    );

    await executor.execute(
      makeNode({ id: 'ai_review', type: 'ai_risk_analysis' }),
      { toolName: '${event.toolName}', detail: '${event.detail}' },
      makeContext({
        eventPayload: {
          requestId: 'req-template',
          toolName: 'Bash',
          toolInput: { command: 'npm test' },
          detail: 'npm test',
          cwd: '/repo',
        },
      }),
    );

    expect(run.mock.calls[0]?.[0].input).toContain('"toolName":"resolved:${event.toolName}"');
    expect(run.mock.calls[0]?.[0].input).toContain('"detail":"resolved:${event.detail}"');
  });

  it('ai_risk_analysis does not approve below the configured confidence threshold', async () => {
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: {
        decision: 'approve',
        reasoning: 'probably safe',
        confidence: 0.4,
      },
    }));
    const executor = new AIRiskAnalysisStepExecutor(
      { run } as unknown as AgentLoopRunnerPort,
    );

    const result = await executor.execute(
      makeNode({ id: 'ai_review', type: 'ai_risk_analysis' }),
      {},
      makeContext({
        eventPayload: {
          requestId: 'req-low-confidence',
          toolName: 'Bash',
          toolInput: { command: 'npm publish' },
          detail: 'npm publish',
          cwd: '/repo',
          aiReview: { enabled: true, confidenceThreshold: 0.9 },
        },
      }),
    );

    expect(result).toMatchObject({
      status: 'completed',
      output: {
        decision: 'uncertain',
        confidence: 0.4,
        approved: false,
      },
    });
    expect(String(result.output.reasoning)).toContain('below threshold');
  });
});

import { describe, it, expect } from 'vitest';
import { ActivityStepExecutorAdapter } from '../step-executors/activity-adapter.js';
import { ActivityRegistry } from '../../activities/index.js';
import type { Activity } from '../../activities/index.js';
import type { StepContext } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';

const runner = { run: async () => ({ status: 'completed' as const, output: {} }) };

function ctx(): StepContext {
  return {
    runId: 'r1',
    stepRunId: 's1',
    projectId: 'p1',
    projectRootPath: '/repo',
    llmProfileId: 'llm1',
    results: new Map(),
    resolveTemplate: (t: string) => t.replace('{{x}}', 'X'),
    setSessionId: () => {},
  };
}

describe('ActivityStepExecutorAdapter', () => {
  it('exposes the registry types as supportedTypes', () => {
    const registry = new ActivityRegistry();
    registry.register({ type: 'echo', invoke: async (i) => ({ status: 'completed', output: { i } }) } as Activity);
    const adapter = new ActivityStepExecutorAdapter(registry, runner);
    expect(adapter.supportedTypes).toEqual(['echo']);
  });

  it('resolves templated config, injects context, and maps completed result', async () => {
    const registry = new ActivityRegistry();
    registry.register({ type: 'echo', invoke: async (input) => ({ status: 'completed', output: { input } }) } as Activity);
    const adapter = new ActivityStepExecutorAdapter(registry, runner);
    const res = await adapter.execute(
      { type: 'echo' } as WorkflowNodeDef,
      { msg: '{{x}}', n: 2 },
      ctx(),
    );
    expect(res.status).toBe('completed');
    const input = (res.output as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ msg: 'X', n: 2, projectRootPath: '/repo', projectId: 'p1' });
  });

  it('maps a failed activity result to a failed step result', async () => {
    const registry = new ActivityRegistry();
    registry.register({ type: 'bad', invoke: async () => ({ status: 'failed', output: {}, error: 'boom' }) } as Activity);
    const adapter = new ActivityStepExecutorAdapter(registry, runner);
    const res = await adapter.execute({ type: 'bad' } as WorkflowNodeDef, {}, ctx());
    expect(res).toEqual({ status: 'failed', output: {}, error: 'boom' });
  });
});

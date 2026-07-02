import { describe, expect, it, vi } from 'vitest';

import { AgentTaskExecutor } from '../executors/agent-executor.js';
import type { TaskRecord } from '@zclaudia/shared/core/task';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'canonical-task-1',
    type: 'agent',
    status: 'queued',
    title: 'Run agent',
    metadata: {
      prompt: 'Investigate workflow',
      projectId: 'project-1',
      permissionOverride: {
        profile: {
          fileWrite: 'ask',
        },
      },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('AgentTaskExecutor', () => {
  it('starts an agent task directly through AgentTaskRunner and returns the canonical executor ref', async () => {
    const runner = {
      run: vi.fn(),
    };
    const executor = new AgentTaskExecutor(runner as never);

    const update = await executor.start(makeTask());

    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'canonical-task-1',
        task: 'Investigate workflow',
        projectId: 'project-1',
        contextTemplate: 'agent',
        permissionOverride: {
          profile: {
            fileWrite: 'ask',
          },
        },
      }),
      expect.objectContaining({
        onStarted: expect.any(Function),
        onDelta: expect.any(Function),
        onCompleted: expect.any(Function),
        onFailed: expect.any(Function),
      })
    );
    expect(update).toEqual({
      status: 'running',
      executorRef: {
        providerType: 'zclaudia-agent-runner',
        taskId: 'canonical-task-1',
      },
    });
  });

  it('waits for the direct runner result and maps it to a canonical task result', async () => {
    const runner = {
      run: vi.fn((_task, callbacks) => {
        queueMicrotask(() =>
          callbacks.onCompleted({
            resultSummary: 'Agent completed',
            responseText: 'Full agent response',
            toolCount: 2,
          })
        );
      }),
    };
    const executor = new AgentTaskExecutor(runner as never);

    await executor.start(makeTask());
    const update = await executor.wait('canonical-task-1', { timeoutMs: 1234 });

    expect(update).toEqual({
      status: 'completed',
      result: { text: 'Full agent response' },
    });
  });
});

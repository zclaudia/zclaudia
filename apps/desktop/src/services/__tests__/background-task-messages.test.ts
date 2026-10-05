import { describe, it, expect, beforeEach } from 'vitest';
import { handleBackgroundTaskMessage } from '../message-handlers/background-task-messages';
import { useBackgroundTaskStore } from '../../stores/backgroundTaskStore';
import { useRunStore } from '../../stores/runStore';
import type { MessageDispatchContext } from '../message-handlers/types';

const makeCtx = (): MessageDispatchContext =>
  ({
    serverId: 'server-1',
    isStaleRunEvent: () => false,
  }) as unknown as MessageDispatchContext;

const seedTaskToolCall = (runId: string, toolUseId: string, toolInput: unknown) => {
  useRunStore.setState(state => ({
    toolCallsHistory: {
      ...state.toolCallsHistory,
      [runId]: [
        {
          id: toolUseId,
          toolName: 'Task',
          toolInput,
          status: 'running',
        },
      ],
    },
  }));
};

describe('handleBackgroundTaskMessage — subagent enrichment', () => {
  beforeEach(() => {
    useBackgroundTaskStore.setState({ tasks: {} });
    useRunStore.setState({ toolCallsHistory: {}, activeToolCalls: {} });
  });

  it('marks task_progress as a subagent when the toolUseId resolves to a Task call', () => {
    seedTaskToolCall('run-1', 'toolu-1', { subagent_type: 'coder', description: 'fix auth' });

    handleBackgroundTaskMessage(
      {
        type: 'task_progress',
        runId: 'run-1',
        sessionId: 's1',
        taskId: 'task-1',
        toolUseId: 'toolu-1',
        description: 'fix auth',
        usage: { total_tokens: 12000, tool_uses: 3, duration_ms: 5000 },
        lastToolName: 'Edit',
      } as any,
      makeCtx()
    );

    const task = useBackgroundTaskStore.getState().tasks['task-1'];
    expect(task.kind).toBe('subagent');
    expect(task.agentType).toBe('coder');
    expect(task.activity).toBe('Edit');
    expect(task.usage?.total_tokens).toBe(12000);
  });

  it('leaves kind unset when the toolUseId resolves to a non-Task call', () => {
    useRunStore.setState(state => ({
      toolCallsHistory: {
        ...state.toolCallsHistory,
        'run-1': [{ id: 'toolu-9', toolName: 'Bash', toolInput: {}, status: 'running' }],
      },
    }));

    handleBackgroundTaskMessage(
      {
        type: 'task_progress',
        runId: 'run-1',
        sessionId: 's1',
        taskId: 'task-9',
        toolUseId: 'toolu-9',
        description: 'npm test',
        usage: { total_tokens: 0, tool_uses: 0, duration_ms: 0 },
      } as any,
      makeCtx()
    );

    const task = useBackgroundTaskStore.getState().tasks['task-9'];
    expect(task.kind).toBeUndefined();
  });

  it('finds the tool call among active tool calls too', () => {
    useRunStore.setState(state => ({
      activeToolCalls: {
        ...state.activeToolCalls,
        'run-1': {
          'toolu-2': { id: 'toolu-2', toolName: 'Task', toolInput: { subagent_type: 'explore' }, status: 'running' },
        },
      },
    }));

    handleBackgroundTaskMessage(
      {
        type: 'task_progress',
        runId: 'run-1',
        sessionId: 's1',
        taskId: 'task-2',
        toolUseId: 'toolu-2',
        description: 'survey middleware',
        usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 },
      } as any,
      makeCtx()
    );

    expect(useBackgroundTaskStore.getState().tasks['task-2'].agentType).toBe('explore');
  });

  it('enriches task_status_notification and preserves agentType across updates', () => {
    seedTaskToolCall('run-1', 'toolu-1', { subagent_type: 'plan' });

    const ctx = makeCtx();
    handleBackgroundTaskMessage(
      {
        type: 'task_progress',
        runId: 'run-1',
        sessionId: 's1',
        taskId: 'task-1',
        toolUseId: 'toolu-1',
        description: 'draft plan',
        usage: { total_tokens: 10, tool_uses: 1, duration_ms: 100 },
      } as any,
      ctx
    );
    handleBackgroundTaskMessage(
      {
        type: 'task_status_notification',
        runId: 'run-1',
        sessionId: 's1',
        taskId: 'task-1',
        toolUseId: 'toolu-1',
        status: 'completed',
        outputFile: '/tmp/out.md',
        summary: 'plan drafted',
      } as any,
      ctx
    );

    const task = useBackgroundTaskStore.getState().tasks['task-1'];
    expect(task.kind).toBe('subagent');
    expect(task.agentType).toBe('plan');
    expect(task.status).toBe('completed');
    expect(task.outputFile).toBe('/tmp/out.md');
  });

  it('tolerates an empty run store (no tool calls registered)', () => {
    handleBackgroundTaskMessage(
      {
        type: 'task_progress',
        runId: 'run-x',
        sessionId: 's1',
        taskId: 'task-x',
        toolUseId: 'toolu-x',
        description: 'unknown',
        usage: { total_tokens: 0, tool_uses: 0, duration_ms: 0 },
      } as any,
      makeCtx()
    );

    expect(useBackgroundTaskStore.getState().tasks['task-x'].kind).toBeUndefined();
  });
});

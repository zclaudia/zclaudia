import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhaseEmitter } from '../active-run-phase.js';

const findProcessPidsByTaskCommandMock = vi.fn();

vi.mock('../run-lifecycle.js', () => ({
  findProcessPidsByTaskCommand: findProcessPidsByTaskCommandMock,
}));

function buildRun(overrides: Record<string, unknown> = {}): any {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    providerType: 'zclaudia',
    providerSessionId: 'sdk-1',
    pendingPermissions: new Map(),
    pendingBackgroundTasks: 0,
    phase: 'running',
    phaseEmitter: new PhaseEmitter(),
    ...overrides,
  };
}

describe('background task coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('deduplicates tool_result background text and matching SDK task notification', async () => {
    const activeRun = buildRun();
    const state: any = {};
    const sendRunEvent = vi.fn();
    const { handleTaskNotification, trackBackgroundTaskFromToolResult } =
      await import('../background-task-coordinator.js');

    trackBackgroundTaskFromToolResult({
      activeRun,
      state,
      toolName: 'Bash',
      toolUseId: 'bash-1',
      result: 'Command running in background with ID: task-1. Output is being written to: /tmp/out',
      isError: false,
    });

    handleTaskNotification({
      activeRun,
      msg: {
        type: 'task_notification',
        taskId: 'task-1',
        taskStatus: 'started',
        taskMessage: 'started',
      } as any,
      providerRegistry: { get: vi.fn(() => undefined) } as any,
      runId: 'run-1',
      sendRunEvent,
      state,
    });

    expect(activeRun.pendingBackgroundTasks).toBe(1);
    expect(activeRun.phase).toBe('awaiting_followup');
    expect(state.backgroundTaskKeys.has('task:task-1')).toBe(true);
    expect(sendRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task_notification',
        taskId: 'task-1',
        status: 'started',
      })
    );
  });

  it('finishes tracked background tasks and recomputes phase', async () => {
    const activeRun = buildRun();
    const state: any = {};
    const { handleTaskNotification } = await import('../background-task-coordinator.js');

    handleTaskNotification({
      activeRun,
      msg: { type: 'task_notification', taskId: 'task-1', taskStatus: 'started' } as any,
      providerRegistry: { get: vi.fn(() => undefined) } as any,
      runId: 'run-1',
      sendRunEvent: vi.fn(),
      state,
    });
    handleTaskNotification({
      activeRun,
      msg: { type: 'task_notification', taskId: 'task-1', taskStatus: 'completed' } as any,
      providerRegistry: { get: vi.fn(() => undefined) } as any,
      runId: 'run-1',
      sendRunEvent: vi.fn(),
      state,
    });

    expect(activeRun.pendingBackgroundTasks).toBe(0);
    expect(activeRun.phase).toBe('running');
    expect(state.backgroundTaskKeys.has('task:task-1')).toBe(false);
  });

  it('projects task notification process metadata from provider adapter', async () => {
    const activeRun = buildRun();
    const sendRunEvent = vi.fn();
    const providerRegistry = {
      get: vi.fn(() => ({
        getCliPid: vi.fn(() => 111),
        getTaskProcessInfo: vi.fn(() => ({
          taskId: 'task-1',
          command: 'sleep 30',
          rootPid: 222,
          pids: [222, 223],
        })),
      })),
    };
    const { handleTaskNotification } = await import('../background-task-coordinator.js');

    handleTaskNotification({
      activeRun,
      msg: {
        type: 'task_notification',
        taskId: 'task-1',
        taskStatus: 'started',
        taskMessage: 'started',
      } as any,
      providerRegistry: providerRegistry as any,
      runId: 'run-1',
      sendRunEvent,
      state: {},
    });

    expect(sendRunEvent).toHaveBeenCalledWith({
      type: 'task_notification',
      runId: 'run-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      status: 'started',
      message: 'started',
      cliPid: 111,
      taskCommand: 'sleep 30',
      taskRootPid: 222,
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackgroundTaskStore, type BackgroundTask } from '../../../stores/backgroundTaskStore';
import { useTaskCenter } from '../useTaskCenter';

const mockSendMessage = vi.fn();
const mockSendToServer = vi.fn();

vi.mock('../../../hooks/useConnection', () => ({
  useConnection: () => ({
    sendMessage: mockSendMessage,
    sendToServer: mockSendToServer,
  }),
}));

const makeTask = (id: string, overrides: Partial<BackgroundTask> = {}): BackgroundTask => ({
  id,
  sessionId: 'sess-1',
  description: `Task ${id}`,
  status: 'in_progress',
  startedAt: Date.now(),
  ...overrides,
});

describe('useTaskCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBackgroundTaskStore.setState({ tasks: {} });
  });

  it('derives runningCount and groups from the store', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1'),
        t2: makeTask('t2', { status: 'completed', completedAt: Date.now() }),
        t3: makeTask('t3', { status: 'paused' }),
      },
    });

    const { result } = renderHook(() => useTaskCenter(undefined));

    expect(result.current.runningCount).toBe(1);
    expect(result.current.groups.running.map(t => t.id)).toEqual(['t1']);
    expect(result.current.groups.paused.map(t => t.id)).toEqual(['t3']);
    expect(result.current.groups.terminal.map(t => t.id)).toEqual(['t2']);
    expect(result.current.hasAnyTasks).toBe(true);
    expect(result.current.hasTerminalTasks).toBe(true);
  });

  it('sends stop_background_task to the owning server when the task has a serverId', () => {
    const { result } = renderHook(() => useTaskCenter('local'));

    result.current.stopTask(
      makeTask('task-123', {
        serverId: 'local',
        sessionId: 'sess-1',
        cliPid: 456,
        taskRootPid: 789,
        taskCommand: 'sleep 30 && echo hello',
      })
    );

    expect(mockSendToServer).toHaveBeenCalledWith('local', {
      type: 'stop_background_task',
      sessionId: 'sess-1',
      taskId: 'task-123',
      cliPid: 456,
      taskRootPid: 789,
      taskCommand: 'sleep 30 && echo hello',
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('falls back to the active-server send when the task has no serverId', () => {
    const { result } = renderHook(() => useTaskCenter(undefined));

    result.current.stopTask(makeTask('task-1'));

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stop_background_task', taskId: 'task-1' })
    );
    expect(mockSendToServer).not.toHaveBeenCalled();
  });

  it('clearFinished removes terminal tasks but keeps running ones', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1'),
        t2: makeTask('t2', { status: 'failed' }),
      },
    });
    const { result } = renderHook(() => useTaskCenter(undefined));

    result.current.clearFinished();

    expect(Object.keys(useBackgroundTaskStore.getState().tasks)).toEqual(['t1']);
  });

  it('clearFinished ignores an event argument (wired straight into onClick)', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1'),
        t2: makeTask('t2', { status: 'completed' }),
      },
    });
    const { result } = renderHook(() => useTaskCenter(undefined));

    // React passes the click event when the handler is used as onClick={fn};
    // it must not be interpreted as a sessionId filter.
    result.current.clearFinished({ type: 'click' } as unknown as void);

    expect(Object.keys(useBackgroundTaskStore.getState().tasks)).toEqual(['t1']);
  });

  it('dismissTask removes a single task', () => {
    useBackgroundTaskStore.setState({ tasks: { t1: makeTask('t1') } });
    const { result } = renderHook(() => useTaskCenter(undefined));

    result.current.dismissTask('t1');

    expect(useBackgroundTaskStore.getState().tasks['t1']).toBeUndefined();
  });
});

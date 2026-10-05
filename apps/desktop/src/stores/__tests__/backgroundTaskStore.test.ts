import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProcessInfo } from '../../services/api';
import {
  useBackgroundTaskStore,
  selectRunningCount,
  selectTasksGrouped,
  type BackgroundTask,
} from '../backgroundTaskStore';

vi.mock('../../services/api', () => ({
  getProcessInfo: vi.fn(),
}));

const makeTask = (
  id: string,
  sessionId = 'sess-1',
  status: BackgroundTask['status'] = 'started'
): BackgroundTask => ({
  id,
  sessionId,
  description: `Task ${id}`,
  status,
  startedAt: Date.now(),
});

describe('backgroundTaskStore', () => {
  const mockGetProcessInfo = vi.mocked(getProcessInfo);

  beforeEach(() => {
    vi.useFakeTimers();
    useBackgroundTaskStore.setState({ tasks: {} });
    mockGetProcessInfo.mockReset();
  });

  afterEach(() => {
    useBackgroundTaskStore.getState().clearTasks();
    useBackgroundTaskStore.getState().stopPidMonitor();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('addTask adds a task', () => {
    const task = makeTask('t1');
    useBackgroundTaskStore.getState().addTask(task);
    expect(useBackgroundTaskStore.getState().tasks['t1']).toEqual(task);
  });

  it('updateTask updates task fields', () => {
    useBackgroundTaskStore.setState({ tasks: { t1: makeTask('t1') } });
    useBackgroundTaskStore.getState().updateTask('t1', { status: 'completed', summary: 'Done' });

    const updated = useBackgroundTaskStore.getState().tasks['t1'];
    expect(updated.status).toBe('completed');
    expect(updated.summary).toBe('Done');
  });

  it('keeps a terminal task added directly until dismissed', () => {
    useBackgroundTaskStore.getState().addTask(makeTask('t1', 'sess-1', 'completed'));

    vi.advanceTimersByTime(60_000);

    expect(useBackgroundTaskStore.getState().tasks['t1']).toBeDefined();
  });

  it('keeps a task after update to terminal status', () => {
    useBackgroundTaskStore.getState().addTask(makeTask('t1'));
    useBackgroundTaskStore.getState().updateTask('t1', { status: 'completed' });

    vi.advanceTimersByTime(60_000);

    expect(useBackgroundTaskStore.getState().tasks['t1']).toBeDefined();
  });

  it('removeTask removes a task', () => {
    useBackgroundTaskStore.setState({ tasks: { t1: makeTask('t1'), t2: makeTask('t2') } });
    useBackgroundTaskStore.getState().removeTask('t1');

    expect(useBackgroundTaskStore.getState().tasks['t1']).toBeUndefined();
    expect(useBackgroundTaskStore.getState().tasks['t2']).toBeDefined();
  });

  it('clearTasks clears all tasks when no sessionId', () => {
    useBackgroundTaskStore.setState({ tasks: { t1: makeTask('t1'), t2: makeTask('t2') } });
    useBackgroundTaskStore.getState().clearTasks();

    expect(Object.keys(useBackgroundTaskStore.getState().tasks)).toHaveLength(0);
  });

  it('clearTasks clears only tasks for given sessionId', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1', 'sess-1'),
        t2: makeTask('t2', 'sess-2'),
        t3: makeTask('t3', 'sess-1'),
      },
    });
    useBackgroundTaskStore.getState().clearTasks('sess-1');

    const remaining = useBackgroundTaskStore.getState().tasks;
    expect(Object.keys(remaining)).toEqual(['t2']);
  });

  it('clearTerminalTasks removes only terminal tasks and keeps running ones', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1', 'sess-1', 'in_progress'),
        t2: makeTask('t2', 'sess-1', 'completed'),
        t3: makeTask('t3', 'sess-2', 'failed'),
        t4: makeTask('t4', 'sess-2', 'started'),
      },
    });
    useBackgroundTaskStore.getState().clearTerminalTasks();

    expect(Object.keys(useBackgroundTaskStore.getState().tasks).sort()).toEqual(['t1', 't4']);
  });

  it('clearTerminalTasks scopes removal to the given sessionId', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1', 'sess-1', 'completed'),
        t2: makeTask('t2', 'sess-2', 'stopped'),
      },
    });
    useBackgroundTaskStore.getState().clearTerminalTasks('sess-1');

    expect(Object.keys(useBackgroundTaskStore.getState().tasks)).toEqual(['t2']);
  });

  it('getTasksBySession returns tasks for session', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1', 'sess-1'),
        t2: makeTask('t2', 'sess-2'),
        t3: makeTask('t3', 'sess-1'),
      },
    });

    const tasks = useBackgroundTaskStore.getState().getTasksBySession('sess-1');
    expect(tasks).toHaveLength(2);
    expect(tasks.map(t => t.id).sort()).toEqual(['t1', 't3']);
  });

  it('getTasksBySession returns empty for unknown session', () => {
    expect(useBackgroundTaskStore.getState().getTasksBySession('unknown')).toEqual([]);
  });

  it('selectRunningCount counts only running tasks', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1', 'sess-1', 'started'),
        t2: makeTask('t2', 'sess-1', 'in_progress'),
        t3: makeTask('t3', 'sess-1', 'paused'),
        t4: makeTask('t4', 'sess-1', 'completed'),
      },
    });

    expect(selectRunningCount(useBackgroundTaskStore.getState())).toBe(2);
  });

  it('selectRunningCount scopes to a serverId when given', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: { ...makeTask('t1', 'sess-1', 'started'), serverId: 'server-1' },
        t2: { ...makeTask('t2', 'sess-2', 'in_progress'), serverId: 'server-2' },
        t3: { ...makeTask('t3', 'sess-3', 'started'), serverId: 'server-1' },
      },
    });

    expect(selectRunningCount(useBackgroundTaskStore.getState(), 'server-1')).toBe(2);
    expect(selectRunningCount(useBackgroundTaskStore.getState())).toBe(3);
  });

  it('selectTasksGrouped splits tasks into running / paused / terminal groups', () => {
    const base = Date.now();
    useBackgroundTaskStore.setState({
      tasks: {
        t1: { ...makeTask('t1', 'sess-1', 'started'), startedAt: base },
        t2: { ...makeTask('t2', 'sess-1', 'in_progress'), startedAt: base - 1000 },
        t3: { ...makeTask('t3', 'sess-1', 'paused'), startedAt: base - 500 },
        t4: { ...makeTask('t4', 'sess-1', 'completed'), startedAt: base - 4000, completedAt: base - 100 },
        t5: { ...makeTask('t5', 'sess-1', 'failed'), startedAt: base - 3000, completedAt: base },
        t6: { ...makeTask('t6', 'sess-1', 'stopped'), startedAt: base - 2000 },
      },
    });

    const grouped = selectTasksGrouped(useBackgroundTaskStore.getState());
    // running: oldest first; terminal: most recently finished first
    expect(grouped.running.map(t => t.id)).toEqual(['t2', 't1']);
    expect(grouped.paused.map(t => t.id)).toEqual(['t3']);
    expect(grouped.terminal.map(t => t.id)).toEqual(['t5', 't4', 't6']);
  });

  it('selectTasksGrouped scopes to a serverId when given', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: { ...makeTask('t1', 'sess-1', 'started'), serverId: 'server-1' },
        t2: { ...makeTask('t2', 'sess-2', 'started'), serverId: 'server-2' },
      },
    });

    const grouped = selectTasksGrouped(useBackgroundTaskStore.getState(), 'server-2');
    expect(grouped.running.map(t => t.id)).toEqual(['t2']);
  });

  it('selectTasksGrouped puts running sub-agents in their own group', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1', 'sess-1', 'in_progress'),
        t2: { ...makeTask('t2', 'sess-1', 'in_progress'), kind: 'subagent', agentType: 'coder' },
        t3: { ...makeTask('t3', 'sess-1', 'completed'), kind: 'subagent', agentType: 'coder' },
      },
    });

    const grouped = selectTasksGrouped(useBackgroundTaskStore.getState());
    expect(grouped.running.map(t => t.id)).toEqual(['t1']);
    expect(grouped.subagents.map(t => t.id)).toEqual(['t2']);
    // terminal sub-agents land in the terminal group like everything else
    expect(grouped.terminal.map(t => t.id)).toEqual(['t3']);
  });

  it('selectTasksGrouped treats background_run source as its own kind but keeps it in running', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: { ...makeTask('t1', 'sess-1', 'in_progress'), source: 'background_run' },
      },
    });

    const grouped = selectTasksGrouped(useBackgroundTaskStore.getState());
    expect(grouped.running.map(t => t.id)).toEqual(['t1']);
    expect(grouped.subagents).toHaveLength(0);
  });

  it('starts PID monitor when an existing running task gains a PID', async () => {
    mockGetProcessInfo.mockResolvedValue({ alive: false, pid: 71100 });
    useBackgroundTaskStore.getState().addTask({
      ...makeTask('t1'),
      serverId: 'server-1',
    });

    useBackgroundTaskStore.getState().updateTask('t1', { taskRootPid: 71100 });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockGetProcessInfo).toHaveBeenCalledWith(71100, 'server-1');
    expect(useBackgroundTaskStore.getState().tasks.t1.status).toBe('stopped');
  });

  it('keeps a running task visible after its monitored PID exits', async () => {
    mockGetProcessInfo.mockResolvedValue({ alive: false, pid: 71100 });

    useBackgroundTaskStore.getState().addTask({
      ...makeTask('t1'),
      taskRootPid: 71100,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(useBackgroundTaskStore.getState().tasks.t1.status).toBe('stopped');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(useBackgroundTaskStore.getState().tasks.t1).toBeDefined();
  });
});

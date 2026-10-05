import { create } from 'zustand';
import { getProcessInfo } from '../services/api';

export interface BackgroundTask {
  id: string; // taskId from SDK
  serverId?: string; // owning server/backend for heartbeat reconciliation
  toolUseId?: string; // tool_use_id that triggered this background task
  sessionId: string; // parent session ID
  description: string; // task description
  source?: 'sdk_task' | 'background_run';
  stoppable?: boolean;
  status: 'started' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'stopped';
  outputFile?: string; // output file path (for completed tasks)
  summary?: string; // summary message
  startedAt: number; // timestamp when task started
  completedAt?: number; // timestamp when task completed
  cliPid?: number; // CLI subprocess PID (for display & process-tree killing)
  taskCommand?: string; // Actual command being run (e.g. "npm test")
  taskRootPid?: number; // Root PID of the task's process tree
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
}

interface BackgroundTaskState {
  // Background tasks keyed by task ID
  tasks: Record<string, BackgroundTask>;

  // Actions
  addTask: (task: BackgroundTask) => void;
  updateTask: (taskId: string, updates: Partial<BackgroundTask>) => void;
  removeTask: (taskId: string) => void;
  clearTasks: (sessionId?: string) => void;
  /** Remove only terminal (completed/failed/stopped) tasks; running tasks are kept. */
  clearTerminalTasks: (sessionId?: string) => void;
  getTasksBySession: (sessionId: string) => BackgroundTask[];
  /** Start periodic PID liveness checking */
  startPidMonitor: () => void;
  /** Stop periodic PID liveness checking */
  stopPidMonitor: () => void;
}

const PID_CHECK_INTERVAL_MS = 10_000; // Check every 10 seconds

// Terminal tasks are kept until the user dismisses them or hits "clear
// finished" — no timer-based auto-removal.

// Module-level state managed within the store's closure
let pidMonitorInterval: ReturnType<typeof setInterval> | null = null;

function isTerminalStatus(status: BackgroundTask['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}

function isRunningStatus(status: BackgroundTask['status']): boolean {
  return status === 'started' || status === 'in_progress';
}

function getMonitorPid(task: BackgroundTask): number | undefined {
  return task.taskRootPid || task.cliPid;
}

function maybeStartPidMonitor(
  task: BackgroundTask | undefined,
  get: () => BackgroundTaskState
): void {
  if (task && isRunningStatus(task.status) && getMonitorPid(task)) {
    get().startPidMonitor();
  }
}

/** Running task count; pass a serverId to scope to one backend. */
export function selectRunningCount(
  state: Pick<BackgroundTaskState, 'tasks'>,
  serverId?: string
): number {
  return Object.values(state.tasks).filter(
    t => isRunningStatus(t.status) && (serverId === undefined || t.serverId === serverId)
  ).length;
}

export interface GroupedBackgroundTasks {
  running: BackgroundTask[];
  paused: BackgroundTask[];
  terminal: BackgroundTask[];
}

/**
 * Tasks split into display groups for the task center. Running/paused keep
 * start order (oldest first); terminal tasks sort most-recently-finished first.
 */
export function selectTasksGrouped(
  state: Pick<BackgroundTaskState, 'tasks'>,
  serverId?: string
): GroupedBackgroundTasks {
  const tasks = Object.values(state.tasks).filter(
    t => serverId === undefined || t.serverId === serverId
  );
  const byStartedAt = (a: BackgroundTask, b: BackgroundTask) => a.startedAt - b.startedAt;
  return {
    running: tasks.filter(t => isRunningStatus(t.status)).sort(byStartedAt),
    paused: tasks.filter(t => t.status === 'paused').sort(byStartedAt),
    terminal: tasks
      .filter(t => isTerminalStatus(t.status))
      .sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt)),
  };
}

export const useBackgroundTaskStore = create<BackgroundTaskState>((set, get) => ({
  tasks: {},

  addTask: task => {
    set(state => ({
      tasks: { ...state.tasks, [task.id]: task },
    }));
    maybeStartPidMonitor(task, get);
  },

  updateTask: (taskId, updates) => {
    set(state => ({
      tasks: {
        ...state.tasks,
        [taskId]: { ...state.tasks[taskId], ...updates },
      },
    }));
    maybeStartPidMonitor(get().tasks[taskId], get);
  },

  removeTask: taskId =>
    set(state => {
      const { [taskId]: _, ...rest } = state.tasks;
      return { tasks: rest };
    }),

  clearTasks: sessionId =>
    set(state => {
      if (!sessionId) {
        return { tasks: {} };
      }
      const filteredTasks = Object.fromEntries(
        Object.entries(state.tasks).filter(([_, task]) => task.sessionId !== sessionId)
      );
      return { tasks: filteredTasks };
    }),

  clearTerminalTasks: sessionId =>
    set(state => {
      const kept = Object.fromEntries(
        Object.entries(state.tasks).filter(([_, task]) => {
          if (!isTerminalStatus(task.status)) return true;
          return sessionId !== undefined && task.sessionId !== sessionId;
        })
      );
      return { tasks: kept };
    }),

  getTasksBySession: sessionId => {
    const state = get();
    return Object.values(state.tasks).filter(task => task.sessionId === sessionId);
  },

  startPidMonitor: () => {
    if (pidMonitorInterval) return;
    pidMonitorInterval = setInterval(async () => {
      const { tasks, updateTask } = get();
      const runningTasks = Object.values(tasks).filter(
        t => isRunningStatus(t.status) && getMonitorPid(t)
      );

      if (runningTasks.length === 0) {
        // No running tasks with PIDs — stop monitoring
        get().stopPidMonitor();
        return;
      }

      for (const task of runningTasks) {
        const pid = getMonitorPid(task);
        if (!pid) continue;
        try {
          const info = await getProcessInfo(pid, task.serverId);
          const currentTask = get().tasks[task.id];
          if (
            !currentTask ||
            !isRunningStatus(currentTask.status) ||
            getMonitorPid(currentTask) !== pid
          ) {
            continue;
          }
          if (!info.alive) {
            console.log(
              `[PidMonitor] PID ${pid} for task "${task.description}" is no longer alive, marking as stopped`
            );
            updateTask(task.id, {
              status: 'stopped',
              summary:
                (task.summary ? task.summary + '\n' : '') +
                `Process (PID ${pid}) exited unexpectedly`,
              completedAt: Date.now(),
            });
          }
        } catch {
          // API call failed, skip this check
        }
      }
    }, PID_CHECK_INTERVAL_MS);
  },

  stopPidMonitor: () => {
    if (pidMonitorInterval) {
      clearInterval(pidMonitorInterval);
      pidMonitorInterval = null;
    }
  },
}));

// Clean up interval on HMR module reload (Vite) and page unload
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    useBackgroundTaskStore.getState().stopPidMonitor();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    useBackgroundTaskStore.getState().stopPidMonitor();
  });
}

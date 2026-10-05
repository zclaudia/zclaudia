import { useCallback, useMemo } from 'react';
import {
  useBackgroundTaskStore,
  selectRunningCount,
  selectTasksGrouped,
  type BackgroundTask,
  type GroupedBackgroundTasks,
} from '../../stores/backgroundTaskStore';
import { useConnection } from '../../hooks/useConnection';

export interface TaskCenterViewModel {
  /** Running tasks across the whole backend (every session), for the pill. */
  runningCount: number;
  /** All tasks on this backend, grouped for display. */
  groups: GroupedBackgroundTasks;
  hasAnyTasks: boolean;
  hasTerminalTasks: boolean;
  stopTask: (task: BackgroundTask) => void;
  dismissTask: (taskId: string) => void;
  clearFinished: () => void;
}

/**
 * Assembles the task-center view model: derived store state plus the actions
 * the rows need. Containers (popover today, right-panel extension in P3)
 * render `TaskCenterView` with exactly this shape, so the content component
 * stays store-free and container-free.
 */
export function useTaskCenter(serverId: string | undefined): TaskCenterViewModel {
  const tasks = useBackgroundTaskStore(s => s.tasks);
  const removeTask = useBackgroundTaskStore(s => s.removeTask);
  const clearTerminalTasks = useBackgroundTaskStore(s => s.clearTerminalTasks);
  const { sendMessage, sendToServer } = useConnection();

  const groups = useMemo(() => selectTasksGrouped({ tasks }, serverId), [tasks, serverId]);
  const runningCount = useMemo(() => selectRunningCount({ tasks }, serverId), [tasks, serverId]);

  const stopTask = useCallback(
    (task: BackgroundTask) => {
      const message = {
        type: 'stop_background_task' as const,
        sessionId: task.sessionId,
        taskId: task.id,
        cliPid: task.cliPid,
        taskRootPid: task.taskRootPid,
        taskCommand: task.taskCommand,
      };
      if (task.serverId) {
        sendToServer(task.serverId, message);
      } else {
        sendMessage(message);
      }
    },
    [sendMessage, sendToServer]
  );

  const hasTerminalTasks = groups.terminal.length > 0;

  return {
    runningCount,
    groups,
    hasAnyTasks: runningCount > 0 || groups.paused.length > 0 || hasTerminalTasks,
    hasTerminalTasks,
    stopTask,
    dismissTask: removeTask,
    // Wrap rather than alias: the view wires this straight into Button
    // onClick, which would otherwise pass the click event as the scope.
    // Scoped to this backend — the view only lists this backend's tasks, so
    // clearing across all backends would delete rows the user cannot see.
    clearFinished: () => clearTerminalTasks(serverId ? { serverId } : undefined),
  };
}

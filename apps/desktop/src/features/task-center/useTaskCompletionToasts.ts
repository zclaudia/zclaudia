import { useEffect } from 'react';
import {
  useBackgroundTaskStore,
  type BackgroundTask,
} from '../../stores/backgroundTaskStore';
import { useToastStore } from '../../stores/toastStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { useTaskCenterUiStore } from './taskCenterUiStore';

function isTerminalStatus(status: BackgroundTask['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}

const TERMINAL_LABEL: Record<string, string> = {
  completed: 'Task completed',
  failed: 'Task failed',
  stopped: 'Task stopped',
};

/**
 * Fires a toast when a background task reaches a terminal state — but only
 * when the user isn't already looking at it: the window is unfocused, or the
 * task belongs to a session other than the selected one. Clicking the toast
 * jumps to the owning session and opens the task center.
 *
 * Mounted once at the app root (App.tsx); the subscription lives for the app
 * lifetime and reads the current selection lazily at fire time.
 */
export function useTaskCompletionToasts(): void {
  const { selectSession } = useSelectionCoordinator();

  useEffect(() => {
    const unsubscribe = useBackgroundTaskStore.subscribe((state, prevState) => {
      for (const [taskId, task] of Object.entries(state.tasks)) {
        const before = prevState.tasks[taskId];
        const becameTerminal = before
          ? !isTerminalStatus(before.status) && isTerminalStatus(task.status)
          : isTerminalStatus(task.status);
        if (!becameTerminal) continue;

        const selectedSessionId = useSelectionStore.getState().selectedSessionId;
        const windowUnfocused =
          typeof document !== 'undefined' && !document.hasFocus();
        const isOtherSession =
          selectedSessionId !== undefined && task.sessionId !== selectedSessionId;
        if (!windowUnfocused && !isOtherSession) continue;

        useToastStore.getState().add({
          title: task.description || 'Background Task',
          message:
            task.summary?.slice(0, 100) ??
            TERMINAL_LABEL[task.status] ??
            'Task finished',
          type: task.status === 'completed' ? 'success' : 'error',
          icon: task.status === 'completed' ? 'task' : 'error',
          sessionId: task.sessionId,
          serverId: task.serverId,
          onClick: () => {
            // Jump on the owning backend, same contract as TaskCenterEntry's
            // onLocate — the fallback to the active backend would silently
            // land nowhere when the owner's session list isn't loaded.
            selectSession(task.sessionId, { backendId: task.serverId });
            useTaskCenterUiStore.getState().setPopoverOpen(true);
          },
        });
      }
    });
    return unsubscribe;
  }, [selectSession]);
}

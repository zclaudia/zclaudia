import { useEffect } from 'react';
import { useBackgroundTaskStore } from '../../stores/backgroundTaskStore';
import { useServerStore } from '../../stores/serverStore';
import { TaskDrawer } from './TaskDrawer';
import { useSubagentDetail } from './useSubagentDetail';
import { useSubagentSteps } from './useSubagentSteps';
import { useTaskCenter } from './useTaskCenter';
import { useTaskCenterUiStore } from './taskCenterUiStore';

/**
 * Store-connected container for the sub-agent drawer: resolves the task
 * named by the ui store, feeds it the run-derived detail, and wires Stop to
 * the same stop path the task rows use. Mounts once per chat window; renders
 * nothing unless a drawer is open. If the task disappears (dismissed /
 * cleared) while open, the drawer closes itself rather than showing a husk.
 */
export function TaskDrawerHost() {
  const drawerTaskId = useTaskCenterUiStore(s => s.drawerTaskId);
  const closeDrawer = useTaskCenterUiStore(s => s.closeDrawer);
  const task = useBackgroundTaskStore(s => (drawerTaskId ? s.tasks[drawerTaskId] : undefined));
  const detail = useSubagentDetail(task ?? null);
  const steps = useSubagentSteps(task ?? null);
  const activeServerId = useServerStore(s => s.activeServerId);
  const { stopTask } = useTaskCenter(activeServerId ?? undefined);

  const taskMissing = drawerTaskId !== null && task === undefined;
  useEffect(() => {
    if (taskMissing) closeDrawer();
  }, [taskMissing, closeDrawer]);

  if (!task) return null;
  const isRunning = task.status === 'started' || task.status === 'in_progress';
  return (
    <TaskDrawer
      task={task}
      detail={detail}
      steps={steps}
      onStop={isRunning && task.stoppable !== false ? stopTask : undefined}
      onClose={closeDrawer}
    />
  );
}

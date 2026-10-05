import { memo } from 'react';
import { CheckCircle2, XCircle, Loader2, PauseCircle } from 'lucide-react';
import {
  useBackgroundTaskStore,
  type BackgroundTask,
} from '../../stores/backgroundTaskStore';
import { useTaskCenterUiStore } from '../task-center/taskCenterUiStore';
import { Button } from '../../components/ui/Button';

function statusLabel(task: BackgroundTask): string {
  switch (task.status) {
    case 'started':
    case 'in_progress':
      return 'Running in background';
    case 'paused':
      return 'Paused in background';
    case 'completed':
      return 'Background task completed';
    case 'failed':
      return 'Background task failed';
    case 'stopped':
      return 'Background task stopped';
  }
}

function ChipIcon({ task }: { task: BackgroundTask }) {
  switch (task.status) {
    case 'started':
    case 'in_progress':
      return <Loader2 size={11} strokeWidth={1.75} className="shrink-0 animate-spin text-primary" />;
    case 'paused':
      return <PauseCircle size={11} strokeWidth={1.75} className="shrink-0 text-warning" />;
    case 'failed':
    case 'stopped':
      return <XCircle size={11} strokeWidth={1.75} className="shrink-0 text-destructive" />;
    case 'completed':
      return <CheckCircle2 size={11} strokeWidth={1.75} className="shrink-0 text-success" />;
  }
}

interface BackgroundTaskChipProps {
  sessionId: string | null;
  toolUseId: string;
}

/**
 * Status line under a transcript tool card whose call continues as a
 * background task (a backgrounded command, or a Task-tool sub-agent). The
 * match key is the tool_use_id both sides carry, so no wire change is needed.
 * Clicking through opens the task center, where the task's full detail lives.
 * Renders nothing while the call has no background-task entry — including the
 * common case of a sub-agent that runs entirely in the foreground.
 */
export const BackgroundTaskChip = memo(function BackgroundTaskChip({
  sessionId,
  toolUseId,
}: BackgroundTaskChipProps) {
  // Latest matching task wins: a tool_use_id is unique per call, but a stale
  // entry could survive a session resume, so never trust there to be one.
  const task = useBackgroundTaskStore(s => {
    if (!sessionId) return undefined;
    let best: BackgroundTask | undefined;
    for (const t of Object.values(s.tasks)) {
      if (t.sessionId === sessionId && t.toolUseId === toolUseId) {
        if (!best || t.startedAt > best.startedAt) best = t;
      }
    }
    return best;
  });
  if (!sessionId || !task) return null;

  const isRunning = task.status === 'started' || task.status === 'in_progress';
  const meta = isRunning && task.activity ? ` · ${task.activity}` : '';

  return (
    <div
      data-testid="background-task-chip"
      className="ml-7 flex items-center gap-1.5 text-[11px] text-muted-foreground"
    >
      <ChipIcon task={task} />
      <span className="truncate">
        {statusLabel(task)}
        {meta}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => useTaskCenterUiStore.getState().setPopoverOpen(true)}
      >
        View in task center
      </Button>
    </div>
  );
});

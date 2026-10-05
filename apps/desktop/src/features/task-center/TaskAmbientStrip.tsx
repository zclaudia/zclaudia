import { useBackgroundTaskStore } from '../../stores/backgroundTaskStore';

interface TaskAmbientStripProps {
  sessionId: string;
  onOpen: () => void;
}

/**
 * The chat-bottom remnant of the old BackgroundTaskPanel: a single line that
 * exists only while this session has running tasks, and whose only job is to
 * open the task center. On mobile (<md, where the header pill is hidden)
 * this is the primary entry point.
 */
export function TaskAmbientStrip({ sessionId, onOpen }: TaskAmbientStripProps) {
  const runningCount = useBackgroundTaskStore(
    s =>
      Object.values(s.tasks).filter(
        t => t.sessionId === sessionId && (t.status === 'started' || t.status === 'in_progress')
      ).length
  );

  if (runningCount === 0) return null;

  return (
    <button
      onClick={onOpen}
      className="flex select-none items-center gap-2 border-t border-border px-3.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary"
    >
      <span className="h-[7px] w-[7px] shrink-0 animate-pulse rounded-full bg-primary" />
      <span>
        <span className="font-medium text-foreground tabular-nums">{runningCount}</span>{' '}
        {runningCount === 1 ? 'task' : 'tasks'} running
      </span>
      <span className="ml-auto">View task center →</span>
    </button>
  );
}

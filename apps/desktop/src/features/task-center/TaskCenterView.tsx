import type { BackgroundTask } from '../../stores/backgroundTaskStore';
import type { GroupedBackgroundTasks } from '../../stores/backgroundTaskStore';
import { X } from 'lucide-react';
import { SECTION_LABEL } from '../../components/ui/typography';
import { Button, IconButton } from '../../components/ui/Button';
import { TaskRow } from './TaskRow';

export interface TaskCenterViewProps {
  groups: GroupedBackgroundTasks;
  hasTerminalTasks: boolean;
  /** Tasks from other sessions get a name tag resolved through this. */
  currentSessionId?: string;
  resolveSessionLabel?: (sessionId: string) => string | undefined;
  onStop: (task: BackgroundTask) => void;
  onDismiss: (taskId: string) => void;
  onClearFinished: () => void;
  /** Jump to the session that owns a (cross-session) task. */
  onLocate?: (task: BackgroundTask) => void;
  /** When set (mobile overlay), the header shows a close button. */
  onClose?: () => void;
}

/**
 * The task-center content: header, grouped rows, footer note. Purely
 * presentational — no store access, no positioning, no height constraint of
 * its own. Containers (the header popover today, a right-panel extension in
 * P3) wrap this and supply the scroll bounds; that is what makes the dual
 * mount a zero-rewrite operation.
 */
export function TaskCenterView({
  groups,
  hasTerminalTasks,
  currentSessionId,
  resolveSessionLabel,
  onStop,
  onDismiss,
  onClearFinished,
  onLocate,
  onClose,
}: TaskCenterViewProps) {
  const renderRow = (task: BackgroundTask) => {
    const isOtherSession = currentSessionId !== undefined && task.sessionId !== currentSessionId;
    return (
      <TaskRow
        key={task.id}
        task={task}
        isOtherSession={isOtherSession}
        sessionLabel={isOtherSession ? resolveSessionLabel?.(task.sessionId) : undefined}
        onStop={onStop}
        onDismiss={onDismiss}
        onLocate={isOtherSession ? onLocate : undefined}
      />
    );
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <span className="text-[13px] font-semibold text-foreground">Tasks</span>
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={!hasTerminalTasks} onClick={onClearFinished}>
            Clear finished
          </Button>
          {onClose && (
            <IconButton aria-label="Close task center" onClick={onClose}>
              <X size={16} strokeWidth={1.75} />
            </IconButton>
          )}
        </span>
      </div>

      {groups.running.length > 0 && (
        <>
          <h4 className={`${SECTION_LABEL} px-3 pb-0.5 pt-1.5`}>Running · {groups.running.length}</h4>
          {groups.running.map(renderRow)}
        </>
      )}
      {groups.paused.length > 0 && (
        <>
          <h4 className={`${SECTION_LABEL} px-3 pb-0.5 pt-1.5`}>Paused · {groups.paused.length}</h4>
          {groups.paused.map(renderRow)}
        </>
      )}
      {groups.terminal.length > 0 && (
        <>
          <h4 className={`${SECTION_LABEL} px-3 pb-0.5 pt-1.5`}>
            Finished · {groups.terminal.length}
          </h4>
          {groups.terminal.map(renderRow)}
        </>
      )}

      <div className="mt-1.5 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground/60">
        Finished tasks stay until you clear them
      </div>
    </div>
  );
}

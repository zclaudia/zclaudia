import { CheckCircle2, Loader2 } from 'lucide-react';

interface TaskPillProps {
  runningCount: number;
  /** Terminal tasks still listed — they keep the pill visible so they can be cleared. */
  finishedCount?: number;
  open: boolean;
  onToggle: () => void;
}

/**
 * L1 ambient indicator in the SessionHeader: a ghost chip with the number of
 * tasks running across this backend (all sessions). Renders nothing when
 * there are no tasks at all — the header carries zero task chrome unless
 * there is something to point at. Once only finished tasks remain the pill
 * stays (in a settled style), because terminal tasks persist until cleared
 * and this is the only persistent affordance to reach them. Matches the
 * session-info chip's visual family (11px, rounded-md border, h-7-ish
 * padding).
 */
export function TaskPill({ runningCount, finishedCount = 0, open, onToggle }: TaskPillProps) {
  if (runningCount === 0 && finishedCount === 0) return null;
  const settled = runningCount === 0;

  return (
    <button
      onClick={onToggle}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-none transition-colors ${
        open
          ? 'border-border bg-secondary text-foreground'
          : 'border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground'
      }`}
      title="Background tasks"
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      {settled ? (
        <CheckCircle2 size={12} className="shrink-0 text-success" strokeWidth={1.75} />
      ) : (
        <Loader2 size={12} className="shrink-0 animate-spin text-primary" strokeWidth={1.75} />
      )}
      <span className="font-medium text-foreground tabular-nums">
        {settled ? finishedCount : runningCount}
      </span>
      <span>{settled ? 'finished' : 'running'}</span>
    </button>
  );
}

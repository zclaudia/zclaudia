import { Loader2 } from 'lucide-react';

interface TaskPillProps {
  runningCount: number;
  open: boolean;
  onToggle: () => void;
}

/**
 * L1 ambient indicator in the SessionHeader: a ghost chip with the number of
 * tasks running across this backend (all sessions). Renders nothing when
 * idle — the header carries zero task chrome unless there is something to
 * point at. Matches the session-info chip's visual family (11px, rounded-md
 * border, h-7-ish padding).
 */
export function TaskPill({ runningCount, open, onToggle }: TaskPillProps) {
  if (runningCount === 0) return null;

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
      <Loader2 size={12} className="shrink-0 animate-spin text-primary" strokeWidth={1.75} />
      <span className="font-medium text-foreground tabular-nums">{runningCount}</span>
      <span>running</span>
    </button>
  );
}

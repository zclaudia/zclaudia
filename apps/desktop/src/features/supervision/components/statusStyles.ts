import type { TaskStatus } from '@zclaudia/shared';

// Collapse the fine-grained supervision lifecycle onto the theme's semantic
// tokens. The label text carries the exact state; color carries the category
// (active / done / attention / failed / idle). This keeps every badge AA-legible
// and theme-adaptive instead of the raw `-500` palette, which failed WCAG AA on
// its own `/10` tint in light mode and never re-tuned per theme.
//
// Categories → tokens:
//   primary      active/current focus (proposed, planning)
//   success      progressing or done well (running, completed, approved, integrated)
//   warning      needs attention (reviewing, merge_conflict, blocked)
//   destructive  ended badly (rejected, failed)
//   muted        idle/inert (pending, queued, cancelled)

export interface TaskStatusStyle {
  label: string;
  /** Badge classes: tinted surface + on-token text. */
  badge: string;
}

const STYLE: Record<TaskStatus, TaskStatusStyle> = {
  proposed: { label: 'Proposed', badge: 'bg-primary/10 text-primary' },
  pending: { label: 'Pending', badge: 'bg-muted text-muted-foreground' },
  queued: { label: 'Queued', badge: 'bg-muted text-muted-foreground' },
  planning: { label: 'Planning', badge: 'bg-primary/10 text-primary' },
  running: { label: 'Running', badge: 'bg-success/10 text-success' },
  completed: { label: 'Completed', badge: 'bg-success/10 text-success' },
  reviewing: { label: 'Reviewing', badge: 'bg-warning/10 text-warning' },
  approved: { label: 'Approved', badge: 'bg-success/10 text-success' },
  integrated: { label: 'Integrated', badge: 'bg-success/10 text-success' },
  rejected: { label: 'Rejected', badge: 'bg-destructive/10 text-destructive' },
  merge_conflict: { label: 'Conflict', badge: 'bg-warning/10 text-warning' },
  blocked: { label: 'Blocked', badge: 'bg-warning/10 text-warning' },
  failed: { label: 'Failed', badge: 'bg-destructive/10 text-destructive' },
  cancelled: { label: 'Cancelled', badge: 'bg-muted text-muted-foreground' },
};

const FALLBACK: TaskStatusStyle = { label: 'Unknown', badge: 'bg-muted text-muted-foreground' };

export function taskStatusStyle(status: string): TaskStatusStyle {
  return STYLE[status as TaskStatus] ?? { ...FALLBACK, label: status };
}

/** Shared token classes for the inline approve / reject / resolve actions. */
export const ACTION_BUTTON = {
  approve: 'bg-success/10 text-success hover:bg-success/20',
  reject: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
  resolve: 'bg-warning/10 text-warning hover:bg-warning/20',
} as const;

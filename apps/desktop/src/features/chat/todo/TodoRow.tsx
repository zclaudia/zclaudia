import { CheckCircle2, Loader2, Square, XCircle } from 'lucide-react';
import type { NormalizedTodoItem } from '@zclaudia/shared/interaction/forms';

export function TodoStatusIcon({ status }: { status: NormalizedTodoItem['status'] }) {
  const common = { size: 14, strokeWidth: 1.75, className: 'flex-shrink-0 mt-[3px]' };
  switch (status) {
    case 'completed':
      return <CheckCircle2 {...common} className={`${common.className} text-success`} />;
    case 'in_progress':
      return <Loader2 {...common} className={`${common.className} animate-spin text-primary`} />;
    case 'cancelled':
      return <XCircle {...common} className={`${common.className} text-muted-foreground/60`} />;
    default:
      return <Square {...common} className={`${common.className} text-muted-foreground`} />;
  }
}

/** One step of a task list, shared by the floating panel and the inline summary. */
export function TodoRow({ todo }: { todo: NormalizedTodoItem }) {
  const text =
    todo.status === 'completed'
      ? 'text-muted-foreground line-through'
      : todo.status === 'cancelled'
        ? 'text-muted-foreground/60 line-through'
        : todo.status === 'in_progress'
          ? 'text-foreground font-medium'
          : 'text-foreground';
  return (
    <li
      data-status={todo.status}
      className={`flex items-start gap-2 rounded-md px-2 py-1 text-xs leading-5 ${
        todo.status === 'in_progress' ? 'bg-secondary' : ''
      }`}
    >
      <TodoStatusIcon status={todo.status} />
      <span className={`min-w-0 break-words ${text}`}>{todo.content}</span>
    </li>
  );
}

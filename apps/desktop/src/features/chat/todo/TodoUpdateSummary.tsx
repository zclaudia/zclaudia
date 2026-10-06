import { useState } from 'react';
import { ChevronDown, ChevronRight, ListTodo } from 'lucide-react';
import type { NormalizedTodoItem } from '@zclaudia/shared/interaction/forms';
import { summarizeTodos } from './todoSnapshot';
import { TodoRow } from './TodoRow';

/**
 * A todo update as it appears in the transcript: one line, expandable. The
 * floating panel is where the live list is read; this row only records that
 * the list changed at this point and lets you see that version of it.
 */
export function TodoUpdateSummary({ todos }: { todos: NormalizedTodoItem[] }) {
  const [open, setOpen] = useState(false);
  const { done, total } = summarizeTodos(todos);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex h-7 items-center gap-2 self-start rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <ListTodo size={14} strokeWidth={1.75} className="flex-shrink-0" />
        <span>Task list updated</span>
        <span className="tabular-nums text-muted-foreground/60">
          {done} of {total} done
        </span>
        {open ? (
          <ChevronDown size={14} strokeWidth={1.75} className="flex-shrink-0" />
        ) : (
          <ChevronRight size={14} strokeWidth={1.75} className="flex-shrink-0" />
        )}
      </button>
      {open && (
        <ul className="mt-0.5 space-y-0.5 pl-2">
          {todos.map((todo, index) => (
            <TodoRow key={index} todo={todo} />
          ))}
        </ul>
      )}
    </div>
  );
}

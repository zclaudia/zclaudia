import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface BackendRowProps {
  name: string;
  online: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Top-level sidebar row for one backend. Header shows an online dot, the backend
 * name, and an expand chevron; expanded content (the project subtree) is supplied
 * by the parent. Presentational only — no data or connection logic (Phase 3).
 */
export function BackendRow({ name, online, expanded, onToggle, children }: BackendRowProps) {
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-secondary transition-colors"
      >
        <ChevronRight
          size={14}
          strokeWidth={2}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground'}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{name}</span>
      </button>
      {expanded && <div className="pl-3">{children}</div>}
    </div>
  );
}

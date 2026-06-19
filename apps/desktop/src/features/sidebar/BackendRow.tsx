import { ChevronRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';

interface BackendRowProps {
  name: string;
  online: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  onNewProject?: () => void;
  newProjectDisabled?: boolean;
}

/**
 * Top-level sidebar row for one backend. Header shows an online dot, the backend
 * name, and an expand chevron; expanded content (the project subtree) is supplied
 * by the parent. Presentational only — no data or connection logic (Phase 3).
 */
export function BackendRow({ name, online, expanded, onToggle, children, onNewProject, newProjectDisabled }: BackendRowProps) {
  return (
    <div className="space-y-1">
      <div className="group flex items-center rounded-md hover:bg-secondary transition-colors">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
        >
          <ChevronRight
            size={14}
            strokeWidth={2}
            className={`flex-shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground'}`} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{name}</span>
        </button>
        {onNewProject && (
          <button
            type="button"
            onClick={onNewProject}
            disabled={newProjectDisabled}
            className="mr-1 hidden h-6 w-6 flex-shrink-0 items-center justify-center rounded-md hover:bg-accent group-hover:flex disabled:cursor-not-allowed"
            title="New project"
            aria-label="New project"
          >
            <Plus size={14} strokeWidth={2} className="text-muted-foreground" />
          </button>
        )}
      </div>
      {expanded && <div className="pl-3">{children}</div>}
    </div>
  );
}

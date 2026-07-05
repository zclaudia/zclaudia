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
export function BackendRow({
  name,
  online,
  expanded,
  onToggle,
  children,
  onNewProject,
  newProjectDisabled,
}: BackendRowProps) {
  return (
    <div className="space-y-1">
      <div className="group flex items-center rounded-md hover:bg-secondary transition-colors">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          // pr-1 (not px-2) matches ProjectListItem's px-1 right padding so the
          // trailing chevron lines up vertically with the project row's chevron;
          // pl-2 keeps this parent row one indent level shallower than projects.
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 pr-1 text-left"
        >
          {/* Status dot leads (like the project row's folder icon); the expand
              chevron trails at the right end, matching ProjectListItem. */}
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground'}`}
          />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {name}
          </span>
          <ChevronRight
            size={14}
            strokeWidth={2}
            className={`flex-shrink-0 text-muted-foreground/70 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
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

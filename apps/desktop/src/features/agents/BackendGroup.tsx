import { ChevronRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AgentsBackend } from './agents-types';

interface BackendGroupProps {
  backend: AgentsBackend;
  expanded: boolean;
  onToggle: () => void;
  /** aria-label + title for the hover create button, e.g. "New profile". */
  createLabel: string;
  onCreate: () => void;
  children: ReactNode;
}

/**
 * Shared backend group header for Agents shell mode trees (profiles, skills, and Phase 3's
 * MCP servers). Offline backends are dimmed, non-expandable, and never reveal children.
 * Presentational only.
 */
export function BackendGroup({
  backend,
  expanded,
  onToggle,
  createLabel,
  onCreate,
  children,
}: BackendGroupProps): JSX.Element {
  const { name, online } = backend;
  // The online gate is applied here (not by the caller) so offline backends can never reveal
  // children even if a caller mistakenly passes expanded=true for them.
  const showChildren = expanded && online;

  return (
    <div className="space-y-1">
      <div
        className={`group flex items-center rounded-md hover:bg-secondary transition-colors ${online ? '' : 'opacity-60'}`}
      >
        <button
          type="button"
          disabled={!online}
          onClick={() => {
            if (online) onToggle();
          }}
          aria-expanded={online ? expanded : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 pr-1 text-left"
        >
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${online ? 'bg-success' : 'bg-muted-foreground'}`}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {name}
          </span>
          {online && (
            <ChevronRight
              size={14}
              strokeWidth={2}
              className={`flex-shrink-0 text-muted-foreground/70 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          )}
        </button>
        {online && (
          <button
            type="button"
            onClick={onCreate}
            className="mr-1 hidden h-6 w-6 flex-shrink-0 items-center justify-center rounded-md hover:bg-accent group-hover:flex"
            title={createLabel}
            aria-label={createLabel}
          >
            <Plus size={14} strokeWidth={2} className="text-muted-foreground" />
          </button>
        )}
      </div>

      {showChildren && <div className="ml-3 mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

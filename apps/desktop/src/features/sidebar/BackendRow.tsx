import { ChevronRight, Plus, ArrowLeftRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { backendStatusColor, backendStatusLabel, type BackendViewState } from './backendStatus';

interface BackendRowProps {
  name: string;
  online: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  onNewProject?: () => void;
  newProjectDisabled?: boolean;
  /** Full connection state; falls back to the online flag when not supplied. */
  viewState?: BackendViewState;
  latencyMs?: number | null;
  /**
   * Whether this backend is the active one. Only the active backend's projects
   * and sessions are loaded, so a non-active row offers to switch instead of
   * showing an empty (and misleading) project list.
   */
  isActive?: boolean;
  onActivate?: () => void;
  isMobile?: boolean;
}

/**
 * Top-level sidebar row for one backend: status, name, expand chevron, and the
 * project subtree supplied by the parent. This is the app's only backend
 * surface — switching happens here (or implicitly when opening a project), so
 * the row carries the connection state rather than a plain online dot.
 */
export function BackendRow({
  name,
  online,
  expanded,
  onToggle,
  children,
  onNewProject,
  newProjectDisabled,
  viewState,
  latencyMs,
  isActive = true,
  onActivate,
  isMobile,
}: BackendRowProps) {
  const effectiveState: BackendViewState = viewState ?? (online ? 'ready' : 'offline');
  const statusLabel = backendStatusLabel(effectiveState);
  const showSwitch = !isActive && !!onActivate;

  return (
    <div className="space-y-1">
      <div className="group flex items-center rounded-md hover:bg-secondary transition-colors">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          // The name span takes flex-1 so the trailing chevron parks against the
          // action button at a fixed x rather than trailing the text — that is
          // what keeps this chevron on the same column as the project row's.
          // Mobile uses the 44px touch tier and pl-3, which lands the status dot
          // on the drawer's x=20 rail (tree p-2 + 12).
          className={
            isMobile
              ? 'flex min-w-0 flex-1 items-center gap-2.5 h-11 pl-3 pr-1 text-left'
              : 'flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 pr-1 text-left'
          }
        >
          {/* Status dot leads (like the project row's folder icon); the expand
              chevron trails at the right end, matching ProjectListItem. */}
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${backendStatusColor(effectiveState)}`}
            title={statusLabel ?? 'Ready'}
          />
          <span
            className={`min-w-0 flex-1 truncate text-foreground ${
              isMobile ? 'text-sm font-semibold' : 'text-xs font-medium'
            }`}
          >
            {name}
          </span>
          {statusLabel && (
            <span
              className={`flex-shrink-0 text-muted-foreground ${isMobile ? 'text-2xs' : 'text-3xs'}`}
            >
              {statusLabel}
            </span>
          )}
          {!statusLabel && typeof latencyMs === 'number' && (
            <span
              className={`flex-shrink-0 text-muted-foreground/60 ${isMobile ? 'text-2xs' : 'text-3xs'}`}
            >
              {latencyMs}ms
            </span>
          )}
          <ChevronRight
            size={isMobile ? 16 : 14}
            strokeWidth={1.75}
            className={`flex-shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
        {onNewProject && (
          // Visible on touch; hover-revealed only from md: up.
          <button
            type="button"
            onClick={onNewProject}
            disabled={newProjectDisabled}
            className={`flex-shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:cursor-not-allowed md:hidden md:group-hover:flex ${
              isMobile ? 'flex h-11 w-11' : 'mr-1 flex h-6 w-6'
            }`}
            title="New project"
            aria-label="New project"
          >
            <Plus
              size={isMobile ? 16 : 14}
              strokeWidth={1.75}
              className="text-muted-foreground"
            />
          </button>
        )}
      </div>
      {expanded && (
        <div className="pl-3">
          {showSwitch ? (
            <button
              type="button"
              onClick={onActivate}
              className={`flex w-full items-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${
                isMobile ? 'h-11 px-3 text-sm' : 'px-2 py-2 text-xs'
              }`}
            >
              <ArrowLeftRight
                size={isMobile ? 16 : 12}
                strokeWidth={1.75}
                className="flex-shrink-0"
              />
              Switch to this backend
            </button>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

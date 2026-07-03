import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Trash2, GitBranch, MoreHorizontal } from 'lucide-react';
import type { Session } from '@zclaudia/shared';

interface SessionItemProps {
  session: Session;
  isSelected: boolean;
  onSelect: (id: string) => void;
  hasPending: boolean;
  isActive?: boolean;
  providerName?: string;
  worktreeBranch?: string;
  /** Suppress the worktree branch tag (e.g. when shown inside a worktree group header). */
  hideWorktreeBranch?: boolean;
  isMobile?: boolean;
  onPopOut?: () => void;
  /** When set, a hover "remove worktree" button is shown — used on flattened
      single-session worktree rows where there is no group header to host it. */
  onDeleteWorktree?: () => void;
  deleteWorktreeTitle?: string;
}

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  main: { label: 'main', className: 'bg-blue-500/20 text-blue-400' },
  review: { label: 'review', className: 'bg-purple-500/20 text-purple-400' },
  checkpoint: { label: 'check', className: 'bg-orange-500/20 text-orange-400' },
};

/** Resolve status label based on session state. Returns null for idle sessions. */
function getStatusLabel(
  session: Session,
  isActive?: boolean,
  hasPending?: boolean
): { text: string; className: string; pulse?: boolean } | null {
  if (hasPending) return { text: 'waiting', className: 'text-amber-500', pulse: true };
  if (session.lastRunStatus === 'interrupted')
    return { text: 'interrupted', className: 'text-red-400' };
  if (session.planStatus === 'planning') return { text: 'planning', className: 'text-blue-400' };
  if (session.planStatus === 'planned') return { text: 'planned', className: 'text-yellow-500' };
  if (isActive) return { text: 'running', className: 'text-success', pulse: true };
  return null;
}

export function SessionItem({
  session,
  isSelected,
  onSelect,
  hasPending,
  isActive,
  providerName,
  worktreeBranch,
  hideWorktreeBranch,
  isMobile,
  onPopOut,
  onDeleteWorktree,
  deleteWorktreeTitle = 'Remove worktree',
}: SessionItemProps) {
  const isTask = session.projectRole === 'task';
  const roleBadge = session.projectRole ? ROLE_BADGES[session.projectRole] : undefined;
  const statusLabel = getStatusLabel(session, isActive, hasPending);

  // Right-side hover actions (desktop only) collapse into a "⋯" dropdown so the
  // row stays clean — matching the project/session-header menu convention.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const hasRowMenu = !isMobile && Boolean(onDeleteWorktree || onPopOut);
  const actionPadding = hasRowMenu ? 'pr-6' : '';

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuPos) {
      setMenuPos(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  };

  // Task items under Supervisor use lighter styling
  const selectedClass = isTask ? 'bg-muted/60 text-foreground' : 'bg-accent text-foreground';
  const unselectedClass = isTask
    ? `text-muted-foreground/70 hover:bg-muted/40 ${isMobile ? 'active:bg-muted/40' : ''} hover:text-foreground`
    : `text-muted-foreground hover:bg-secondary ${isMobile ? 'active:bg-secondary' : ''} hover:text-foreground`;

  // Strip "Task: " prefix for task items (redundant under Tasks section)
  const displayName = isTask
    ? (session.name || 'Untitled Task').replace(/^Task:\s*/i, '')
    : session.name || 'Untitled Session';

  return (
    <div className="relative group" data-testid="session-item">
      <button
        onClick={() => onSelect(session.id)}
        className={`w-full text-left px-2 rounded-lg truncate flex items-center gap-1 ${
          isTask ? 'text-xs' : 'text-sm'
        } ${
          isMobile ? 'min-h-[44px]' : 'h-7'
        } ${actionPadding} ${isSelected ? selectedClass : unselectedClass}`}
      >
        {!isTask && (
          <span
            className={`h-1.5 w-1.5 mr-1.5 shrink-0 rounded-full ${isActive ? 'bg-success' : 'bg-muted-foreground/40'}`}
            aria-hidden
          />
        )}
        <span className="truncate">{displayName}</span>
        {/* Project role badge */}
        {roleBadge && (
          <span
            className={`text-[9px] px-1 rounded-md font-medium shrink-0 ${roleBadge.className}`}
          >
            {roleBadge.label}
          </span>
        )}
        {/* Provider name tag (for regular sessions, only when idle) */}
        {!session.projectRole && providerName && !statusLabel && (
          <span
            className={`text-[9px] px-1 rounded-md shrink-0 ${
              isSelected
                ? 'bg-foreground/10 text-muted-foreground'
                : 'bg-muted-foreground/10 text-muted-foreground/60'
            }`}
          >
            {providerName}
          </span>
        )}
        {/* Read-only lock icon */}
        {session.isReadOnly && (
          <svg
            className="w-3 h-3 shrink-0 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        )}
        {/* Worktree branch indicator — right-aligned with a branch glyph */}
        {!session.projectRole && worktreeBranch && !hideWorktreeBranch && (
          <span
            className={`ml-auto flex items-center gap-0.5 text-[9px] truncate max-w-[90px] shrink-0 ${
              isSelected ? 'text-foreground/50' : 'text-muted-foreground/50'
            }`}
            title={worktreeBranch}
          >
            <GitBranch size={9} strokeWidth={2} className="shrink-0" />
            <span className="truncate">{worktreeBranch}</span>
          </span>
        )}
        {/* Status label (right side) */}
        {statusLabel && (
          <span
            className={`ml-auto flex items-center gap-1 shrink-0 text-[9px] font-medium ${statusLabel.className}`}
          >
            {statusLabel.pulse && (
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            )}
            {statusLabel.text}
          </span>
        )}
      </button>
      {hasRowMenu && (
        <div
          className={`absolute right-1 top-1/2 -translate-y-1/2 transition-opacity ${
            menuPos ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <button
            onClick={openMenu}
            className={`p-0.5 rounded-md transition-colors ${
              menuPos
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            title="Session actions"
            aria-label="Session actions"
            aria-haspopup="menu"
            aria-expanded={menuPos != null}
          >
            <MoreHorizontal size={13} />
          </button>
        </div>
      )}
      {menuPos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuPos(null)} />
            <div
              role="menu"
              className="fixed z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
              style={{ top: menuPos.top, right: menuPos.right }}
            >
              {onPopOut && (
                <button
                  role="menuitem"
                  onClick={e => {
                    e.stopPropagation();
                    setMenuPos(null);
                    onPopOut();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-foreground hover:bg-secondary"
                >
                  <ExternalLink size={13} className="shrink-0 text-muted-foreground" />
                  Open in new window
                </button>
              )}
              {onDeleteWorktree && (
                <button
                  role="menuitem"
                  onClick={e => {
                    e.stopPropagation();
                    setMenuPos(null);
                    onDeleteWorktree();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/8"
                >
                  <Trash2 size={13} className="shrink-0" />
                  {deleteWorktreeTitle}
                </button>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

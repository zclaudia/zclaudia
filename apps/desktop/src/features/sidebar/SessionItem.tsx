import { useEffect } from 'react';
import { ExternalLink, Trash2, GitBranch, Lock, MoreHorizontal, Columns2 } from 'lucide-react';
import type { Session } from '@zclaudia/shared/core/session';
import { TONE_BADGE, TONE_TEXT, type Tone } from '../../components/ui/tone';
import { DropdownMenu, type DropdownMenuEntry } from '../../components/ui/DropdownMenu';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { selectProjectChat } from '../../actions/projectWorkspaceActions';
import { useDragSplitStore } from '../../components/workspace/dragSplit';
import { flattenPanes, useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../../stores/projectWorkspaceStore';

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

const ROLE_BADGES: Record<string, { label: string; tone: Tone }> = {
  main: { label: 'main', tone: 'info' },
  review: { label: 'review', tone: 'thinking' },
  checkpoint: { label: 'check', tone: 'neutral' },
};

/** Resolve status label based on session state. Returns null for idle sessions. */
function getStatusLabel(
  session: Session,
  isActive?: boolean,
  hasPending?: boolean
): { text: string; tone: Tone; pulse?: boolean } | null {
  if (hasPending) return { text: 'waiting', tone: 'warning', pulse: true };
  if (session.lastRunStatus === 'interrupted') return { text: 'interrupted', tone: 'destructive' };
  if (session.planStatus === 'planning') return { text: 'planning', tone: 'info' };
  if (session.planStatus === 'planned') return { text: 'planned', tone: 'info' };
  if (isActive) return { text: 'running', tone: 'success', pulse: true };
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
  const unifiedWorkspace = useAppearanceStore(s => s.unifiedWorkspace);
  const canArrange = unifiedWorkspace && !isMobile && Boolean(session.projectId);
  const cancelOwnDrag = () => {
    const active = useDragSplitStore.getState().active;
    if (active?.toolId === 'chat' && active.instanceKey === session.id) useDragSplitStore.getState().endDrag();
  };
  useEffect(() => {
    if (!canArrange) return;
    const onPointerUp = (event: PointerEvent) => {
      const target = event.target;
      if (event.type !== 'pointercancel' && target instanceof Element && target.closest('[data-session-workspace]')) return;
      const state = useDragSplitStore.getState();
      if (state.active?.toolId === 'chat' && state.active.instanceKey === session.id) state.endDrag();
    };
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      const state = useDragSplitStore.getState();
      if (state.active?.toolId === 'chat' && state.active.instanceKey === session.id) state.endDrag();
    };
  }, [canArrange, session.id]);
  const openBeside = () => {
    if (!canArrange || !session.projectId) return;
    selectProjectChat(session.projectId, session.id, { beside: true });
    onSelect(session.id);
  };
  const hasRowMenu = !isMobile && Boolean(onDeleteWorktree || onPopOut || canArrange);
  const actionPadding = hasRowMenu ? 'pr-6' : 'pr-2';
  const microClass = isMobile ? 'text-2xs' : 'text-3xs';
  const entries: DropdownMenuEntry[] = [];
  if (canArrange) {
    entries.push(
      { key: 'beside', label: 'Open beside', icon: <Columns2 size={13} />, onSelect: openBeside },
      { key: 'compare', label: 'Compare with current chat', icon: <Columns2 size={13} />, onSelect: openBeside }
    );
  }
  if (onPopOut) entries.push({ key: 'popout', label: 'Open in new window', icon: <ExternalLink size={13} />, onSelect: onPopOut });
  if (onDeleteWorktree) entries.push({ key: 'remove-worktree', label: deleteWorktreeTitle, icon: <Trash2 size={13} />, onSelect: onDeleteWorktree, destructive: true });

  // Task items under Supervisor use lighter styling.
  const selectedClass = isTask ? 'bg-muted/60 text-foreground' : 'bg-accent text-foreground';
  const unselectedClass = isTask
    ? `text-muted-foreground/70 hover:bg-muted/40 ${isMobile ? 'active:bg-muted/40' : ''} hover:text-foreground`
    : `text-muted-foreground hover:bg-secondary ${isMobile ? 'active:bg-secondary' : ''} hover:text-foreground`;

  // Strip "Task: " prefix for task items (redundant under Tasks section).
  // Regular sessions fall back to the auto-generated title so an unnamed session
  // reads the same here as in the home view instead of a bare "Untitled Session".
  const displayName = isTask
    ? (session.name || 'Untitled Task').replace(/^Task:\s*/i, '')
    : session.name || session.autoTitle || 'Untitled Session';

  return (
    <div className="relative group" data-testid="session-item">
      <button
        onClick={event => {
          cancelOwnDrag();
          if (canArrange && (event.metaKey || event.ctrlKey)) openBeside();
          else onSelect(session.id);
        }}
        onPointerDown={event => {
          if (!canArrange || !session.projectId || event.button !== 0 || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return;
          const workspaceId = useProjectWorkspaceStore.getState().byProject[session.projectId]?.workspaceId ?? session.id;
          const root = useRightWorkspaceStore.getState().bySession[workspaceId]?.root ?? null;
          const source = flattenPanes(root).find(pane => pane.tools.some(ref => ref.toolId === 'chat' && ref.instanceKey === session.id));
          useDragSplitStore.getState().startDrag({
            toolId: 'chat', instanceKey: session.id, projectId: session.projectId, multiInstance: true,
            sourcePaneId: source?.id,
            sourceIndex: source?.tools.findIndex(ref => ref.toolId === 'chat' && ref.instanceKey === session.id),
          });
        }}
        // Mobile sits inside the always-on rail at the 44px tier; desktop keeps
        // the negative-margin pull so its hover fill spans the rail padding.
        className={`text-left rounded-md truncate flex items-center transition-colors ${
          isMobile
            ? 'w-full h-11 px-3 gap-2.5 text-sm'
            : `-ml-5 w-[calc(100%+1.25rem)] pl-7 h-7 gap-1 text-xs ${actionPadding}`
        } ${isSelected ? selectedClass : unselectedClass}`}
      >
        {!isTask && (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${isMobile ? '' : 'mr-1.5'} ${isActive ? 'bg-success' : 'bg-muted-foreground/60'}`}
            aria-hidden
          />
        )}
        <span className="truncate">{displayName}</span>
        {/* Project role badge */}
        {roleBadge && (
          <span
            className={`${microClass} px-1 rounded-md font-medium shrink-0 ${TONE_BADGE[roleBadge.tone]}`}
          >
            {roleBadge.label}
          </span>
        )}
        {/* Provider name tag (for regular sessions, only when idle) */}
        {!session.projectRole && providerName && !statusLabel && (
          <span
            className={`${microClass} px-1 rounded-md shrink-0 text-muted-foreground ${
              isSelected ? 'bg-foreground/10' : 'bg-muted-foreground/10'
            }`}
          >
            {providerName}
          </span>
        )}
        {/* Read-only lock icon */}
        {session.isReadOnly && (
          <Lock size={12} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
        )}
        {/* Worktree branch indicator — right-aligned with a branch glyph */}
        {!session.projectRole && worktreeBranch && !hideWorktreeBranch && (
          <span
            className={`ml-auto flex items-center gap-0.5 ${microClass} truncate max-w-[90px] shrink-0 text-muted-foreground`}
            title={worktreeBranch}
          >
            <GitBranch size={isMobile ? 11 : 10} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{worktreeBranch}</span>
          </span>
        )}
        {/* Status label (right side) */}
        {statusLabel && (
          <span
            className={`ml-auto flex items-center gap-1 shrink-0 ${microClass} font-medium ${TONE_TEXT[statusLabel.tone]}`}
          >
            {statusLabel.pulse && (
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            )}
            {statusLabel.text}
          </span>
        )}
      </button>
      {hasRowMenu && (
        <DropdownMenu
          entries={entries}
          align="end"
          ariaLabel="Session actions"
          trigger={({ ref, props, open }) => (
            <div className={`absolute right-1 top-1/2 -translate-y-1/2 transition-opacity ${open ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}>
              <button
                ref={ref}
                {...props}
                className={`relative p-0.5 rounded-md transition-colors before:absolute before:-inset-2 before:content-[''] md:before:content-none ${open ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                title="Session actions"
                aria-label="Session actions"
              >
                <MoreHorizontal size={13} strokeWidth={1.75} />
              </button>
            </div>
          )}
        />
      )}
    </div>
  );
}

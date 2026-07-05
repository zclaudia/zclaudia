import { createPortal } from 'react-dom';
import {
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { isDesktopTauri } from '../../utils/platform';
import { SessionItem } from './SessionItem';
import { WorktreeGroupItem } from './WorktreeGroupItem';
import { ProjectWorkspaceItem } from './ProjectWorkspaceItem';
import { groupSessionsByWorktree } from './worktreeGrouping';
import { SortableList, SortableItem } from '../../components/SortableList';
import type { Session } from '@zclaudia/shared';
import type { ProjectListItemProps } from './types';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '');
}

// Supervisor phase shown as a small status dot on the project header row.
const PHASE_DOT: Record<string, { label: string; dot: string }> = {
  active: { label: 'active', dot: 'bg-success' },
  paused: { label: 'paused', dot: 'bg-warning' },
  setup: { label: 'setup', dot: 'bg-primary' },
  idle: { label: 'idle', dot: 'bg-muted-foreground/40' },
};

function splitProjectSessions(
  sessionList: Session[],
  hasSupervisor: boolean,
  supervisorMainSessionId?: string
) {
  if (!hasSupervisor) {
    return { mainSession: null, taskSessions: [], regularSessions: sessionList };
  }

  const mainSession =
    (supervisorMainSessionId
      ? sessionList.find(session => session.id === supervisorMainSessionId)
      : undefined) ??
    sessionList.find(session => session.projectRole === 'main') ??
    null;
  const taskParentSessionId = supervisorMainSessionId ?? mainSession?.id;
  const taskSessions: Session[] = [];
  const regularSessions: Session[] = [];

  for (const session of sessionList) {
    if (mainSession && session.id === mainSession.id) continue;
    if (
      taskParentSessionId &&
      session.projectRole === 'task' &&
      session.parentSessionId === taskParentSessionId
    ) {
      taskSessions.push(session);
      continue;
    }
    regularSessions.push(session);
  }

  return { mainSession, taskSessions, regularSessions };
}

export function ProjectListItem({
  project,
  isExpanded,
  onToggle,
  sessions,
  selectedSessionId,
  onSelectSession,
  onOpenDashboard,
  hasPendingForSession,
  activeRunSessionIds,
  getProviderName,
  getWorktreeBranch,
  supervisorAgent,
  worktrees,
  expandedWorktrees,
  onToggleWorktree,
  onDeleteWorktree,
  regularSessionsCollapsed,
  onToggleRegularSessions,
  onReorderSessions,
  isMobile,
  contextMenuProject,
  contextMenuPos,
  onOpenContextMenu,
  onCloseContextMenu,
  onSettingsProject,
  onDeleteProject,
  onStartCreatingSession,
  isConnected,
  onPopOutSession,
}: ProjectListItemProps) {
  const menuWidthClass = isMobile ? 'w-44' : 'w-36';
  const menuButtonClass = isMobile
    ? 'w-8 h-8 rounded-md hover:bg-secondary active:bg-secondary flex-shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100'
    : 'w-6 h-6 rounded-md hidden group-hover:flex hover:bg-secondary flex-shrink-0 items-center justify-center';
  const projectButtonClass = isMobile
    ? 'flex-1 min-w-0 min-h-[36px] text-left px-1 text-sm flex items-center gap-1.5 text-foreground'
    : 'flex-1 min-w-0 h-7 text-left px-1 text-sm flex items-center gap-1.5';
  const menuItemBaseClass = isMobile
    ? 'w-full text-left px-3 py-3 text-sm flex items-center gap-2'
    : 'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2';
  const menuItemClass = `${menuItemBaseClass} hover:bg-secondary active:bg-secondary`;
  const menuDeleteClass = `${menuItemBaseClass} text-destructive hover:bg-destructive/8 active:bg-destructive/8`;
  const menuContainerClass = `fixed ${menuWidthClass} overflow-hidden bg-popover border border-border rounded-md py-1 shadow-md z-50`;

  interface RenderSessionOptions {
    /** Override the branch tag (e.g. flattened worktree rows use the git branch). */
    worktreeBranchOverride?: string;
    /** Hide the branch tag entirely (grouped rows — the header already shows it). */
    hideWorktreeBranch?: boolean;
    onDeleteWorktree?: () => void;
    deleteWorktreeTitle?: string;
  }

  const renderSession = (session: Session, opts: RenderSessionOptions = {}) => (
    <SessionItem
      key={session.id}
      session={session}
      isSelected={selectedSessionId === session.id}
      onSelect={onSelectSession}
      hasPending={hasPendingForSession(session.id)}
      isActive={activeRunSessionIds.has(session.id)}
      providerName={getProviderName(session)}
      worktreeBranch={opts.worktreeBranchOverride ?? getWorktreeBranch(session, project)}
      hideWorktreeBranch={opts.hideWorktreeBranch}
      onDeleteWorktree={opts.onDeleteWorktree}
      deleteWorktreeTitle={opts.deleteWorktreeTitle}
      isMobile={isMobile}
      onPopOut={
        !isMobile && isDesktopTauri() && onPopOutSession
          ? () => onPopOutSession(session.id, session.projectId)
          : undefined
      }
    />
  );

  const renderSortableSessions = (
    sessionList: Session[],
    className = 'space-y-0.5',
    sessionOpts: RenderSessionOptions = {}
  ) => (
    <SortableList
      items={sessionList.map(s => s.id)}
      onReorder={ordered => onReorderSessions(project.id, ordered)}
      className={className}
    >
      {sessionList.map(session => (
        <SortableItem key={session.id} id={session.id} dragHandleClassName="w-3 h-3 -ml-0.5 mr-0.5">
          {renderSession(session, sessionOpts)}
        </SortableItem>
      ))}
    </SortableList>
  );

  const hasSupervisor = Boolean(supervisorAgent && supervisorAgent.phase !== 'archived');
  const { mainSession, taskSessions, regularSessions } = splitProjectSessions(
    sessions,
    hasSupervisor,
    supervisorAgent?.mainSessionId
  );
  const supervisorSessionId = hasSupervisor
    ? (supervisorAgent?.mainSessionId ?? mainSession?.id)
    : undefined;
  const phaseDot = hasSupervisor
    ? (PHASE_DOT[supervisorAgent?.phase ?? 'idle'] ?? PHASE_DOT.idle)
    : undefined;
  const regularSessionIds = new Set(regularSessions.map(session => session.id));
  const groups = groupSessionsByWorktree(sessions, project.rootPath, worktrees)
    .map(group => ({
      ...group,
      sessions: group.sessions.filter(session => regularSessionIds.has(session.id)),
    }))
    .filter(group => group.sessions.length > 0);

  const renderRegularSessions = () => {
    if (regularSessions.length === 0) return null;
    if (groups.length === 0) {
      return renderSortableSessions(regularSessions);
    }
    return groups.map(group => {
      const matchedWorktree = group.isRoot
        ? null
        : (worktrees.find(wt => normalizePath(wt.path) === normalizePath(group.key)) ?? null);
      const canDeleteWorktree = Boolean(
        matchedWorktree && !matchedWorktree.isMain && matchedWorktree.managedBy !== 'supervisor'
      );
      const onDelete = matchedWorktree
        ? () => onDeleteWorktree(project.id, matchedWorktree.path, matchedWorktree.branch)
        : undefined;

      // Single-session worktrees collapse to a plain session row — no group
      // header, no expand step. The row carries the git branch label, and the
      // remove-worktree action moves onto the row's hover affordance.
      if (group.sessions.length === 1) {
        const session = group.sessions[0];
        return (
          <div key={group.key} className="mt-0.5">
            {renderSession(session, {
              // Root worktree gets no branch tag; named worktrees show the git
              // branch (e.g. "feat/my-test") for consistency with group headers.
              worktreeBranchOverride: group.isRoot ? undefined : group.branchName || group.label,
              onDeleteWorktree: canDeleteWorktree ? onDelete : undefined,
            })}
          </div>
        );
      }

      return (
        <WorktreeGroupItem
          key={group.key}
          group={group}
          isExpanded={expandedWorktrees.has(`${project.id}:${group.key}`)}
          onToggle={() => onToggleWorktree(`${project.id}:${group.key}`)}
          isMobile={isMobile}
          canDelete={canDeleteWorktree}
          onDelete={onDelete}
        >
          {/* Branch shown once on the group header — suppress it on each child row. */}
          {renderSortableSessions(group.sessions, 'space-y-0.5', { hideWorktreeBranch: true })}
        </WorktreeGroupItem>
      );
    });
  };

  return (
    <>
      <div className="flex items-center group relative">
        <button onClick={onToggle} className={projectButtonClass}>
          {isExpanded ? (
            <FolderOpen
              className="w-4 h-4 flex-shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
          ) : (
            <Folder className="w-4 h-4 flex-shrink-0 text-muted-foreground" strokeWidth={1.75} />
          )}
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {project.name}
          </span>
          {isExpanded ? (
            <ChevronDown
              className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/70"
              strokeWidth={2}
            />
          ) : (
            <ChevronRight
              className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/70"
              strokeWidth={2}
            />
          )}
        </button>
        {/* Supervisor phase — shown at rest, yields to the hover actions */}
        {phaseDot && (
          <span
            className="flex group-hover:hidden items-center gap-1 pr-1 shrink-0"
            aria-label={`Workspace ${phaseDot.label}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${phaseDot.dot}`} />
            <span className="text-[10px] text-muted-foreground/60">{phaseDot.label}</span>
          </span>
        )}
        {/* Project menu button */}
        <button
          onClick={e => onOpenContextMenu(e, 'project', project.id)}
          className={menuButtonClass}
          aria-label="Project menu"
        >
          <svg
            className="w-3.5 h-3.5 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
            />
          </svg>
        </button>
        {/* New session — placed last */}
        <button
          onClick={() => onStartCreatingSession()}
          disabled={!isConnected}
          className={`${menuButtonClass} disabled:cursor-not-allowed`}
          title="New session"
          aria-label="New session"
        >
          <Plus className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={2} />
        </button>

        {/* Project context menu */}
        {contextMenuProject === project.id &&
          contextMenuPos &&
          createPortal(
            <>
              <div className="fixed inset-0 z-40" onClick={onCloseContextMenu} />
              <div
                className={menuContainerClass}
                style={{ top: contextMenuPos.top, left: contextMenuPos.left }}
              >
                <button
                  onClick={() => {
                    onSettingsProject(project.id);
                    onCloseContextMenu();
                  }}
                  className={menuItemClass}
                >
                  <Settings
                    className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                  Settings
                </button>
                <button
                  onClick={() => onDeleteProject(project.id, project.name)}
                  className={menuDeleteClass}
                >
                  <Trash2 className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
                  Delete
                </button>
              </div>
            </>,
            document.body
          )}
      </div>

      {/* Sessions — a left guide rail fades in only while this region is hovered */}
      {isExpanded && (
        <div
          className="ml-1 mt-0.5 pl-2 border-l border-transparent hover:border-border/60 transition-colors"
          data-testid="session-list"
        >
          {hasSupervisor && (
            <ProjectWorkspaceItem
              key={supervisorSessionId ?? `${project.id}:supervisor`}
              onSelect={() => {
                if (onOpenDashboard) onOpenDashboard(project.id);
              }}
              isSelected={!!supervisorSessionId && selectedSessionId === supervisorSessionId}
              isActive={!!supervisorSessionId && activeRunSessionIds.has(supervisorSessionId)}
              taskCount={taskSessions.length}
              taskChildren={taskSessions.length > 0 ? renderSortableSessions(taskSessions) : null}
            />
          )}
          {/* Worktree groups already convey structure + counts, so under a
              supervisor we render them directly and drop the redundant
              "SESSIONS N" header. The header (a collapse-all toggle) is only
              useful for the flat, ungrouped list. */}
          {regularSessions.length > 0 && hasSupervisor && groups.length > 0 && (
            <div className="mt-1">{renderRegularSessions()}</div>
          )}
          {regularSessions.length > 0 && hasSupervisor && groups.length === 0 && (
            <div className="mt-1">
              <button
                onClick={onToggleRegularSessions}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Sessions
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                  {regularSessions.length}
                </span>
                <svg
                  className={`ml-auto w-2.5 h-2.5 opacity-40 transition-transform duration-200 ${!regularSessionsCollapsed ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
              {!regularSessionsCollapsed && <div className="mt-0.5">{renderRegularSessions()}</div>}
            </div>
          )}
          {!hasSupervisor && renderRegularSessions()}
        </div>
      )}
    </>
  );
}

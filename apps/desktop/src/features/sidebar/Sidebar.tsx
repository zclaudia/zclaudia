import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSwipeBack } from '../../hooks/useSwipeBack';
import { ProjectSettings } from '../settings/ProjectSettings';
import { SettingsPanel } from '../../components/SettingsPanel';
import { ActiveSessionsPanel } from '../../components/ActiveSessionsPanel';
import { PluginPermissionDialog } from '../../components/permission/PluginPermissionDialog';
import { SortableList, SortableItem } from '../../components/SortableList';

import { useSearchSidebar } from './useSearchSidebar';
import { groupSessionsByWorktree as groupSessionsByWorktreeFn } from './worktreeGrouping';
import { SidebarTopBar } from './SidebarTopBar';
import { SidebarNav } from './SidebarNav';
import { MobileSidebarHeader } from './MobileSidebarHeader';
import { SidebarSearch } from './SidebarSearch';
import { SearchModal } from './SearchModal';
import { ProjectListItem } from './ProjectListItem';
import { BackendRow } from './BackendRow';
import { useOnlineBackends } from './onlineBackends';
import { useBackendConnectionLifecycle } from './useBackendConnectionLifecycle';
import { useSidebarExpansionStore } from '../../stores/sidebarExpansionStore';
import { NewProjectForm } from './NewProjectForm';
import { SidebarFooter } from './SidebarFooter';
import { useSidebarData } from './useSidebarData';
import { useSidebarActions } from './useSidebarActions';
import { useAgentProfileMetaStore } from '../../stores/agentProfileMetaStore';
import { useSidebarWidthStore, SIDEBAR_WIDTH_LIMITS } from '../../stores/sidebarWidthStore';
import { useAgentReadinessStore } from '../../stores/agentReadinessStore';
import { AgentRequiredDialog } from '../agent/AgentRequiredDialog';
import type { AgentReadinessReason } from '@zclaudia/shared/core/agent-readiness';
import type { SettingsTab } from '../settings/settingsTabDefs';

import * as api from '../../services/api';
import type { GitWorktree } from '@zclaudia/shared';
import type { WorktreeGroup } from './worktreeGrouping';
import { runWithToast } from '../git/runWithToast';

function agentReadinessReasonFromDetails(details: unknown): AgentReadinessReason | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const reason = (details as { reason?: unknown }).reason;
  return reason === 'no_agent' || reason === 'no_llm_profile' || reason === 'no_credential' || reason === 'no_model'
    ? reason
    : undefined;
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  onOpenDashboard?: (projectId: string) => void;
  onOpenAutomations?: () => void;
  /** Navigate to the welcome screen (deselect session + exit any dashboard). */
  onHome: () => void;
  /** Whether the welcome screen is currently showing. */
  isHomeActive: boolean;
  onOpenNotifications?: () => void;
  isNotificationsOpen?: boolean;
  disableNotifications?: boolean;
  /** Optionally control the desktop search popover from outside (e.g. so the
   *  collapsed top bar can open search after expanding). Uncontrolled if absent. */
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
}

export function Sidebar({
  collapsed,
  onToggle,
  isMobile,
  isOpen,
  onClose,
  onOpenDashboard,
  onOpenAutomations,
  onHome,
  isHomeActive,
  onOpenNotifications,
  isNotificationsOpen = false,
  disableNotifications = false,
  searchOpen: searchOpenProp,
  onSearchOpenChange,
}: SidebarProps) {
  const data = useSidebarData();
  const {
    sessions,
    visibleProjects,
    visibleSessions,
    filteredProjects,
    getProjectsForBackend,
    selectedSessionId,
    isConnected,
    supervisorAgents,
    notificationUnreadCount,
    hasClaudiaUnread,
    hasClaudiaRunning,
    hasClaudiaPermissionPending,
    isClaudiaExpanded,
    setClaudiaExpanded,
    hasPendingForSession,
    activeRunSessionIds,
    sessionsByProject,
    getFilteredSessionsForProject,
    getProviderName,
    getWorktreeBranch,
    addProject,
    addSession,
    deleteProject,
    storeReorderProjects,
    storeReorderSessions,
  } = data;

  const onlineBackends = useOnlineBackends();
  const expandedBackendIds = useSidebarExpansionStore((s) => s.expandedBackendIds);
  const toggleBackend = useSidebarExpansionStore((s) => s.toggleBackend);
  const expandBackend = useSidebarExpansionStore((s) => s.expandBackend);
  const autoExpandedRef = useRef(false);

  // Lazily connect/disconnect remote backends as their rows expand/collapse.
  useBackendConnectionLifecycle();

  // Auto-expand the first online backend once per session if nothing is expanded
  // (single-backend users see their projects immediately; doesn't fight manual collapse).
  useEffect(() => {
    if (autoExpandedRef.current) return;
    if (expandedBackendIds.length === 0 && onlineBackends.length > 0) {
      autoExpandedRef.current = true;
      expandBackend(onlineBackends[0].backendId);
    }
  }, [expandedBackendIds.length, onlineBackends, expandBackend]);

  // --- Local state ---
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRootPath, setNewProjectRootPath] = useState('');
  const [newProjectBackendId, setNewProjectBackendId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingSessionForProject, setCreatingSessionForProject] = useState<string | null>(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionAgentProfileId, setNewSessionAgentProfileId] = useState<string>('');
  const [contextMenuProject, setContextMenuProject] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const refreshReadiness = useAgentReadinessStore((s) => s.refresh);
  const [agentDialogReason, setAgentDialogReason] = useState<AgentReadinessReason | undefined>(undefined);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
  const search = useSearchSidebar();
  // Controlled-or-uncontrolled search popover state.
  const [internalSearchOpen, setInternalSearchOpen] = useState(false);
  const searchOpen = searchOpenProp ?? internalSearchOpen;
  const setSearchOpen = useCallback((open: boolean) => {
    if (onSearchOpenChange) onSearchOpenChange(open);
    else setInternalSearchOpen(open);
  }, [onSearchOpenChange]);

  // Resizable width (desktop) — mirrors the right sidebar's drag handle.
  const sidebarWidth = useSidebarWidthStore((s) => s.widthPx);
  const setSidebarWidth = useSidebarWidthStore((s) => s.setWidth);
  const resizeDragging = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanupRef.current?.(), []);
  const onResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    resizeDragging.current = true;
    resizeStartX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
    resizeStartWidth.current = useSidebarWidthStore.getState().widthPx;
    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!resizeDragging.current) return;
      const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      // Handle is on the right edge: dragging right widens the sidebar.
      setSidebarWidth(resizeStartWidth.current + (clientX - resizeStartX.current));
    };
    const cleanup = () => {
      resizeDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      resizeCleanupRef.current = null;
    };
    const onUp = () => cleanup();
    resizeCleanupRef.current = cleanup;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onUp);
  }, [setSidebarWidth]);
  const [expandedWorktrees, setExpandedWorktrees] = useState<Set<string>>(new Set());
  const [regularSessionsCollapsed, setRegularSessionsCollapsed] = useState<Set<string>>(new Set());
  const [worktreesByProject, setWorktreesByProject] = useState<Map<string, GitWorktree[]>>(new Map());

  // Fetch agent readiness whenever the connection is established.
  useEffect(() => {
    if (isConnected) void refreshReadiness();
  }, [isConnected, refreshReadiness]);

  // Default the new-project backend to the first online backend when the form opens.
  useEffect(() => {
    if (showNewProjectForm && !newProjectBackendId && onlineBackends.length > 0) {
      setNewProjectBackendId(onlineBackends[0].backendId);
    }
  }, [showNewProjectForm, newProjectBackendId, onlineBackends]);

  // Focus the search input when the desktop search popover opens.
  useEffect(() => {
    if (!searchOpen) return;
    const id = setTimeout(() => search.searchInputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [searchOpen, search.searchInputRef]);

  const refreshProjectWorktrees = useCallback(async (projectId: string) => {
    try {
      const worktrees = await api.getProjectWorktrees(projectId);
      setWorktreesByProject(prev => new Map(prev).set(projectId, worktrees));
    } catch {
      setWorktreesByProject(prev => new Map(prev).set(projectId, []));
    }
  }, []);

  // --- Agent profile dropdown source ---
  // Lazily load agent profiles for the new-session dropdown.
  const agentProfiles = useAgentProfileMetaStore((s) => s.profiles);
  const agentLoaded = useAgentProfileMetaStore((s) => s.loaded);
  const agentLoading = useAgentProfileMetaStore((s) => s.loading);
  const loadAllAgents = useAgentProfileMetaStore((s) => s.loadAll);
  useEffect(() => {
    if (!agentLoaded && !agentLoading) {
      void loadAllAgents();
    }
  }, [agentLoaded, agentLoading, loadAllAgents]);
  const agents = Object.values(agentProfiles);

  const showAgentRequiredDialog = useCallback((reason: AgentReadinessReason | undefined) => {
    setAgentDialogReason(reason);
    setAgentDialogOpen(true);
  }, []);

  // --- Actions ---
  const actions = useSidebarActions({
    isConnected,
    isMobile,
    onClose,
    addProject,
    addSession,
    deleteProject,
    storeReorderProjects,
    storeReorderSessions,
    getFilteredSessionsForProject,
    setExpandedProjects,
    setNewProjectName,
    setNewProjectRootPath,
    setShowNewProjectForm,
    setNewSessionName,
    setNewSessionAgentProfileId,
    setCreatingSessionForProject,
    setCreatingProject,
    setContextMenuProject,
    newProjectName,
    newProjectRootPath,
    newSessionName,
    newSessionAgentProfileId,
    onAgentNotReady: (details) => {
      showAgentRequiredDialog(agentReadinessReasonFromDetails(details));
      void refreshReadiness();
    },
  });

  const settingsProject = settingsProjectId ? visibleProjects.find(p => p.id === settingsProjectId) || null : null;

  // --- Worktree logic ---
  useEffect(() => {
    for (const projectId of expandedProjects) {
      if (!worktreesByProject.has(projectId)) {
        refreshProjectWorktrees(projectId).catch(() => {});
      }
    }
  }, [expandedProjects, worktreesByProject, refreshProjectWorktrees]);

  const getWorktreeGroupsForProject = useCallback((projectId: string): WorktreeGroup[] => {
    const projectSessions = sessionsByProject.get(projectId) || [];
    const project = visibleProjects.find(p => p.id === projectId);
    const worktrees = worktreesByProject.get(projectId) || [];
    return groupSessionsByWorktreeFn(projectSessions, project?.rootPath, worktrees);
  }, [sessionsByProject, visibleProjects, worktreesByProject]);

  const toggleWorktree = useCallback((key: string) => {
    setExpandedWorktrees(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;
    const session = visibleSessions.find(s => s.id === selectedSessionId);
    if (!session) return;
    const groups = getWorktreeGroupsForProject(session.projectId);
    if (groups.length === 0) return;
    for (const group of groups) {
      if (group.sessions.some(s => s.id === selectedSessionId)) {
        const wtKey = `${session.projectId}:${group.key}`;
        setExpandedWorktrees(prev => {
          if (prev.has(wtKey)) return prev;
          return new Set(prev).add(wtKey);
        });
        break;
      }
    }
  }, [selectedSessionId, visibleSessions, getWorktreeGroupsForProject]);

  const toggleRegularSessions = useCallback((projectId: string) => {
    setRegularSessionsCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const handleDeleteWorktree = useCallback(async (projectId: string, worktreePath: string, branchName?: string) => {
    const label = branchName || worktreePath;
    const confirmed = window.confirm(
      `Remove worktree at "${worktreePath}"? This deletes the directory and the local branch "${label}".`,
    );
    if (!confirmed) return;

    const result = await runWithToast(`Remove worktree '${label}'`, projectId, () =>
      api.deleteProjectWorktree(projectId, worktreePath),
    );
    if (result === null) return;
    await refreshProjectWorktrees(projectId);
  }, [refreshProjectWorktrees]);

  const toggleProject = (projectId: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId);
    } else {
      newExpanded.add(projectId);
    }
    setExpandedProjects(newExpanded);
  };

  const openContextMenu = (e: React.MouseEvent, _type: 'project', id: string) => {
    e.stopPropagation();
    const clickX = e.clientX;
    const clickY = e.clientY;
    const menuWidth = isMobile ? 176 : 144;
    const menuHeight = isMobile ? 190 : 140;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const margin = 8;

    let top = clickY + 6;
    if (top + menuHeight > viewportH - margin) {
      top = clickY - menuHeight - 6;
    }
    top = Math.max(margin, Math.min(top, viewportH - menuHeight - margin));

    let left = clickX - menuWidth + 12;
    left = Math.max(margin, Math.min(left, viewportW - menuWidth - margin));

    setContextMenuPos({ top, left });
    setContextMenuProject(contextMenuProject === id ? null : id);
  };

  const sidebarSwipeRef = useSwipeBack({
    onSwipe: () => onClose?.(),
    enabled: isMobile && !!isOpen,
    direction: 'left',
    fullWidth: true,
    threshold: 60,
  });

  // Returns true if creation may proceed; otherwise opens the guidance dialog.
  // Refresh when readiness is unknown or currently unusable so first-load/null
  // readiness cannot fail open, while known-good state keeps the UI instant.
  const ensureAgentGate = useCallback(async (): Promise<boolean> => {
    await refreshReadiness();
    const latest = useAgentReadinessStore.getState().readiness;
    if (latest?.usable !== false) return true;
    showAgentRequiredDialog(latest.reason);
    return false;
  }, [refreshReadiness, showAgentRequiredDialog]);

  const runAfterAgentGate = useCallback((action: () => void | Promise<void>, options?: { forceRefresh?: boolean }) => {
    if (!options?.forceRefresh && useAgentReadinessStore.getState().readiness?.usable === true) {
      void action();
      return;
    }
    void ensureAgentGate().then((ok) => {
      if (ok) void action();
    });
  }, [ensureAgentGate]);

  // --- Shared renderers ---
  const renderProjectItems = (backendProjects: typeof filteredProjects) => (
    <SortableList
      items={backendProjects.map((p) => p.id)}
      onReorder={actions.handleReorderProjects}
      className="space-y-2"
    >
      {backendProjects.map((project) => (
        <SortableItem
          key={project.id}
          id={project.id}
          wrapperClassName="items-start"
          dragHandleClassName="w-4 h-4 -ml-1 mr-0.5 mt-2"
        >
              <ProjectListItem
                project={project}
                isExpanded={expandedProjects.has(project.id)}
                onToggle={() => toggleProject(project.id)}
                sessions={getFilteredSessionsForProject(project.id)}
                selectedSessionId={selectedSessionId}
                onSelectSession={actions.handleSessionSelect}
                onOpenDashboard={isMobile ? (pid) => { onOpenDashboard?.(pid); onClose?.(); } : onOpenDashboard}
                hasPendingForSession={hasPendingForSession}
                activeRunSessionIds={activeRunSessionIds}
                getProviderName={getProviderName}
                getWorktreeBranch={getWorktreeBranch}
                supervisorAgent={supervisorAgents[project.id]}
                worktrees={worktreesByProject.get(project.id) || []}
                expandedWorktrees={expandedWorktrees}
                onToggleWorktree={toggleWorktree}
                onDeleteWorktree={handleDeleteWorktree}
                regularSessionsCollapsed={regularSessionsCollapsed.has(project.id)}
                onToggleRegularSessions={() => toggleRegularSessions(project.id)}
                onReorderSessions={actions.handleReorderSessions}
                isMobile={isMobile}
                contextMenuProject={contextMenuProject}
                contextMenuPos={contextMenuPos}
                onOpenContextMenu={openContextMenu}
                onCloseContextMenu={() => setContextMenuProject(null)}
                onSettingsProject={setSettingsProjectId}
                onDeleteProject={actions.handleDeleteProject}
                isCreatingSession={creatingSessionForProject === project.id}
                newSessionName={newSessionName}
                onNewSessionNameChange={setNewSessionName}
                newSessionAgentProfileId={newSessionAgentProfileId}
                onNewSessionAgentProfileIdChange={setNewSessionAgentProfileId}
                onStartCreatingSession={() => {
                  runAfterAgentGate(() => setCreatingSessionForProject(project.id));
                }}
                onCreateSession={() => {
                  runAfterAgentGate(() => actions.handleCreateSession(project.id), { forceRefresh: true });
                }}
                onCancelCreateSession={() => {
                  setCreatingSessionForProject(null);
                  setNewSessionName('');
                  setNewSessionAgentProfileId('');
                }}
                isConnected={isConnected}
                agents={agents}
                onPopOutSession={actions.handlePopOutSession}
              />
        </SortableItem>
      ))}
    </SortableList>
  );

  const renderProjectList = () => (
    <>
      {onlineBackends.length === 0 ? (
        <p className="text-sm text-muted-foreground px-2">No backends online</p>
      ) : (
        <div className="space-y-2">
          {onlineBackends.map((backend) => {
            const backendProjects = getProjectsForBackend(backend.backendId);
            const expanded = expandedBackendIds.includes(backend.backendId);
            return (
              <div key={backend.backendId} className="space-y-1">
                <BackendRow
                  name={backend.name}
                  online={backend.online}
                  expanded={expanded}
                  onToggle={() => toggleBackend(backend.backendId)}
                  onNewProject={() => runAfterAgentGate(() => {
                    setNewProjectBackendId(backend.backendId);
                    setShowNewProjectForm(true);
                  })}
                  newProjectDisabled={!isConnected}
                >
                  {backendProjects.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet</p>
                  ) : (
                    renderProjectItems(backendProjects)
                  )}
                </BackendRow>
                {showNewProjectForm && newProjectBackendId === backend.backendId && (
                  <div className="pl-3">
                    <NewProjectForm
                      showForm
                      onShowForm={(show: boolean) => { if (!show) setShowNewProjectForm(false); }}
                      newProjectName={newProjectName}
                      onProjectNameChange={setNewProjectName}
                      newProjectRootPath={newProjectRootPath}
                      onProjectRootPathChange={setNewProjectRootPath}
                      onCreateProject={() => runAfterAgentGate(() => actions.handleCreateProject(backend.backendId), { forceRefresh: true })}
                      creatingProject={creatingProject}
                      isConnected={isConnected}
                      isMobile={isMobile}
                      backends={[backend]}
                      selectedBackendId={backend.backendId}
                      onSelectedBackendIdChange={setNewProjectBackendId}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  const renderPortaledModals = () => (
    <>
      {!!settingsProjectId && createPortal(
        <ProjectSettings
          project={settingsProject}
          isOpen={!!settingsProjectId}
          onClose={() => setSettingsProjectId(null)}
        />,
        document.body
      )}
      {showSettings && createPortal(
        <SettingsPanel
          isOpen={showSettings}
          initialTab={settingsInitialTab}
          onClose={() => { setShowSettings(false); setSettingsInitialTab(undefined); void refreshReadiness(); }}
        />,
        document.body
      )}
      {agentDialogOpen && createPortal(
        <AgentRequiredDialog
          open={agentDialogOpen}
          reason={agentDialogReason}
          onClose={() => setAgentDialogOpen(false)}
          onConfigure={(tab) => {
            setAgentDialogOpen(false);
            setSettingsInitialTab(tab);
            setShowSettings(true);
          }}
        />,
        document.body,
      )}
      {createPortal(<PluginPermissionDialog />, document.body)}
    </>
  );

  // Mobile: render as overlay drawer
  if (isMobile) {
    if (!isOpen) return null;

    return (
      <>
        <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
        <div ref={sidebarSwipeRef} className="fixed inset-y-0 left-0 w-64 bg-card/80 glass z-50 shadow-apple-xl flex flex-col safe-top-pad safe-bottom-pad">
          <MobileSidebarHeader
            onClose={onClose}
            onOpenNotifications={onOpenNotifications}
            isNotificationsOpen={isNotificationsOpen}
            notificationUnreadCount={notificationUnreadCount}
            isClaudiaExpanded={isClaudiaExpanded}
            setClaudiaExpanded={setClaudiaExpanded}
            hasClaudiaPermissionPending={hasClaudiaPermissionPending}
            hasClaudiaUnread={hasClaudiaUnread}
            hasClaudiaRunning={hasClaudiaRunning}
          />

          <SidebarSearch
            search={search}
            isMobile
            sessions={sessions}
            onResultSelect={actions.handleSearchResultSelect}
          />

          <SidebarNav
            onHome={() => { onHome(); onClose?.(); }}
            isHomeActive={isHomeActive}
            isMobile
          />

          <div className="flex-1 overflow-y-auto scrollbar-hidden p-2">
            {renderProjectList()}
          </div>

          <div className="flex-shrink-0">
            <ActiveSessionsPanel
              onSessionSelect={(backendId, sessionId) => {
                actions.handleActiveSessionSelect(backendId, sessionId);
                if (onClose) onClose();
              }}
            />
          </div>

          <SidebarFooter
            onShowSettings={() => setShowSettings(true)}
            isMobile
          />
        </div>

        {renderPortaledModals()}
      </>
    );
  }

  // Desktop — collapsed: the rail is replaced by a full-width top bar rendered
  // in App, so the sidebar renders only its portaled modals here.
  if (collapsed) {
    return renderPortaledModals();
  }

  // Desktop — expanded
  const clampedSidebarWidth = Math.max(
    SIDEBAR_WIDTH_LIMITS.MIN_WIDTH_PX,
    Math.min(
      (typeof window !== 'undefined' ? window.innerWidth : 1920) * (SIDEBAR_WIDTH_LIMITS.MAX_WIDTH_VW / 100),
      sidebarWidth,
    ),
  );
  return (
    <>
    <div
      className="relative flex flex-shrink-0 flex-col border-r border-border/50 bg-[hsl(var(--sidebar))]"
      style={{ width: clampedSidebarWidth }}
    >
      {/* Resize handle on the right edge */}
      <div
        className="absolute top-0 right-0 z-20 h-full w-1 cursor-ew-resize hover:bg-muted"
        onMouseDown={onResizeStart}
        onTouchStart={onResizeStart}
        aria-hidden
      />
      <div className="relative z-50 flex-shrink-0">
        <SidebarTopBar
          onToggle={onToggle}
          onOpenSearch={() => setSearchOpen(!searchOpen)}
          isSearchOpen={searchOpen}
          onOpenNotifications={onOpenNotifications}
          isNotificationsOpen={isNotificationsOpen}
          notificationUnreadCount={notificationUnreadCount}
          disableNotifications={disableNotifications}
        />
      </div>

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        search={search}
        sessions={sessions}
        onResultSelect={(sessionId, messageId, ownerBackendId) => {
          actions.handleSearchResultSelect(sessionId, messageId, ownerBackendId);
          setSearchOpen(false);
        }}
      />

      <SidebarNav
        onHome={onHome}
        isHomeActive={isHomeActive}
        onOpenAutomations={onOpenAutomations}
      />

      <div className="flex-1 overflow-y-auto scrollbar-hidden p-2">
        {renderProjectList()}
      </div>

      <div className="flex-shrink-0">
        <ActiveSessionsPanel
          onSessionSelect={actions.handleActiveSessionSelect}
        />
      </div>

      <SidebarFooter
        onShowSettings={() => setShowSettings(true)}
      />
    </div>
    {renderPortaledModals()}
    </>
  );
}

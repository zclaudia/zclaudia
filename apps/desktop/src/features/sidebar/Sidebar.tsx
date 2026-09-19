import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import { SidebarTopBar } from './SidebarTopBar';
import { SidebarNav } from './SidebarNav';
import type { AutomationTab } from '../automation/automation-types';
import type { AgentsTab } from '../agents/agents-types';
import type { PluginsTab } from '../plugins/plugins-types';
import { MobileSidebarHeader } from './MobileSidebarHeader';
import { SearchModal } from './SearchModal';
import { ProjectListItem } from './ProjectListItem';
import { BackendRow } from './BackendRow';
import { SortableList, SortableItem } from '../../components/SortableList';
import { useSearchSidebar } from './useSearchSidebar';
import { useOnlineBackends } from './onlineBackends';
import { useBackendConnectionLifecycle } from './useBackendConnectionLifecycle';
import { useFacadeStore } from '../../stores/facadeStore';
import { useServerStore } from '../../stores/serverStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { resolveCanonicalBackendId } from '../../actions/controlPlane';
import { getMobileBackendViewState } from '../../services/mobileConnectionState';
import { useSidebarExpansionStore } from '../../stores/sidebarExpansionStore';
import { SidebarFooter } from './SidebarFooter';
import { useSidebarData } from './useSidebarData';
import { useSidebarActions } from './useSidebarActions';
import { useAgentProfileMetaStore } from '../../stores/agentProfileMetaStore';
import { SIDEBAR_WIDTH_LIMITS } from '../../stores/sidebarWidthStore';
import { useHomeQuickActionsStore } from '../../stores/homeQuickActionsStore';
import type { SettingsTab } from '../settings';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { claudiaSidebarStatus, computeContextMenuPosition, getNoBackendsMessage } from './derive';
import { useMobileDrawerFocus } from './useMobileDrawerFocus';
import { useSidebarResize } from './useSidebarResize';
import { useProjectWorktrees } from './useProjectWorktrees';
import { useAgentGate } from './useAgentGate';
import { useNewProjectForm } from './useNewProjectForm';
import { useNewSessionModal } from './useNewSessionModal';
import { SidebarPortaledModals } from './SidebarPortaledModals';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  drawerPanelRef?: RefObject<HTMLDivElement | null>;
  drawerBackdropRef?: RefObject<HTMLDivElement | null>;
  onOpenDashboard?: (projectId: string) => void;
  onOpenAutomations?: () => void;
  /** When present, the sidebar renders in automation mode (tab nav only —
   *  backend / project scope lives in the content pane, like agents mode). */
  automationMode?: {
    tab: AutomationTab;
    onSelectTab: (tab: AutomationTab) => void;
    onBack: () => void;
  };
  onOpenAgents?: () => void;
  /** When present, the sidebar renders in agents mode (tab nav only). */
  agentsMode?: {
    tab: AgentsTab;
    onSelectTab: (tab: AgentsTab) => void;
    onBack: () => void;
  };
  onOpenPlugins?: () => void;
  /** When present, the sidebar renders in plugins mode (tab nav only). */
  pluginsMode?: {
    tab: PluginsTab;
    onSelectTab: (tab: PluginsTab) => void;
    onBack: () => void;
  };
  onOpenSettings?: (initialTab?: SettingsTab) => void;
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
  drawerPanelRef,
  drawerBackdropRef,
  onOpenDashboard,
  onOpenAutomations,
  automationMode,
  onOpenAgents,
  agentsMode,
  onOpenPlugins,
  pluginsMode,
  onOpenSettings,
  onHome,
  isHomeActive,
  onOpenNotifications,
  isNotificationsOpen = false,
  disableNotifications = false,
  searchOpen: searchOpenProp,
  onSearchOpenChange,
}: SidebarProps) {
  const { panelRef: mobileDrawerPanelRef, handleDrawerKeyDown } = useMobileDrawerFocus({
    isMobile,
    isOpen,
    onClose,
    drawerPanelRef,
  });
  const data = useSidebarData();
  const topLevelViewKind = useTopLevelViewStore(s => s.view.kind);
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
  // The tree is the app's only backend surface, so it owns switching and shows
  // the full connection state (there is no separate backend picker).
  const backendActiveId = resolveCanonicalBackendId(data.activeServerId, data.localBackendId);
  const facadeConnectionState = useFacadeStore(s => s.connectionState);
  const facadeBackends = useFacadeStore(s => s.backends);
  const serverConnections = useServerStore(s => s.connections);
  const directGatewayUrl = useGatewayStore(s => s.directGatewayUrl);
  const selectionCoordinator = useSelectionCoordinator();
  const expandedBackendIds = useSidebarExpansionStore(s => s.expandedBackendIds);
  const toggleBackend = useSidebarExpansionStore(s => s.toggleBackend);
  const expandBackend = useSidebarExpansionStore(s => s.expandBackend);
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
  const newProject = useNewProjectForm(onlineBackends);
  const {
    name: newProjectName,
    setName: setNewProjectName,
    rootPath: newProjectRootPath,
    setRootPath: setNewProjectRootPath,
    backendId: newProjectBackendId,
    setBackendId: setNewProjectBackendId,
    setCreating: setCreatingProject,
    setShow: setShowNewProjectForm,
  } = newProject;
  const newSession = useNewSessionModal();
  const {
    setName: setNewSessionName,
    setAgentProfileId: setNewSessionAgentProfileId,
    setRequest: setNewSessionRequest,
  } = newSession;
  const [contextMenuProject, setContextMenuProject] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const {
    agentDialogOpen,
    agentDialogReason,
    setAgentDialogOpen,
    runAfterAgentGate,
    handleAgentNotReady,
  } = useAgentGate({ isConnected });
  const search = useSearchSidebar();
  // Controlled-or-uncontrolled search popover state.
  const [internalSearchOpen, setInternalSearchOpen] = useState(false);
  const searchOpen = searchOpenProp ?? internalSearchOpen;
  const setSearchOpen = useCallback(
    (open: boolean) => {
      if (onSearchOpenChange) onSearchOpenChange(open);
      else setInternalSearchOpen(open);
    },
    [onSearchOpenChange]
  );

  // Resizable width (desktop) — mirrors the right sidebar's drag handle.
  const { sidebarWidth, onResizeStart, onResizeKeyDown } = useSidebarResize();

  // Worktree grouping + removal flows for the project tree.
  const {
    worktreesByProject,
    expandedWorktrees,
    toggleWorktree,
    regularSessionsCollapsed,
    toggleRegularSessions,
    handleDeleteWorktree,
  } = useProjectWorktrees({
    expandedProjects,
    selectedSessionId,
    visibleSessions,
    visibleProjects,
    sessionsByProject,
  });

  // Focus the search input when the desktop search popover opens.
  useEffect(() => {
    if (!searchOpen) return;
    const id = setTimeout(() => search.searchInputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [searchOpen, search.searchInputRef]);

  // --- Agent profile dropdown source ---
  // Lazily load agent profiles for the new-session dropdown.
  const agentProfiles = useAgentProfileMetaStore(s => s.profiles);
  const agentLoaded = useAgentProfileMetaStore(s => s.loaded);
  const agentLoading = useAgentProfileMetaStore(s => s.loading);
  const loadAllAgents = useAgentProfileMetaStore(s => s.loadAll);
  useEffect(() => {
    if (!agentLoaded && !agentLoading) {
      void loadAllAgents();
    }
  }, [agentLoaded, agentLoading, loadAllAgents]);
  // Exclude read-only agents — they're frozen and not selectable for new sessions.
  const agents = Object.values(agentProfiles).filter(a => a.status !== 'readonly');

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
    setCreatingSessionForProject: (projectId: string | null) =>
      setNewSessionRequest(projectId ? { projectId, pickerEnabled: false } : null),
    setCreatingProject,
    setContextMenuProject,
    newProjectName,
    newProjectRootPath,
    newSessionName: newSession.name,
    newSessionAgentProfileId: newSession.agentProfileId,
    onAgentNotReady: handleAgentNotReady,
  });

  const settingsProject = settingsProjectId
    ? visibleProjects.find(p => p.id === settingsProjectId) || null
    : null;

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
    // Anchor to the trigger, not the click point — the menu should hang off the
    // row like a standard dropdown (see computeContextMenuPosition for the
    // flip/clamp rules).
    const btn = e.currentTarget.getBoundingClientRect();
    const row = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect();
    setContextMenuPos(computeContextMenuPosition(btn, row, isMobile));
    setContextMenuProject(contextMenuProject === id ? null : id);
  };

  // Home-page quick actions: the Sidebar owns the new-session modal and the
  // inline new-project form, so Home requests them through the bridge store.
  const pendingQuickAction = useHomeQuickActionsStore(s => s.pending);
  useEffect(() => {
    if (!pendingQuickAction) return;
    const action = useHomeQuickActionsStore.getState().consume();
    if (action === 'new-session') {
      runAfterAgentGate(() => setNewSessionRequest({ projectId: null, pickerEnabled: true }));
    } else if (action === 'new-project') {
      setShowNewProjectForm(true);
    }
  }, [pendingQuickAction, runAfterAgentGate]);

  // --- Shared renderers ---
  const renderProjectItems = (backendProjects: typeof filteredProjects) => (
    <SortableList
      items={backendProjects.map(p => p.id)}
      onReorder={actions.handleReorderProjects}
      className="space-y-2"
    >
      {backendProjects.map(project => (
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
            onOpenDashboard={
              isMobile
                ? pid => {
                    onOpenDashboard?.(pid);
                    onClose?.();
                  }
                : onOpenDashboard
            }
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
            onStartCreatingSession={() => {
              runAfterAgentGate(() =>
                setNewSessionRequest({ projectId: project.id, pickerEnabled: false })
              );
            }}
            isConnected={isConnected}
            onPopOutSession={actions.handlePopOutSession}
          />
        </SortableItem>
      ))}
    </SortableList>
  );

  const noBackendsMessage = getNoBackendsMessage({
    isMobile,
    directGatewayUrl,
    facadeConnectionState,
  });

  const renderProjectList = () => (
    <>
      {onlineBackends.length === 0 ? (
        <p className="text-sm text-muted-foreground px-2">{noBackendsMessage}</p>
      ) : (
        <div className="space-y-2">
          {onlineBackends.map(backend => {
            const backendProjects = getProjectsForBackend(backend.backendId);
            const expanded = expandedBackendIds.includes(backend.backendId);
            // Treat "no active backend yet" as active so the tree never shows a
            // switch prompt in place of projects during startup.
            const isActive =
              !backendActiveId ||
              resolveCanonicalBackendId(backend.backendId, data.localBackendId) === backendActiveId;
            return (
              <div key={backend.backendId} className="space-y-1">
                <BackendRow
                  name={backend.name}
                  online={backend.online}
                  viewState={getMobileBackendViewState(
                    backend.backendId,
                    facadeConnectionState,
                    facadeBackends
                  )}
                  latencyMs={serverConnections[backend.backendId]?.latencyMs}
                  isActive={isActive}
                  onActivate={() => selectionCoordinator.selectBackend(backend.backendId)}
                  isMobile={isMobile}
                  expanded={expanded}
                  onToggle={() => toggleBackend(backend.backendId)}
                  onNewProject={() => {
                    setNewProjectBackendId(backend.backendId);
                    setShowNewProjectForm(true);
                  }}
                  newProjectDisabled={!isConnected}
                >
                  {backendProjects.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">No projects yet</p>
                  ) : (
                    renderProjectItems(backendProjects)
                  )}
                </BackendRow>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  const renderPortaledModals = () => (
    <SidebarPortaledModals
      settingsProjectId={settingsProjectId}
      settingsProject={settingsProject}
      onClearSettingsProject={() => setSettingsProjectId(null)}
      agentDialogOpen={agentDialogOpen}
      agentDialogReason={agentDialogReason}
      onCloseAgentDialog={() => setAgentDialogOpen(false)}
      newSession={newSession}
      agents={agents}
      runAfterAgentGate={runAfterAgentGate}
      onCreateSession={actions.handleCreateSession}
      newProject={newProject}
      onCreateProject={agentProfileId =>
        actions.handleCreateProject(newProjectBackendId, agentProfileId)
      }
      backends={onlineBackends.map(b => ({
        backendId: b.backendId,
        name: b.name,
        online: b.online,
      }))}
      isConnected={isConnected}
      isMobile={isMobile}
    />
  );

  // Mobile: keep the overlay drawer mounted offscreen so an opening drag can
  // reveal its real content immediately. Inert/pointer-events prevent the
  // closed panel from participating in focus or hit testing.
  if (isMobile) {
    return (
      <>
        <div
          ref={drawerBackdropRef}
          className={`mobile-drawer-backdrop fixed inset-0 bg-black z-40 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
          style={
            {
              '--drawer-backdrop-opacity': isOpen ? '0.5' : '0',
              '--drawer-transition-duration': '350ms',
            } as CSSProperties
          }
          onClick={isOpen ? onClose : undefined}
          aria-hidden="true"
        />
        <div
          ref={mobileDrawerPanelRef}
          role="dialog"
          aria-modal={isOpen ? 'true' : undefined}
          aria-hidden={isOpen ? undefined : 'true'}
          inert={!isOpen}
          aria-label="Navigation"
          tabIndex={-1}
          onKeyDown={handleDrawerKeyDown}
          className={`mobile-drawer-panel fixed inset-y-0 left-0 bg-[hsl(var(--sidebar))] border-r border-border/60 z-50 shadow-apple-xl flex flex-col safe-top-pad safe-bottom-pad outline-none ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
          style={
            {
              '--drawer-panel-x': isOpen ? '0px' : '-100%',
              '--drawer-transition-duration': '350ms',
            } as CSSProperties
          }
        >
          <MobileSidebarHeader
            onClose={onClose}
            onOpenSearch={() => {
              setSearchOpen(true);
              onClose?.();
            }}
            onOpenNotifications={onOpenNotifications}
            isNotificationsOpen={isNotificationsOpen}
            notificationUnreadCount={notificationUnreadCount}
          />

          {/* Every navigation callback closes the 300px drawer after it fires
              (same pattern as onHome) so the destination is actually visible. */}
          <SidebarNav
            onHome={() => {
              onHome();
              onClose?.();
            }}
            isHomeActive={isHomeActive}
            isMobile
            onOpenClaudia={() => {
              setClaudiaExpanded(true);
              onClose?.();
            }}
            isClaudiaActive={isClaudiaExpanded}
            claudiaStatus={claudiaSidebarStatus({
              hasPermissionPending: hasClaudiaPermissionPending,
              hasUnread: hasClaudiaUnread,
              hasRunning: hasClaudiaRunning,
            })}
            onOpenAutomations={
              onOpenAutomations
                ? () => {
                    onOpenAutomations();
                    onClose?.();
                  }
                : undefined
            }
            automationMode={
              automationMode
                ? {
                    tab: automationMode.tab,
                    onSelectTab: tab => {
                      automationMode.onSelectTab(tab);
                      onClose?.();
                    },
                    onBack: () => {
                      automationMode.onBack();
                      onClose?.();
                    },
                  }
                : undefined
            }
            onOpenAgents={
              onOpenAgents
                ? () => {
                    onOpenAgents();
                    onClose?.();
                  }
                : undefined
            }
            agentsMode={
              agentsMode
                ? {
                    tab: agentsMode.tab,
                    onSelectTab: tab => {
                      agentsMode.onSelectTab(tab);
                      onClose?.();
                    },
                    onBack: () => {
                      agentsMode.onBack();
                      onClose?.();
                    },
                  }
                : undefined
            }
            onOpenPlugins={
              onOpenPlugins
                ? () => {
                    onOpenPlugins();
                    onClose?.();
                  }
                : undefined
            }
            pluginsMode={
              pluginsMode
                ? {
                    tab: pluginsMode.tab,
                    onSelectTab: tab => {
                      pluginsMode.onSelectTab(tab);
                      onClose?.();
                    },
                    onBack: () => {
                      pluginsMode.onBack();
                      onClose?.();
                    },
                  }
                : undefined
            }
          />

          <div className="flex-1 overflow-y-auto scrollbar-hidden p-2">
            {automationMode || agentsMode || pluginsMode ? null : renderProjectList()}
          </div>

          <SidebarFooter onShowSettings={() => onOpenSettings?.()} isMobile />
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
  const maxSidebarWidthPx =
    (typeof window !== 'undefined' ? window.innerWidth : 1920) *
    (SIDEBAR_WIDTH_LIMITS.MAX_WIDTH_VW / 100);
  const clampedSidebarWidth = Math.max(
    SIDEBAR_WIDTH_LIMITS.MIN_WIDTH_PX,
    Math.min(maxSidebarWidthPx, sidebarWidth)
  );
  return (
    <>
      <div
        className="relative flex flex-shrink-0 flex-col bg-background p-1.5"
        style={{ width: clampedSidebarWidth }}
      >
        {/* Resize handle on the right edge */}
        <div
          className="absolute top-0 right-0 z-20 h-full w-1 cursor-ew-resize hover:bg-muted"
          onMouseDown={onResizeStart}
          onTouchStart={onResizeStart}
          onKeyDown={onResizeKeyDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          aria-valuenow={Math.round(clampedSidebarWidth)}
          aria-valuemin={SIDEBAR_WIDTH_LIMITS.MIN_WIDTH_PX}
          aria-valuemax={Math.round(maxSidebarWidthPx)}
        />

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

        <div
          data-testid="sidebar-card"
          className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden rounded-lg border border-border/50 bg-[hsl(var(--sidebar))] shadow-sm"
        >
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

          <SidebarNav
            onHome={onHome}
            isHomeActive={isHomeActive}
            onOpenClaudia={() => useTopLevelViewStore.getState().openClaudia()}
            isClaudiaActive={isClaudiaExpanded || topLevelViewKind === 'claudia'}
            claudiaStatus={claudiaSidebarStatus({
              hasPermissionPending: hasClaudiaPermissionPending,
              hasUnread: hasClaudiaUnread,
              hasRunning: hasClaudiaRunning,
            })}
            onOpenAutomations={onOpenAutomations}
            automationMode={
              automationMode
                ? {
                    tab: automationMode.tab,
                    onSelectTab: automationMode.onSelectTab,
                    onBack: automationMode.onBack,
                  }
                : undefined
            }
            onOpenAgents={onOpenAgents}
            agentsMode={
              agentsMode
                ? {
                    tab: agentsMode.tab,
                    onSelectTab: agentsMode.onSelectTab,
                    onBack: agentsMode.onBack,
                  }
                : undefined
            }
            onOpenPlugins={onOpenPlugins}
            pluginsMode={pluginsMode}
          />

          <div className="flex-1 overflow-y-auto scrollbar-hidden p-2">
            {automationMode || agentsMode || pluginsMode ? null : renderProjectList()}
          </div>

          <SidebarFooter onShowSettings={() => onOpenSettings?.()} />
        </div>
      </div>
      {renderPortaledModals()}
    </>
  );
}

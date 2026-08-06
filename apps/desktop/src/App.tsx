import { useEffect, useState, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Sidebar } from './features/sidebar/Sidebar';
import { NotificationsModal } from './features/sidebar/NotificationsModal';
import { SidebarCollapsedBar } from './features/sidebar/SidebarCollapsedBar';
import { SessionChatLayout } from './features/chat/SessionChatLayout';
import { HomeView } from './features/home/HomeView';
import { MobileSetup } from './components/setup/MobileSetup';
import { WindowsSetup } from './components/setup/WindowsSetup';
import { SettingsPanel } from './features/settings/SettingsPanel';
import { ToastContainer } from './components/ToastContainer';
import { UpdateBanner } from './components/UpdateBanner';
import { WindowRouter } from './app/WindowRouter';
import { AppHeader } from './app/AppHeader';
import { MobileModeHeader } from './app/MobileModeHeader';
import { MobileOverlays } from './app/MobileOverlays';
import { useConnection } from './contexts/ConnectionContext';
import { useDataLoader } from './hooks/useDataLoader';
import { useSelectionCoordinator } from './hooks/useSelectionCoordinator';
import { useIsMobile } from './hooks/useMediaQuery';
import { useAndroidBack } from './hooks/useAndroidBack';
import { useSwipeBack } from './hooks/useSwipeBack';
import { useNotchBridgeHost } from './hooks/useNotchBridgeHost';
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { useServerLatencyMonitor } from './hooks/useServerLatencyMonitor';
import { useActiveSessionStream } from './hooks/useActiveSessionStream';
import { useMainWindowGeometry } from './hooks/useMainWindowGeometry';
import { useClaudiaDesktop } from './hooks/useClaudiaDesktop';
import { useDeepLinkNavigation } from './hooks/useDeepLinkNavigation';
import { useMobileInit } from './hooks/useMobileInit';
import { useTauriWindowEvents } from './hooks/useTauriWindowEvents';
import { useAgentsBackends } from './features/agents/selectAgentsBackends';
import { useProfilesByBackend, type AgentsBackend } from './features/agents/useProfilesByBackend';
import { useSkillsByBackend } from './features/agents/useSkillsByBackend';
import { useMcpServersByBackend } from './features/agents/useMcpServersByBackend';
import { useLlmProfilesByBackend } from './features/agents/useLlmProfilesByBackend';
import { useServerStore } from './stores/serverStore';
import { useFacadeStore } from './stores/facadeStore';
import { useProjectStore } from './stores/projectStore';
import { useSelectionStore } from './stores/selectionStore';
import { useClaudiaStore } from './stores/claudiaStore';
import { useFileViewerStore } from './stores/fileViewerStore';
import { useTopLevelViewStore } from './stores/topLevelViewStore';
import { useAgentReadinessStore } from './stores/agentReadinessStore';
import { usePluginStore } from './stores/pluginStore';
import { useRecoveryStore } from './stores/recoveryStore';
import { useNotificationFeedStore } from './stores/notificationFeedStore';
import { useNotificationsModalStore } from './stores/notificationsModalStore';
import { useGatewayStore } from './stores/gatewayStore';
import { useShortcutStore } from './stores/shortcutStore';
import { useHomeQuickActionsStore } from './stores/homeQuickActionsStore';
import { isAndroid, isDesktopTauri } from './utils/platform';
import { initBuiltinPanels } from './plugins/builtinPanels';
import { shouldShowDirectGatewaySetup } from './utils/directGatewaySetup';
import { getMobileControlPlaneState } from './services/mobileConnectionState';
import { PaneSkeleton } from './components/ui/Skeleton';

const FileViewerWindow = lazy(() =>
  import('./components/fileviewer/FileViewerWindow').then(m => ({ default: m.FileViewerWindow }))
);
const ProjectDashboard = lazy(() =>
  import('./features/dashboard/ProjectDashboard').then(m => ({ default: m.ProjectDashboard }))
);
const AutomationContent = lazy(() =>
  import('./features/automation/AutomationContent').then(m => ({ default: m.AutomationContent }))
);
const AgentsContent = lazy(() =>
  import('./features/agents/AgentsContent').then(m => ({ default: m.AgentsContent }))
);
const PluginsContent = lazy(() =>
  import('./features/plugins/PluginsContent').then(m => ({ default: m.PluginsContent }))
);

// Stable empty list handed to the agents-mode catalog hooks while their tab is
// not showing (empty array = no fetches; loading settles false).
const NO_AGENTS_BACKENDS: AgentsBackend[] = [];
const MOBILE_TOAST_CONTAINER_CLASS =
  'fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2';

const LazyFallback = () => (
  <div className="flex items-center justify-center h-full">
    <PaneSkeleton />
  </div>
);

function AppContent() {
  const { embeddedServerStatus, embeddedServerError } = useConnection();
  const isMobile = useIsMobile();
  // Control-plane concerns (gateway setup, readiness, localhost guards) are
  // platform-bound, not viewport-bound: an Android tablet (or landscape phone
  // ≥768px) renders the desktop layout but still has no embedded server, so it
  // must use the gateway-direct control plane like phones do. Without this it
  // would land on the embedded-server "Connecting..." splash forever.
  const usesMobileControlPlane = isMobile || isAndroid();

  // --- Store selectors ---
  const activeServerId = useServerStore(s => s.activeServerId);
  const setActiveServer = useServerStore(s => s.setActiveServer);
  const transportStatus = useRecoveryStore(s => s.transport.status);
  const facadeConnectionState = useFacadeStore(s => s.connectionState);
  const facadeSnapshotVersion = useFacadeStore(s => s.snapshotVersion);
  const facadeBackends = useFacadeStore(s => s.backends);
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const selectedSessionId = useSelectionStore(s => s.selectedSessionId);
  const selectedProjectId = useSelectionStore(s => s.selectedProjectId);
  const sessions = useProjectStore(s => s.sessions);
  const projects = useProjectStore(s => s.projects);
  const selectSession = useProjectStore(s => s.selectSession);
  const setDashboardView = useSelectionStore(s => s.setDashboardView);
  const isAgentExpanded = useClaudiaStore(s => s.isExpanded);
  const setAgentExpanded = useClaudiaStore(s => s.setExpanded);
  const disabledBuiltinPanels = usePluginStore(s => s.disabledBuiltinPanels);
  const notificationUnreadCount = useNotificationFeedStore(s => s.unreadCount);
  const notificationsModalOpen = useNotificationsModalStore(s => s.isOpen);
  const directGatewayUrl = useGatewayStore(s => s.directGatewayUrl);
  const fileViewerFullscreen = useFileViewerStore(s => s.fullscreen);
  const fileViewerFilePath = useFileViewerStore(s => s.filePath);
  const fileViewerProjectRoot = useFileViewerStore(s => s.projectRoot);
  const setFileViewerFullscreen = useFileViewerStore(s => s.setFullscreen);
  const topLevelView = useTopLevelViewStore(s => s.view);
  const openSettings = useTopLevelViewStore(s => s.openSettings);
  const returnToApp = useTopLevelViewStore(s => s.returnToApp);
  const openAutomations = useTopLevelViewStore(s => s.openAutomations);
  const setAutomationTab = useTopLevelViewStore(s => s.setAutomationTab);
  const setAutomationProjectFilter = useTopLevelViewStore(s => s.setAutomationProjectFilter);
  const openAgents = useTopLevelViewStore(s => s.openAgents);
  const setAgentsTab = useTopLevelViewStore(s => s.setAgentsTab);
  const openPlugins = useTopLevelViewStore(s => s.openPlugins);
  const setPluginsTab = useTopLevelViewStore(s => s.setPluginsTab);
  const refreshReadiness = useAgentReadinessStore(s => s.refresh);

  const {
    selectBackend: _selectBackend,
    selectProject: selectProjectRoute,
    selectSession: _selectSessionRoute,
  } = useSelectionCoordinator();

  // --- Local state ---
  const [dashboardProjectId, setDashboardProjectId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false);
  const [isFeedOpen, setFeedOpen] = useState(false);
  const [agentSwipePreview, setAgentSwipePreview] = useState<{
    mode: 'open' | 'close' | null;
    progress: number;
  }>({ mode: null, progress: 0 });

  const hasConnected = useRef(false);

  // --- Derived state ---
  const controlPlaneState = usesMobileControlPlane
    ? getMobileControlPlaneState(facadeConnectionState, facadeSnapshotVersion)
    : transportStatus === 'connected'
      ? 'ready'
      : transportStatus === 'error'
        ? 'error'
        : 'connecting';

  if (controlPlaneState === 'ready') {
    hasConnected.current = true;
  }

  const selectedSession = selectedSessionId
    ? (sessions.find(s => s.id === selectedSessionId) ?? null)
    : null;
  const dashboardProject = dashboardProjectId
    ? projects.find(p => p.id === dashboardProjectId) || null
    : null;
  const isAppTopLevelView = topLevelView.kind === 'app';
  // Shell modes replace the app content but keep the sidebar shell. On mobile
  // they get a dedicated header (back to app + drawer) and an Android-back
  // escape hatch; the title doubles as the mode discriminator.
  const shellModeTitle =
    topLevelView.kind === 'automations'
      ? 'Automations'
      : topLevelView.kind === 'agents'
        ? 'Agents'
        : topLevelView.kind === 'plugins'
          ? 'Extensions'
          : null;
  const isShellTopLevelView = shellModeTitle !== null;
  const mobileToastContainer = isMobile ? (
    <ToastContainer className={MOBILE_TOAST_CONTAINER_CLASS} />
  ) : null;

  const currentContextProjectId =
    selectedSession?.projectId || dashboardProjectId || selectedProjectId || null;

  const claudiaSwipePreviewProgress = useMemo(() => {
    const progress = Math.max(0, Math.min(1, agentSwipePreview.progress));
    if (progress === 0 || progress === 1) return progress;
    return Math.min(1, progress * 0.72 + progress * progress * 0.28);
  }, [agentSwipePreview.progress]);

  const claudiaOverlayOpacity = useMemo(() => {
    if (agentSwipePreview.mode === 'open') return claudiaSwipePreviewProgress * 0.14;
    if (agentSwipePreview.mode === 'close') return (1 - claudiaSwipePreviewProgress) * 0.14;
    return isAgentExpanded ? 0.14 : 0;
  }, [agentSwipePreview.mode, claudiaSwipePreviewProgress, isAgentExpanded]);

  const openNotifications = useCallback(() => {
    setAgentExpanded(false);
    if (isMobile) {
      setFeedOpen(current => !current);
    } else {
      useNotificationsModalStore.getState().toggle();
    }
  }, [isMobile, setAgentExpanded]);

  const openProjectDashboardWindowFn = useCallback((projectId: string) => {
    const project = useProjectStore.getState().projects.find(item => item.id === projectId);
    import('./features/dashboard/openProjectDashboardWindow').then(m =>
      m.openProjectDashboardWindow({
        projectId,
        projectName: project?.name,
      })
    );
  }, []);

  const closeTopLevelView = useCallback(() => {
    returnToApp();
    void refreshReadiness();
  }, [returnToApp, refreshReadiness]);

  const automationMode =
    topLevelView.kind === 'automations'
      ? {
          tab: topLevelView.tab,
          projectId: topLevelView.projectId,
          activeBackendId: activeServerId ?? localBackendId,
          onSelectTab: setAutomationTab,
          onBack: closeTopLevelView,
          onSelectScope: (backendId: string, projectId?: string) => {
            setActiveServer(backendId);
            setAutomationProjectFilter(projectId);
          },
        }
      : undefined;

  // Agents shell mode: hooks run unconditionally, but each tab's catalog is only
  // fetched while that tab is showing (idle = empty backends list, no fetches).
  // Switching tabs still refetches: the hooks' effect keys change as their
  // backends list goes empty -> populated.
  const agentsBackends = useAgentsBackends();
  const agentsData = useProfilesByBackend(
    topLevelView.kind === 'agents' && topLevelView.tab === 'profiles'
      ? agentsBackends
      : NO_AGENTS_BACKENDS
  );
  const skillsData = useSkillsByBackend(
    topLevelView.kind === 'agents' && topLevelView.tab === 'skills'
      ? agentsBackends
      : NO_AGENTS_BACKENDS
  );
  const mcpData = useMcpServersByBackend(
    topLevelView.kind === 'agents' && topLevelView.tab === 'mcp-servers'
      ? agentsBackends
      : NO_AGENTS_BACKENDS
  );
  const providersData = useLlmProfilesByBackend(
    topLevelView.kind === 'agents' && topLevelView.tab === 'providers'
      ? agentsBackends
      : NO_AGENTS_BACKENDS
  );

  const agentsMode =
    topLevelView.kind === 'agents'
      ? {
          tab: topLevelView.tab,
          onSelectTab: setAgentsTab,
          onBack: closeTopLevelView,
        }
      : undefined;

  const pluginsMode =
    topLevelView.kind === 'plugins'
      ? {
          tab: topLevelView.tab,
          onSelectTab: setPluginsTab,
          onBack: closeTopLevelView,
        }
      : undefined;

  // --- Extracted hooks ---
  useClaudiaDesktop({
    isMobile,
    controlPlaneState,
    claudiaContextProjectId: currentContextProjectId,
  });

  useDeepLinkNavigation(controlPlaneState);
  useMobileInit(usesMobileControlPlane);
  useTauriWindowEvents();
  useMainWindowGeometry();
  useNotchBridgeHost({ enabled: !isMobile });
  useActiveSessionStream();
  useAutoUpdate();
  useServerLatencyMonitor();
  useDataLoader();

  // Register builtin plugin panels once
  useEffect(() => {
    initBuiltinPanels();
  }, []);

  // Initialize global shortcut config (desktop only)
  useEffect(() => {
    if (!isDesktopTauri()) return;
    const { loadConfig } = useShortcutStore.getState();
    void loadConfig();
  }, []);

  // When a session is selected, exit the dashboard view
  const prevSessionRef = useRef(selectedSessionId);
  useEffect(() => {
    if (selectedSessionId && selectedSessionId !== prevSessionRef.current) {
      setDashboardProjectId(null);
    }
    prevSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  // Reset swipe preview on expand/collapse
  useEffect(() => {
    if (isAgentExpanded) {
      setAgentSwipePreview(c => (c.mode === 'open' ? { mode: null, progress: 0 } : c));
      return;
    }
    setAgentSwipePreview(c => (c.mode === 'close' ? { mode: null, progress: 0 } : c));
  }, [isAgentExpanded]);

  // --- Android back gestures ---
  useAndroidBack(
    () => setFileViewerFullscreen(false),
    isAppTopLevelView && fileViewerFullscreen,
    25
  );
  useAndroidBack(
    () => setAgentExpanded(false),
    (isAppTopLevelView || isShellTopLevelView) && isMobile && isAgentExpanded,
    20
  );
  useAndroidBack(
    () => setSidebarOpen(false),
    (isAppTopLevelView || isShellTopLevelView) && isMobile && sidebarOpen,
    10
  );
  useAndroidBack(
    () => setSidebarOpen(true),
    isAppTopLevelView && isMobile && !sidebarOpen && !isAgentExpanded && !fileViewerFullscreen,
    5
  );
  // Shell modes (automations/agents/plugins): back returns to the app mode —
  // same "close overlay" tier as SettingsPanel's own registration. The drawer
  // and the expanded agent overlay close first (registrations above).
  useAndroidBack(
    closeTopLevelView,
    isShellTopLevelView && isMobile && !sidebarOpen && !isAgentExpanded,
    20
  );

  // --- Mobile swipe gestures ---
  const swipeOpenClaudiaRef = useSwipeBack<HTMLElement>({
    onSwipe: () => setAgentExpanded(true),
    onProgress: progress =>
      setAgentSwipePreview(progress > 0 ? { mode: 'open', progress } : { mode: null, progress: 0 }),
    enabled:
      isAppTopLevelView && isMobile && !isAgentExpanded && !sidebarOpen && !fileViewerFullscreen,
    direction: 'left',
    startZone: { startRatio: 0.25, endRatio: 0.75 },
    threshold: 60,
  });

  const swipeCloseClaudiaRef = useSwipeBack({
    onSwipe: () => setAgentExpanded(false),
    onProgress: progress =>
      setAgentSwipePreview(
        progress > 0 ? { mode: 'close', progress } : { mode: null, progress: 0 }
      ),
    enabled: isAppTopLevelView && isMobile && isAgentExpanded,
    direction: 'right',
    fullWidth: true,
    threshold: 60,
    velocityThreshold: 0.18,
  });

  // --- Conditional early returns (setup / loading screens) ---
  const requiresDirectGatewaySetup = shouldShowDirectGatewaySetup({
    directGatewayUrl,
    activeServerId,
    availableBackendIds: facadeBackends.map(b => b.backendId),
  });

  if (usesMobileControlPlane && requiresDirectGatewaySetup) {
    return <MobileSetup />;
  }

  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
  const hasConnectedServer = controlPlaneState === 'ready' || hasConnected.current;
  const shouldRenderWindowsSetup =
    isWindows &&
    embeddedServerStatus === 'wsl-mode' &&
    (!hasConnectedServer || (directGatewayUrl ? requiresDirectGatewaySetup : false));

  if (shouldRenderWindowsSetup) {
    return <WindowsSetup />;
  }

  if (!usesMobileControlPlane && !hasConnected.current && controlPlaneState !== 'ready') {
    const statusText =
      embeddedServerStatus === 'error'
        ? embeddedServerError || 'Server failed to start'
        : embeddedServerStatus === 'starting'
          ? 'Starting server...'
          : 'Connecting...';
    const isError = embeddedServerStatus === 'error';

    return (
      <div className="flex flex-col h-dvh bg-background text-foreground">
        <div className="safe-top-spacer bg-background flex-shrink-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center" data-tauri-drag-region>
          <div className="text-center">
            {isError ? (
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-5 h-5 text-destructive"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
            ) : (
              <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            )}
            <p className={`text-sm ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {statusText}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (topLevelView.kind === 'settings') {
    return (
      <div className="flex flex-col h-dvh bg-background text-foreground">
        <SettingsPanel
          isOpen={true}
          initialTab={topLevelView.initialTab}
          onClose={closeTopLevelView}
        />
        {mobileToastContainer}
      </div>
    );
  }

  // --- Main render ---
  return (
    <div className="flex flex-col h-dvh bg-background text-foreground">
      {/* Mobile keeps a full-width safe-area strip. On desktop the three columns
          run to y=0 and each owns its top strip, so the macOS traffic lights sit
          inline in the sidebar header (cleared via left padding) instead. */}
      {isMobile && (
        <div
          className={`safe-top-spacer bg-card flex-shrink-0 ${selectedSessionId && !isAgentExpanded && !isShellTopLevelView ? 'hidden' : ''}`}
          data-tauri-drag-region
        />
      )}

      {/* Desktop, expanded: the wide sidebar header hosts the traffic lights
          inline. Collapsed: no rail — a thin full-width top bar holds the global
          icons next to the lights (Cursor-style); content fills below. */}
      {!isMobile && sidebarCollapsed && (
        <SidebarCollapsedBar
          onExpand={() => setSidebarCollapsed(false)}
          onOpenSearch={() => {
            setSidebarCollapsed(false);
            setSidebarSearchOpen(true);
          }}
          onOpenNotifications={openNotifications}
          notificationUnreadCount={notificationUnreadCount}
          disableNotifications={disabledBuiltinPanels.includes('notifications')}
        />
      )}

      {/* Desktop relocates these controls into the sidebar's own header, so the
          full-width AppHeader band only renders on mobile (hamburger / agent).
          Shell modes get MobileModeHeader instead, so skip this one there
          unless the Claudia overlay is up (which this bar titles). */}
      {isMobile &&
        !(selectedSessionId && !isAgentExpanded) &&
        (isAgentExpanded || !isShellTopLevelView) && (
          <AppHeader
            isMobile={isMobile}
            isAgentExpanded={isAgentExpanded}
            onOpenSidebar={() => setSidebarOpen(true)}
            onCloseAgent={() => setAgentExpanded(false)}
          />
        )}

      {!isMobile && <UpdateBanner />}

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          isMobile={isMobile}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          disableNotifications={disabledBuiltinPanels.includes('notifications')}
          onOpenNotifications={openNotifications}
          searchOpen={!isMobile ? sidebarSearchOpen : undefined}
          onSearchOpenChange={!isMobile ? setSidebarSearchOpen : undefined}
          isNotificationsOpen={isMobile ? isFeedOpen : notificationsModalOpen}
          onOpenSettings={openSettings}
          onOpenDashboard={projectId => {
            selectProjectRoute(projectId);
            selectSession(null);
            setDashboardView(projectId, 'home');
            setDashboardProjectId(projectId);
          }}
          onHome={() => {
            selectSession(null);
            setDashboardProjectId(null);
          }}
          isHomeActive={!selectedSessionId && !dashboardProjectId}
          onOpenAutomations={() => openAutomations()}
          automationMode={automationMode}
          onOpenAgents={() => openAgents()}
          agentsMode={agentsMode}
          onOpenPlugins={() => openPlugins()}
          pluginsMode={pluginsMode}
        />

        {!isMobile && (
          <NotificationsModal
            open={notificationsModalOpen}
            onClose={() => useNotificationsModalStore.getState().close()}
          />
        )}

        <main ref={swipeOpenClaudiaRef} className="flex-1 flex flex-col overflow-hidden relative">
          {/* Desktop: the main column owns its own top drag strip. The full-width
              AppHeader (which used to provide this) only renders on mobile now, and
              only SessionHeader re-adds a strip — so welcome/dashboard views would
              otherwise leave the top of the window un-draggable. When the view has
              its own top control bar (session/dashboard/automations/agents) we keep the
              strip a hairline so it doesn't cover their buttons; the empty welcome
              view has nothing underneath, so we widen it to an easy grab target. */}
          {!isMobile && (
            <div
              className={`absolute inset-x-0 top-0 z-10 hidden sm:block ${
                topLevelView.kind === 'app' && !dashboardProject && !selectedSessionId
                  ? 'h-10'
                  : 'h-2'
              }`}
              data-tauri-drag-region
            />
          )}
          {/* Mobile shell modes: AppHeader is skipped here, so this bar is the
              only visible way back to the app (and into the drawer's mode
              tabs). */}
          {isMobile && shellModeTitle && !isAgentExpanded && (
            <MobileModeHeader
              title={shellModeTitle}
              onBack={closeTopLevelView}
              onOpenSidebar={() => setSidebarOpen(true)}
            />
          )}
          <div className="flex-1 overflow-hidden relative">
            {isMobile && (
              <MobileOverlays
                isAgentExpanded={isAgentExpanded}
                isFeedOpen={isFeedOpen}
                swipeCloseRef={swipeCloseClaudiaRef}
                agentSwipePreview={agentSwipePreview}
                claudiaSwipePreviewProgress={claudiaSwipePreviewProgress}
                claudiaOverlayOpacity={claudiaOverlayOpacity}
                onCloseAgent={() => setAgentExpanded(false)}
                onCloseFeed={() => setFeedOpen(false)}
              />
            )}

            {topLevelView.kind === 'automations' ? (
              <Suspense fallback={<LazyFallback />}>
                <AutomationContent
                  tab={topLevelView.tab}
                  projectId={topLevelView.projectId}
                  backendId={activeServerId ?? localBackendId}
                />
              </Suspense>
            ) : topLevelView.kind === 'agents' ? (
              <Suspense fallback={<LazyFallback />}>
                <AgentsContent
                  backends={agentsBackends}
                  data={agentsData}
                  skillsData={skillsData}
                  mcpData={mcpData}
                  providersData={providersData}
                />
              </Suspense>
            ) : topLevelView.kind === 'plugins' ? (
              <Suspense fallback={<LazyFallback />}>
                <PluginsContent />
              </Suspense>
            ) : dashboardProject ? (
              <Suspense fallback={<LazyFallback />}>
                <ProjectDashboard
                  projectId={dashboardProject.id}
                  projectRootPath={dashboardProject.rootPath}
                  onOpenAutomations={opts =>
                    openAutomations({ tab: opts.tab, projectId: opts.projectId })
                  }
                  onOpenDashboardWindow={openProjectDashboardWindowFn}
                />
              </Suspense>
            ) : selectedSessionId ? (
              <SessionChatLayout
                key={selectedSessionId}
                sessionId={selectedSessionId}
                onOpenSidebar={() => setSidebarOpen(true)}
                onReturnToDashboard={projectId => {
                  selectProjectRoute(projectId);
                  selectSession(null);
                  setDashboardProjectId(projectId);
                }}
              />
            ) : (
              <HomeView
                onNewSession={() => {
                  useHomeQuickActionsStore.getState().request('new-session');
                }}
                onAddProject={() => {
                  // The inline new-project form lives in the sidebar — make sure it is visible.
                  if (isMobile) setSidebarOpen(true);
                  else setSidebarCollapsed(false);
                  useHomeQuickActionsStore.getState().request('new-project');
                }}
              />
            )}
          </div>
        </main>
      </div>

      {mobileToastContainer}

      {fileViewerFullscreen && fileViewerFilePath && fileViewerProjectRoot && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          <div className="safe-top-spacer bg-card flex-shrink-0" />
          <Suspense fallback={<LazyFallback />}>
            <FileViewerWindow
              filePath={fileViewerFilePath}
              projectRoot={fileViewerProjectRoot}
              onClose={() => setFileViewerFullscreen(false)}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <WindowRouter>
      <AppContent />
    </WindowRouter>
  );
}

export default App;

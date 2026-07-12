import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const { mockUseIsMobile, mockUseAndroidBack } = vi.hoisted(() => ({
  mockUseIsMobile: vi.fn(() => false),
  mockUseAndroidBack: vi.fn(),
}));

vi.mock('../WindowRouter', () => ({
  WindowRouter: ({ children }: { children: any }) => <>{children}</>,
}));

vi.mock('../../features/sidebar/Sidebar', () => ({
  Sidebar: ({ onOpenSettings }: { onOpenSettings?: (tab?: 'permissions') => void }) => (
    <aside data-testid="app-sidebar">
      <button onClick={() => onOpenSettings?.('permissions')}>Open Settings</button>
    </aside>
  ),
}));

vi.mock('../../features/settings/SettingsPanel', () => ({
  SettingsPanel: ({ initialTab, onClose }: { initialTab?: string; onClose: () => void }) => (
    <section data-testid="settings-panel" data-initial-tab={initialTab ?? ''}>
      <button onClick={onClose}>Back to app</button>
    </section>
  ),
}));

vi.mock('../../features/chat/SessionChatLayout', () => ({
  SessionChatLayout: () => <div data-testid="chat-view">Chat</div>,
}));

vi.mock('../../features/dashboard/ProjectDashboard', () => ({
  ProjectDashboard: () => <div data-testid="dashboard-view">Dashboard</div>,
}));

vi.mock('../../features/sidebar/NotificationsModal', () => ({ NotificationsModal: () => null }));
vi.mock('../../features/sidebar/SidebarCollapsedBar', () => ({ SidebarCollapsedBar: () => null }));
vi.mock('../../components/setup/MobileSetup', () => ({
  MobileSetup: () => <div>Mobile setup</div>,
}));
vi.mock('../../components/setup/WindowsSetup', () => ({
  WindowsSetup: () => <div>Windows setup</div>,
}));
vi.mock('../../components/ToastContainer', () => ({
  ToastContainer: ({ className }: { className?: string }) => (
    <div data-testid="toast-container" className={className ?? ''} />
  ),
}));
vi.mock('../../components/UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('../AppHeader', () => ({ AppHeader: () => null }));
vi.mock('../MobileOverlays', () => ({ MobileOverlays: () => null }));

vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    embeddedServerStatus: 'running',
    embeddedServerError: null,
  }),
}));

vi.mock('../../hooks/useDataLoader', () => ({ useDataLoader: () => undefined }));
vi.mock('../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({
    selectBackend: vi.fn(),
    selectProject: vi.fn(),
    selectSession: vi.fn(),
  }),
}));
vi.mock('../../hooks/useMediaQuery', () => ({ useIsMobile: mockUseIsMobile }));
vi.mock('../../hooks/useAndroidBack', () => ({ useAndroidBack: mockUseAndroidBack }));
vi.mock('../../hooks/useSwipeBack', () => ({ useSwipeBack: () => ({ current: null }) }));
vi.mock('../../hooks/useNotchBridgeHost', () => ({ useNotchBridgeHost: () => undefined }));
vi.mock('../../hooks/useAutoUpdate', () => ({ useAutoUpdate: () => undefined }));
vi.mock('../../hooks/useServerLatencyMonitor', () => ({
  useServerLatencyMonitor: () => undefined,
}));
vi.mock('../../hooks/useActiveSessionStream', () => ({ useActiveSessionStream: () => undefined }));
vi.mock('../../hooks/useMainWindowGeometry', () => ({ useMainWindowGeometry: () => undefined }));
vi.mock('../../hooks/useClaudiaDesktop', () => ({ useClaudiaDesktop: () => undefined }));
vi.mock('../../hooks/useDeepLinkNavigation', () => ({ useDeepLinkNavigation: () => undefined }));
vi.mock('../../hooks/useMobileInit', () => ({ useMobileInit: () => undefined }));
vi.mock('../../hooks/useTauriWindowEvents', () => ({ useTauriWindowEvents: () => undefined }));

vi.mock('../../utils/platform', () => ({ isDesktopTauri: () => false }));
vi.mock('../../plugins/builtinPanels', () => ({ initBuiltinPanels: vi.fn() }));
vi.mock('../../utils/directGatewaySetup', () => ({ shouldShowDirectGatewaySetup: () => false }));
vi.mock('../../services/mobileConnectionState', () => ({
  getMobileControlPlaneState: () => 'ready',
  isMobileBackendUsable: () => true,
}));

import App from '../../App';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { useAgentReadinessStore } from '../../stores/agentReadinessStore';
import { useClaudiaStore } from '../../stores/claudiaStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useNotificationFeedStore } from '../../stores/notificationFeedStore';
import { useNotificationsModalStore } from '../../stores/notificationsModalStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useProjectStore } from '../../stores/projectStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useServerStore } from '../../stores/serverStore';

function resetStores(refresh = vi.fn().mockResolvedValue(undefined)) {
  useTopLevelViewStore.setState({ view: { kind: 'app' } });
  useServerStore.setState({ activeServerId: 'local' } as any);
  useRecoveryStore.setState({ transport: { status: 'connected' } } as any);
  useFacadeStore.setState({
    connectionState: 'connected',
    snapshotVersion: 1,
    backends: [],
  } as any);
  useSelectionStore.setState({
    selectedSessionId: null,
    selectedProjectId: null,
    dashboardViews: {},
  } as any);
  useProjectStore.setState({
    sessions: [],
    projects: [],
    // Initial-load stamp: HomeView renders nothing (not even the welcome
    // state) until useDataLoader sets this.
    dataServerId: 'local',
    selectSession: vi.fn(),
  } as any);
  useClaudiaStore.setState({
    isExpanded: false,
    setExpanded: vi.fn(),
  } as any);
  usePluginStore.setState({ disabledBuiltinPanels: [] } as any);
  useNotificationFeedStore.setState({ unreadCount: 0 } as any);
  useNotificationsModalStore.setState({ isOpen: false } as any);
  useGatewayStore.setState({ directGatewayUrl: '' } as any);
  useFileViewerStore.setState({
    fullscreen: false,
    filePath: null,
    projectRoot: null,
  } as any);
  useAgentReadinessStore.setState({ refresh } as any);
}

describe('App top-level view routing', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
  });

  it('replaces the app shell with Settings and returns to the app shell', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    resetStores(refresh);

    const { getByText, getByTestId, queryByTestId, queryByText } = render(<App />);

    expect(getByTestId('app-sidebar')).toBeTruthy();
    expect(getByText(/Good (morning|afternoon|evening)/)).toBeTruthy();

    fireEvent.click(getByText('Open Settings'));

    await waitFor(() => {
      expect(getByTestId('settings-panel')).toBeTruthy();
    });
    expect(getByTestId('settings-panel').getAttribute('data-initial-tab')).toBe('permissions');
    expect(queryByTestId('app-sidebar')).toBeNull();
    expect(queryByText(/Good (morning|afternoon|evening)/)).toBeNull();

    fireEvent.click(getByText('Back to app'));

    await waitFor(() => {
      expect(getByTestId('app-sidebar')).toBeTruthy();
    });
    expect(getByText(/Good (morning|afternoon|evening)/)).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('disables hidden app-shell back handlers while Settings is visible on mobile', async () => {
    mockUseIsMobile.mockReturnValue(true);
    useFileViewerStore.setState({
      fullscreen: true,
      filePath: '/tmp/example.txt',
      projectRoot: '/tmp',
    } as any);

    const { getByText, getByTestId } = render(<App />);

    fireEvent.click(getByText('Open Settings'));

    await waitFor(() => {
      expect(getByTestId('settings-panel')).toBeTruthy();
    });

    const fileViewerBackCalls = mockUseAndroidBack.mock.calls.filter(
      ([, , priority]) => priority === 25
    );
    expect(fileViewerBackCalls.at(-1)?.[1]).toBe(false);
  });

  it('keeps the mobile toast host mounted while Settings is visible', async () => {
    mockUseIsMobile.mockReturnValue(true);

    const { getByText, getByTestId } = render(<App />);

    fireEvent.click(getByText('Open Settings'));

    await waitFor(() => {
      expect(getByTestId('settings-panel')).toBeTruthy();
    });

    const toastContainer = getByTestId('toast-container');
    expect(toastContainer).toBeTruthy();
    expect(toastContainer.className).toBe(
      'fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2'
    );
  });
});

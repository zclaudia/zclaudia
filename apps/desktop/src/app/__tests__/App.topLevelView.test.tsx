import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import type { Ref } from 'react';
import { Select } from '../../components/ui/Select';

const { mockUseIsMobile, mockUseAndroidBack, mockIsAndroid, mockShouldShowDirectGatewaySetup } =
  vi.hoisted(() => ({
    mockUseIsMobile: vi.fn(() => false),
    mockUseAndroidBack: vi.fn(),
    mockIsAndroid: vi.fn(() => false),
    mockShouldShowDirectGatewaySetup: vi.fn(() => false),
  }));

vi.mock('../WindowRouter', () => ({
  WindowRouter: ({ children }: { children: any }) => <>{children}</>,
}));

vi.mock('../../features/sidebar/Sidebar', () => ({
  Sidebar: ({
    onOpenSettings,
    isOpen,
    drawerPanelRef,
    drawerBackdropRef,
    onToggleWidth, widthMode, canExpand, widthChangeDisabled, onClose,
  }: {
    onOpenSettings?: (tab?: 'permissions') => void;
    isOpen?: boolean;
    drawerPanelRef?: Ref<HTMLDivElement>;
    drawerBackdropRef?: Ref<HTMLDivElement>;
    onToggleWidth?: () => void;
    onClose?: () => void;
    widthMode?: string; canExpand?: boolean; widthChangeDisabled?: boolean;
  }) => (
    <aside data-testid="app-sidebar" data-open={isOpen ? 'true' : 'false'}>
      {/* Stand-ins for the real drawer panel and backdrop so the gesture layer
          has something to paint its CSS variables onto. */}
      <div data-testid="drawer-panel" data-mobile-drawer-surface ref={drawerPanelRef} />
      <div data-testid="drawer-backdrop" data-mobile-drawer-surface ref={drawerBackdropRef} />
      {canExpand && <button disabled={widthChangeDisabled} onClick={onToggleWidth}>{widthMode === 'wide' ? 'Restore menu width' : 'Expand menu width'}</button>}
      <button onClick={onClose}>Close menu</button>
      <Select value="one" onChange={() => {}} ariaLabel="Drawer choices" options={[{ value: 'one', label: 'Only choice' }]} />
      <button onClick={() => onOpenSettings?.('permissions')}>Open Settings</button>
    </aside>
  ),
}));

vi.mock('../../features/automation/AutomationContent', () => ({
  AutomationContent: () => <div data-testid="automations-view">Automations content</div>,
}));
vi.mock('../../features/agents/AgentsContent', () => ({
  AgentsContent: () => <div data-testid="agents-view">Agents content</div>,
}));
vi.mock('../../features/plugins/PluginsContent', () => ({
  PluginsContent: () => <div data-testid="plugins-view">Plugins content</div>,
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
vi.mock('../MobileOverlays', () => ({ MobileOverlays: ({ panelRef, backdropRef }: { panelRef: React.RefObject<HTMLDivElement | null>; backdropRef: React.RefObject<HTMLDivElement | null> }) => <><div data-testid="claudia-preview" ref={panelRef} /><div ref={backdropRef} /></> }));

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
vi.mock('../../hooks/useAutoUpdate', () => ({ useAutoUpdate: () => undefined }));
vi.mock('../../hooks/useServerLatencyMonitor', () => ({
  useServerLatencyMonitor: () => undefined,
}));
vi.mock('../../features/chat/hooks/useActiveSessionStream', () => ({
  useActiveSessionStream: () => undefined,
}));
vi.mock('../../hooks/useMainWindowGeometry', () => ({ useMainWindowGeometry: () => undefined }));
vi.mock('../../hooks/useAgentInitialization', () => ({ useAgentInitialization: () => undefined }));
vi.mock('../../hooks/useDeepLinkNavigation', () => ({ useDeepLinkNavigation: () => undefined }));
vi.mock('../../hooks/useMobileInit', () => ({ useMobileInit: () => undefined }));
vi.mock('../../hooks/useTauriWindowEvents', () => ({ useTauriWindowEvents: () => undefined }));

vi.mock('../../utils/platform', () => ({
  isTauri: () => false,
  isDesktopTauri: () => false,
  isAndroid: mockIsAndroid,
}));
vi.mock('../../plugins/builtinPanels', () => ({ initBuiltinPanels: vi.fn() }));
vi.mock('../../utils/directGatewaySetup', () => ({
  shouldShowDirectGatewaySetup: mockShouldShowDirectGatewaySetup,
}));
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

describe('App shell modes on mobile', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(true);
  });

  it('renders the mobile mode header and its back button returns to the app', async () => {
    const { findByTestId, getByText, getByRole, queryByText } = render(<App />);

    act(() => {
      useTopLevelViewStore.getState().openAutomations();
    });
    await findByTestId('automations-view');
    expect(getByText('Automations')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: 'Back to app' }));

    await waitFor(() => {
      expect(useTopLevelViewStore.getState().view.kind).toBe('app');
    });
    expect(queryByText('Automations')).toBeNull();
  });

  it('mode header hamburger opens the sidebar drawer', async () => {
    const { findByTestId, getByRole, getByTestId } = render(<App />);

    act(() => {
      useTopLevelViewStore.getState().openPlugins();
    });
    await findByTestId('plugins-view');
    expect(getByTestId('app-sidebar').getAttribute('data-open')).toBe('false');

    fireEvent.click(getByRole('button', { name: 'Open menu' }));

    expect(getByTestId('app-sidebar').getAttribute('data-open')).toBe('true');
  });

  it('registers an Android back handler that escapes shell modes', async () => {
    const { findByTestId } = render(<App />);

    act(() => {
      useTopLevelViewStore.getState().openAgents();
    });
    await findByTestId('agents-view');

    // Priority-20 registrations: agent-overlay collapse (disabled — agent not
    // expanded) and the shell-mode escape. Only the escape is enabled here.
    const escapeCalls = mockUseAndroidBack.mock.calls.filter(
      ([, enabled, priority]) => priority === 20 && enabled === true
    );
    expect(escapeCalls.length).toBeGreaterThan(0);

    act(() => {
      escapeCalls.at(-1)![0]();
    });
    expect(useTopLevelViewStore.getState().view.kind).toBe('app');
  });

  it('Android back closes an open drawer before escaping the mode', async () => {
    const { findByTestId, getByRole, getByTestId } = render(<App />);

    act(() => {
      useTopLevelViewStore.getState().openAgents();
    });
    await findByTestId('agents-view');
    fireEvent.click(getByRole('button', { name: 'Open menu' }));

    // Latest render: drawer-close (priority 10) is enabled, mode escape is not.
    const drawerCloseCall = mockUseAndroidBack.mock.calls
      .filter(([, , priority]) => priority === 10)
      .at(-1)!;
    expect(drawerCloseCall[1]).toBe(true);
    const escapeCall = mockUseAndroidBack.mock.calls
      .filter(([, , priority]) => priority === 20)
      .at(-1)!;
    expect(escapeCall[1]).toBe(false);

    act(() => {
      drawerCloseCall[0]();
    });
    expect(getByTestId('app-sidebar').getAttribute('data-open')).toBe('false');
    expect(useTopLevelViewStore.getState().view.kind).toBe('agents');
  });
});

describe('Mobile drawer width controls', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(true);
  });
  async function renderOpenDrawer() {
    const view = render(<App />);
    act(() => useTopLevelViewStore.getState().openPlugins());
    await view.findByTestId('plugins-view');
    fireEvent.click(view.getByRole('button', { name: 'Open menu' }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Expand menu width' }).hasAttribute('disabled')).toBe(false));
    return { ...view,
      width: () => view.getByTestId('drawer-panel').style.width,
      isOpen: () => view.getByTestId('app-sidebar').getAttribute('data-open') === 'true' };
  }
  it('tracks Claudia by pixels after navigation activation and restores on cancellation', async () => {
    const view = render(<App />);
    const content = view.container.querySelector('main')!;
    const send = (type: string, x: number) => {
      const touch = { identifier: 1, target: content, clientX: x, clientY: 200 } as unknown as Touch;
      fireEvent(content, new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    };
    send('touchstart', 500);
    send('touchmove', 470);
    const panel = view.getByTestId('claudia-preview');
    expect(panel.style.transform).toBe(`translate3d(${window.innerWidth - 22}px, 0, 0)`);
    fireEvent(content, new TouchEvent('touchcancel', { bubbles: true, cancelable: true,
      touches: [], targetTouches: [], changedTouches: [{ identifier: 1, target: content, clientX: 470, clientY: 200 } as unknown as Touch] }));
    await waitFor(() => expect(panel.style.visibility).toBe('hidden'));
    expect(panel.style.transform).toBe(`translate3d(${window.innerWidth}px, 0, 0)`);
  });
  it('keeps the drawer visible and modal while a shared menu blocks navigation', async () => {
    const view = await renderOpenDrawer();
    const panel = view.getByTestId('drawer-panel');
    fireEvent.click(view.getByRole('button', { name: 'Drawer choices' }));
    expect(view.isOpen()).toBe(true);
    expect(view.width()).toBe('300px');
    expect(panel.style.visibility).toBe('visible');
    const content = view.container.querySelector('main')!;
    const touch = (type: string, x: number, end = false) => {
      const point = { identifier: 1, target: content, clientX: x, clientY: 200 } as unknown as Touch;
      fireEvent(content, new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: end ? [] : [point], targetTouches: end ? [] : [point], changedTouches: [point] }));
    };
    touch('touchstart', 500); touch('touchmove', 200); touch('touchend', 200, true);
    expect(panel.style.transform).toBe('translate3d(0px, 0, 0)');
    fireEvent.keyDown(view.getByRole('listbox'), { key: 'Escape' });
    expect(view.isOpen()).toBe(true);
    expect(view.width()).toBe('300px');
    expect(panel.style.visibility).toBe('visible');
  });
  it('switches reading width through the explicit expand and restore buttons', async () => {
    const view = await renderOpenDrawer();
    expect(view.width()).toBe('300px');
    fireEvent.click(view.getByRole('button', { name: 'Expand menu width' }));
    expect(view.width()).toBe('420px');
    expect(view.isOpen()).toBe(true);
    fireEvent.click(view.getByRole('button', { name: 'Restore menu width' }));
    expect(view.width()).toBe('300px');
  });
  it('retains modal presence while closing and reopens at compact width', async () => {
    const view = await renderOpenDrawer();
    fireEvent.click(view.getByRole('button', { name: 'Expand menu width' }));
    fireEvent.click(view.getByRole('button', { name: 'Close menu' }));
    expect(view.isOpen()).toBe(true);
    expect(view.width()).toBe('420px');
    await waitFor(() => expect(view.isOpen()).toBe(false));
    fireEvent.click(view.getByRole('button', { name: 'Open menu' }));
    expect(view.width()).toBe('300px');
  });
  it('steps Android back from wide to compact before closing', async () => {
    const view = await renderOpenDrawer();
    fireEvent.click(view.getByRole('button', { name: 'Expand menu width' }));
    const back = () => {
      const call = mockUseAndroidBack.mock.calls.filter(([, , priority]) => priority === 10).at(-1)!;
      expect(call[1]).toBe(true);
      act(() => call[0]());
    };
    back();
    expect(view.width()).toBe('300px');
    expect(view.isOpen()).toBe(true);
    back();
    await waitFor(() => expect(view.isOpen()).toBe(false));
    expect(view.getByTestId('drawer-panel').style.visibility).toBe('hidden');
  });
  it('repaints replacement drawer nodes after settings unmounts the shell', async () => {
    const view = await renderOpenDrawer();
    fireEvent.click(view.getByRole('button', { name: 'Open Settings' }));
    await view.findByTestId('settings-panel');
    fireEvent.click(view.getByRole('button', { name: 'Back to app' }));
    act(() => useTopLevelViewStore.getState().openPlugins());
    await view.findByTestId('plugins-view');
    expect(view.getByTestId('drawer-panel').style.width).toBe('300px');
    expect(view.isOpen()).toBe(false);
    fireEvent.click(view.getByRole('button', { name: 'Open menu' }));
    expect(view.getByTestId('drawer-panel').style.visibility).toBe('visible');
  });
});

describe('Android tablet control plane (desktop viewport, no embedded server)', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
    mockIsAndroid.mockReturnValue(false);
    mockShouldShowDirectGatewaySetup.mockReturnValue(false);
  });

  it('shows the gateway setup screen instead of the desktop shell when unconfigured', () => {
    mockIsAndroid.mockReturnValue(true);
    mockShouldShowDirectGatewaySetup.mockReturnValue(true);

    const { getByText, queryByTestId } = render(<App />);

    expect(getByText('Mobile setup')).toBeTruthy();
    expect(queryByTestId('app-sidebar')).toBeNull();
  });

  it('skips the embedded-server Connecting splash and renders the shell', () => {
    mockIsAndroid.mockReturnValue(true);
    // The desktop transport never connects on Android (no embedded server);
    // pre-fix this combination pinned the app on the Connecting splash.
    useRecoveryStore.setState({ transport: { status: 'connecting' } } as any);

    const { getByTestId, queryByText } = render(<App />);

    expect(queryByText('Connecting...')).toBeNull();
    expect(getByTestId('app-sidebar')).toBeTruthy();
  });

  it('keeps the desktop Connecting splash on non-Android desktop', () => {
    useRecoveryStore.setState({ transport: { status: 'connecting' } } as any);

    const { getByText, queryByTestId } = render(<App />);

    expect(getByText('Connecting...')).toBeTruthy();
    expect(queryByTestId('app-sidebar')).toBeNull();
  });
});

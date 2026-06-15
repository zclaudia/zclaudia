import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';

// Minimal mocks required so SettingsPanel mounts in the test environment.
// These mirror the pattern already established in SettingsPanel.test.tsx.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }));

vi.mock('../../stores/llmProfileMetaStore', () => {
  const state = {
    providersByBackend: {},
    providerCommands: {},
    providerCapabilities: {},
    setProviders: vi.fn(),
    getProviders: vi.fn().mockReturnValue([]),
    setProviderCommands: vi.fn(),
    setProviderCapabilities: vi.fn(),
  };
  const store: any = (selector?: (s: any) => any) => (selector ? selector(state) : state);
  store.getState = () => state;
  store.setState = vi.fn();
  store.subscribe = vi.fn(() => vi.fn());
  store.destroy = vi.fn();
  return { useLlmProfileMetaStore: store };
});

vi.mock('../../features/settings/LlmProfileManager', () => ({
  LlmProfileManager: ({ isOpen, inline }: any) =>
    isOpen ? <div data-testid="provider-manager" data-inline={inline}>ProviderManager</div> : null,
}));

vi.mock('../../features/settings/AgentManager', () => ({
  AgentManager: ({ isOpen, inline }: any) =>
    isOpen ? <div data-testid="agent-manager" data-inline={inline}>AgentManager</div> : null,
}));

vi.mock('../../features/settings/GeneralSettings', () => ({
  GeneralSettings: () => <div data-testid="general-settings">GeneralSettings</div>,
}));

vi.mock('../../features/settings/ServerGatewayConfig', () => ({
  ServerGatewayConfig: () => <div data-testid="server-gateway-config">ServerGatewayConfig</div>,
}));

vi.mock('../../features/settings/PluginSettings', () => ({
  PluginSettings: () => <div data-testid="plugin-settings">PluginSettings</div>,
}));

vi.mock('../../features/settings/McpServerSettings', () => ({
  McpServerSettings: () => <div data-testid="mcp-settings">McpServerSettings</div>,
}));

vi.mock('../../features/settings/WorkspaceSkillsSettings', () => ({
  WorkspaceSkillsSettings: () => <div data-testid="workspace-settings">WorkspaceSkillsSettings</div>,
}));

vi.mock('../../features/settings/AgentSettings', () => ({
  AgentSettings: () => <div data-testid="agent-settings">AgentSettings</div>,
}));

vi.mock('../../features/settings/PermissionSettings', () => ({
  PermissionSettings: () => <div data-testid="permission-settings">PermissionSettings</div>,
}));

vi.mock('../../features/settings/NotificationSettings', () => ({
  NotificationSettingsInline: () => <div data-testid="notification-settings">NotificationSettings</div>,
}));

vi.mock('../../features/settings/MobileGatewayConfig', () => ({
  MobileGatewayConfig: () => <div data-testid="mobile-gateway-config">MobileGatewayConfig</div>,
}));

vi.mock('../../features/settings/DebugSettings', () => ({
  DebugSettings: () => <div data-testid="debug-settings">DebugSettings</div>,
}));

vi.mock('../../features/workflows/api', () => ({
  listAllWorkflows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../hooks/useMediaQuery', () => ({ useIsMobile: () => false }));
vi.mock('../../hooks/useAndroidBack', () => ({ useAndroidBack: vi.fn() }));

vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    sendMessage: vi.fn(),
    connectServer: vi.fn(),
    embeddedServerStatus: 'running',
    embeddedServerError: null,
    embeddedServerPort: 3100,
    restartEmbeddedServer: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../services/api', () => ({
  getServerInfo: vi.fn(() => new Promise(() => {})),
  getAgentConfig: vi.fn(() => new Promise(() => {})),
  updateAgentConfig: vi.fn().mockResolvedValue({}),
  getNotificationConfig: vi.fn().mockResolvedValue({
    enabled: false,
    ntfyUrl: 'https://ntfy.sh',
    ntfyTopic: '',
    events: {
      permissionRequest: true,
      promptRequest: true,
      runCompleted: false,
      runFailed: false,
      backgroundPermission: false,
      processLeak: true,
    },
  }),
  getManagedProcesses: vi.fn(() => new Promise(() => {})),
  getCrashReports: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../../services/logger', () => ({
  exportLogs: vi.fn().mockReturnValue('[]'),
  getLogCount: vi.fn().mockReturnValue(0),
  clearLogs: vi.fn(),
}));

vi.mock('../../utils/platform', () => ({
  isAndroid: vi.fn(() => false),
  isMacOS: vi.fn(() => false),
  isTauri: vi.fn(() => false),
}));

vi.mock('@zclaudia/shared', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    DEFAULT_NOTIFICATION_CONFIG: {
      enabled: false,
      ntfyUrl: 'https://ntfy.sh',
      ntfyTopic: '',
      events: {
        permissionRequest: true,
        promptRequest: true,
        runCompleted: false,
        runFailed: false,
        supervisionUpdate: false,
        backgroundPermission: false,
        processLeak: true,
      },
    },
  };
});

import { SettingsPanel } from '../SettingsPanel';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useUIStore } from '../../stores/uiStore';
import { usePluginStore } from '../../stores/pluginStore';

function setupStores() {
  const localBackend = {
    backendId: 'local-standalone',
    name: 'Local',
    online: true,
    runtimeState: 'ready',
    isThisInstance: true,
    instanceId: 'instance-local',
  };

  useServerStore.setState({
    activeServerId: localBackend.backendId,
    connections: {
      [localBackend.backendId]: { status: 'connected', error: null, isLocalConnection: true, features: [] },
    },
    localServerPort: 3100,
    controlPlaneMode: 'embedded-local',
    setActiveServer: vi.fn(),
  } as any);

  useFacadeStore.setState({
    facade: null,
    mode: 'embedded',
    connectionState: 'connected',
    backends: [localBackend],
    sessionStreams: {},
    localBackendId: localBackend.backendId,
    currentInstanceId: 'instance-local',
    currentDeviceId: 'device-local',
    snapshotVersion: 1,
  } as any);

  useGatewayStore.setState({
    isConnected: false,
    showLocalBackend: false,
    directGatewayUrl: '',
    directGatewaySecret: '',
    setDirectGatewayConfig: vi.fn(),
    clearDirectGatewayConfig: vi.fn(),
  } as any);

  useUIStore.setState({
    fontSize: 'medium' as any,
    setFontSize: vi.fn(),
  } as any);

  usePluginStore.setState({
    plugins: [],
    settingsTabs: [],
    panels: [],
  } as any);
}

describe('SettingsPanel initialTab', () => {
  it('opens on the providers tab when initialTab="providers" is provided', async () => {
    setupStores();
    let container!: HTMLElement;
    await act(async () => {
      const view = render(
        <SettingsPanel isOpen initialTab="providers" onClose={() => {}} />,
      );
      container = view.container;
      await Promise.resolve();
    });
    // The providers tab content (ProviderManager) should be visible immediately
    expect(container.querySelector('[data-testid="provider-manager"]')).toBeTruthy();
    // The general-settings panel should NOT be visible
    expect(container.querySelector('[data-testid="general-settings"]')).toBeNull();
  });

  it('defaults to general tab when initialTab is not provided', async () => {
    setupStores();
    let container!: HTMLElement;
    await act(async () => {
      const view = render(<SettingsPanel isOpen onClose={() => {}} />);
      container = view.container;
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="general-settings"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="provider-manager"]')).toBeNull();
  });
});

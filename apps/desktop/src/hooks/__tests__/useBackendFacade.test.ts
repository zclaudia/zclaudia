import { renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const backendFacadeHookMocks = vi.hoisted(() => {
  function createFacadeMock() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      getSnapshot: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      onEvent: vi.fn(() => vi.fn()),
      openBackend: vi.fn(),
      closeBackend: vi.fn(),
      sendToBackend: vi.fn(),
      openSessionStream: vi.fn(),
      closeSessionStream: vi.fn(),
      catchUpContent: vi.fn(),
      getHttpBaseUrl: vi.fn(() => null),
      getHttpHeaders: vi.fn(() => ({})),
      forceReconnect: vi.fn(),
    };
  }

  const embeddedInstances: any[] = [];
  const directInstances: any[] = [];

  return {
    embeddedInstances,
    directInstances,
    getBrowserShellFacadeWsUrl: vi.fn(),
    EmbeddedFacadeClient: vi.fn(function (_target: unknown) {
      const target = _target;
      const instance = { ...createFacadeMock(), target };
      embeddedInstances.push(instance);
      return instance;
    }),
    DirectBackendFacadeProvider: vi.fn(function (_config: unknown) {
      const config = _config;
      const instance = { ...createFacadeMock(), config };
      directInstances.push(instance);
      return instance;
    }),
    refreshNotificationConfig: vi.fn(() => Promise.resolve()),
    appLifecycleManager: {
      start: vi.fn(),
      stop: vi.fn(),
    },
  };
});

vi.mock('../../services/messageHandler', () => ({
  handleServerMessage: vi.fn(),
  cleanupServerSyncState: vi.fn(),
}));

vi.mock('../../facade/embedded-facade-client', () => ({
  EmbeddedFacadeClient: backendFacadeHookMocks.EmbeddedFacadeClient,
}));

vi.mock('../../facade/direct-provider', () => ({
  DirectBackendFacadeProvider: backendFacadeHookMocks.DirectBackendFacadeProvider,
}));

vi.mock('../../utils/browserShellRuntime', () => ({
  getBrowserShellFacadeWsUrl: backendFacadeHookMocks.getBrowserShellFacadeWsUrl,
}));

vi.mock('../../services/api/notifications', () => ({
  refreshNotificationConfig: backendFacadeHookMocks.refreshNotificationConfig,
}));

vi.mock('../../services/appLifecycleManager', () => ({
  appLifecycleManager: backendFacadeHookMocks.appLifecycleManager,
}));

import { syncToGatewayStore, useBackendFacade } from '../useBackendFacade';
import { useFacadeStore } from '../../stores/facadeStore';
import { useToastStore } from '../../stores/toastStore';
import { handleServerMessage } from '../../services/messageHandler';
import { useServerStore } from '../../stores/serverStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useRunStore } from '../../stores/runStore';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { useSessionConfigStore } from '../../stores/sessionConfigStore';
import { useComposerStore } from '../../stores/composerStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useSessionRunStateStore } from '../../stores/sessionRunStateStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalRegistry } from '../../services/terminal/TerminalRegistry';

describe('useBackendFacade run_event forwarding', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useToastStore.setState({ toasts: [] });
    useServerStore.setState({
      activeServerId: null,
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'embedded-local',
    });
    useFacadeStore.setState({
      facade: null,
      mode: 'embedded',
      connectionState: 'connected',
      backends: [
        {
          backendId: 'local-standalone',
          name: 'Local',
          online: true,
          runtimeState: 'ready',
          openState: 'open',
          isThisInstance: true,
          instanceId: 'instance-local',
        } as any,
      ],
      sessionStreams: {},
      localBackendId: 'local-standalone',
      currentInstanceId: 'instance-local',
      currentDeviceId: 'device-local',
      snapshotVersion: 1,
    });
    useGatewayStore.setState({
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
      backendAuthStatus: {},
      directGatewayUrl: null,
      directGatewaySecret: null,
      lastActiveBackendId: null,
      showLocalBackend: false,
    });
    useRunStore.setState({
      activeRuns: {},
      backgroundRunIds: new Set(),
      runHealth: {},
      activeToolCalls: {},
      toolCallsHistory: {},
      runContentBlocks: {},
    } as any);
    useChatMessageStore.setState({
      messages: {},
      pagination: {},
    } as any);
    useSessionConfigStore.setState({
      systemInfoBySession: {},
      modeBySession: {},
      runtimeModes: {},
      sessionUsage: {},
      compactionNotice: {},
    } as any);
    useComposerStore.setState({ drafts: {}, pendingPrefills: {} });
    useSessionRunStateStore.setState({ records: {} });
    useProjectStore.setState({
      projects: [],
      sessions: [{ id: 'session-1', projectId: 'project-1', name: 'Session 1', isActive: true }],
      dataServerId: null,
      selectedProjectId: null,
      selectedSessionId: null,
      dashboardViews: {},
      providers: [],
      providerCommands: {},
      providerCapabilities: {},
    } as any);
    useSessionsStore.setState({
      remoteSessions: new Map([
        [
          'remote-1',
          [
            {
              id: 'session-1',
              projectId: '',
              name: 'Session 1',
              createdAt: 1,
              updatedAt: 1,
              isActive: true,
              type: 'regular',
            },
          ],
        ],
      ]),
      activeSessionIdsByBackend: new Map([['remote-1', new Set(['session-1'])]]),
    } as any);
    useOwnershipStore.setState({
      sessionBackendIds: { 'session-1': 'remote-1' },
      projectBackendIds: {},
      taskOwners: {},
    } as any);
    useTerminalStore.setState({
      terminals: {},
      readyTerminals: new Set(),
      drawerOpen: {},
      ctrlActive: {},
      poppedOutTerminals: {},
      reattachTerminals: {},
    } as any);
    backendFacadeHookMocks.embeddedInstances.length = 0;
    backendFacadeHookMocks.directInstances.length = 0;
    backendFacadeHookMocks.getBrowserShellFacadeWsUrl.mockReturnValue(null);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    consoleWarnSpy.mockRestore();
  });

  it('uses browser shell facade URL before waiting for embedded server port', () => {
    const browserFacadeUrl = 'ws://127.0.0.1:3100/ws/backend-facade';
    backendFacadeHookMocks.getBrowserShellFacadeWsUrl.mockReturnValue(browserFacadeUrl);
    useServerStore.setState({ ...useServerStore.getState(), localServerPort: null });
    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      directGatewayUrl: null,
      directGatewaySecret: null,
    });

    const { unmount } = renderHook(() => useBackendFacade());

    expect(backendFacadeHookMocks.EmbeddedFacadeClient).toHaveBeenCalledWith({
      url: browserFacadeUrl,
    });
    expect(backendFacadeHookMocks.DirectBackendFacadeProvider).not.toHaveBeenCalled();
    expect(useFacadeStore.getState().facade).toBe(backendFacadeHookMocks.embeddedInstances[0]);
    expect(backendFacadeHookMocks.embeddedInstances[0].connect).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('waits for embedded server port when browser shell URL is unavailable', () => {
    backendFacadeHookMocks.getBrowserShellFacadeWsUrl.mockReturnValue(null);
    useServerStore.setState({ ...useServerStore.getState(), localServerPort: null });
    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      directGatewayUrl: null,
      directGatewaySecret: null,
    });

    const { unmount } = renderHook(() => useBackendFacade());

    expect(backendFacadeHookMocks.EmbeddedFacadeClient).not.toHaveBeenCalled();
    expect(backendFacadeHookMocks.DirectBackendFacadeProvider).not.toHaveBeenCalled();
    expect(useFacadeStore.getState().facade).toBeNull();

    unmount();
  });

  it('uses direct provider in direct gateway mode without creating embedded client', () => {
    backendFacadeHookMocks.getBrowserShellFacadeWsUrl.mockReturnValue(
      'ws://127.0.0.1:3100/ws/backend-facade'
    );
    useServerStore.setState({ ...useServerStore.getState(), localServerPort: null });
    useGatewayStore.setState({
      ...useGatewayStore.getState(),
      directGatewayUrl: 'wss://gateway.example/ws',
      directGatewaySecret: 'secret-1',
    });

    const { unmount } = renderHook(() => useBackendFacade());

    expect(backendFacadeHookMocks.DirectBackendFacadeProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'wss://gateway.example/ws',
        gatewaySecret: 'secret-1',
      })
    );
    expect(backendFacadeHookMocks.EmbeddedFacadeClient).not.toHaveBeenCalled();
    expect(useFacadeStore.getState().facade).toBe(backendFacadeHookMocks.directInstances[0]);
    expect(backendFacadeHookMocks.directInstances[0].connect).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('forwards local backend run events to the shared message handler', () => {
    const serverEvent = {
      type: 'run_started',
      runId: 'run-1',
      sessionId: 'session-1',
      clientRequestId: 'client-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
    } as any;

    syncToGatewayStore({
      type: 'run_event',
      backendId: 'local-standalone',
      event: serverEvent,
    } as any);

    expect(handleServerMessage).toHaveBeenCalledWith(
      serverEvent,
      expect.objectContaining({
        serverId: 'local-standalone',
        backendId: 'local-standalone',
        logTag: 'Facade:local-standalone',
      })
    );
  });

  it('forwards backend messages without sessionId to the shared message handler', () => {
    const serverMessage = {
      type: 'terminal_output',
      terminalId: 'term-1',
      data: 'prompt',
    } as any;

    syncToGatewayStore({
      type: 'backend_message_received',
      backendId: 'local-standalone',
      message: serverMessage,
    } as any);

    expect(handleServerMessage).toHaveBeenCalledWith(
      serverMessage,
      expect.objectContaining({
        serverId: 'local-standalone',
        backendId: 'local-standalone',
        logTag: 'Facade:local-standalone',
      })
    );
  });

  it('shows toast when content catch-up fails', () => {
    syncToGatewayStore({
      type: 'content_patch_failed',
      backendId: 'local-standalone',
      sessionId: 'session-1',
      afterOffset: 12,
      error: 'catch-up query failed',
    } as any);

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      title: 'Message sync failed',
      message: 'catch-up query failed',
    });
  });

  it('syncs backend capabilities into server features on snapshot updates', () => {
    syncToGatewayStore({
      type: 'snapshot_updated',
      snapshot: {
        snapshotVersion: 2,
        capturedAt: Date.now(),
        mode: 'embedded',
        connectionState: 'connected',
        localBackendId: 'local-standalone',
        currentInstanceId: 'instance-local',
        currentDeviceId: 'device-local',
        sessionStreams: {},
        backends: [
          {
            backendId: 'local-standalone',
            name: 'Local',
            online: true,
            runtimeState: 'ready',
            openState: 'open',
            channelId: 'ch-1',
            instanceId: 'instance-local',
            deviceId: 'device-local',
            channel: 'local',
            isThisInstance: true,
            isThisDevice: true,
            capabilities: ['remoteTerminal'],
          },
        ],
      },
    } as any);

    expect(useServerStore.getState().connections['local-standalone']).toMatchObject({
      features: ['remoteTerminal'],
    });
    expect(useServerStore.getState().activeServerSupports('remoteTerminal')).toBe(true);
  });

  it('migrates a stale local backend selection to the current local backend id', () => {
    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      localBackendId: 'local-embedded',
      backends: [
        {
          backendId: 'local-embedded',
          name: 'Local',
          online: true,
          runtimeState: 'ready',
          openState: 'open',
          isThisInstance: true,
          instanceId: 'instance-local',
          channel: 'local',
        } as any,
      ],
    });
    useServerStore.setState({
      ...useServerStore.getState(),
      activeServerId: 'local-standalone',
    });

    syncToGatewayStore({
      type: 'snapshot_updated',
      snapshot: {
        snapshotVersion: 4,
        capturedAt: Date.now(),
        mode: 'embedded',
        connectionState: 'connected',
        localBackendId: 'local-embedded',
        currentInstanceId: 'instance-local',
        currentDeviceId: 'device-local',
        sessionStreams: {},
        backends: [
          {
            backendId: 'local-embedded',
            name: 'Local',
            online: true,
            runtimeState: 'ready',
            openState: 'open',
            channelId: 'ch-local',
            instanceId: 'instance-local',
            deviceId: 'device-local',
            channel: 'local',
            isThisInstance: true,
            isThisDevice: true,
            capabilities: [],
          },
        ],
      },
    } as any);

    expect(useServerStore.getState().activeServerId).toBe('local-embedded');
  });

  it('deduplicates deferred auto-open across repeated snapshots', () => {
    const openBackend = vi.fn();
    useFacadeStore.setState({
      ...useFacadeStore.getState(),
      facade: {
        getSnapshot: () => ({
          backends: [{ backendId: 'remote-1', openState: 'unsubscribed', runtimeState: 'visible' }],
        }),
        openBackend,
      } as any,
    });
    useServerStore.setState({
      ...useServerStore.getState(),
      activeServerId: 'remote-1',
    });

    const snapshot = {
      snapshotVersion: 2,
      capturedAt: Date.now(),
      mode: 'direct',
      connectionState: 'connected',
      localBackendId: null,
      currentInstanceId: 'instance-local',
      currentDeviceId: 'device-local',
      sessionStreams: {},
      backends: [
        {
          backendId: 'remote-1',
          name: 'Remote',
          online: true,
          runtimeState: 'visible',
          openState: 'unsubscribed',
          instanceId: 'instance-remote',
          deviceId: 'device-remote',
          channel: 'prod',
          isThisInstance: false,
          isThisDevice: false,
          capabilities: [],
        },
      ],
    };

    syncToGatewayStore({ type: 'snapshot_updated', snapshot } as any);
    syncToGatewayStore({ type: 'snapshot_updated', snapshot } as any);

    expect(openBackend).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(openBackend).toHaveBeenCalledTimes(1);
    expect(openBackend).toHaveBeenCalledWith('remote-1');
  });

  it('keeps active runs alive while a backend reconnects unexpectedly', () => {
    useRunStore.setState({
      ...useRunStore.getState(),
      activeRuns: { 'run-1': 'session-1' },
    });

    syncToGatewayStore({
      type: 'run_event',
      backendId: 'remote-1',
      event: {
        type: 'run_started',
        runId: 'run-1',
        sessionId: 'session-1',
        assistantMessageId: 'assistant-1',
      },
    } as any);

    syncToGatewayStore({
      type: 'backend_state_changed',
      backendId: 'remote-1',
      state: 'subscribing',
      error: 'peer_disconnected',
    } as any);

    expect(useRunStore.getState().activeRuns['run-1']).toBe('session-1');
    expect(
      useProjectStore.getState().sessions.find(s => s.id === 'session-1')?.lastRunStatus
    ).toBeUndefined();
    expect(
      Array.from(useSessionsStore.getState().activeSessionIdsByBackend.get('remote-1') ?? [])
    ).toEqual(['session-1']);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      type: 'error',
      title: 'Remote connection lost',
      message: expect.stringContaining('waiting to reconnect'),
    });
  });

  it('filters archived sessions out of backend data snapshots', () => {
    syncToGatewayStore({
      type: 'backend_data_snapshot',
      backendId: 'remote-1',
      sessions: [
        { sessionId: 'session-1', title: 'Active', createdAt: 1, updatedAt: 2, runStatus: 'idle' },
        {
          sessionId: 'session-archived',
          title: 'Archived',
          createdAt: 3,
          updatedAt: 4,
          runStatus: 'idle',
          archived: true,
        },
      ],
      projects: [],
    } as any);

    expect(useSessionsStore.getState().remoteSessions.get('remote-1')).toEqual([
      expect.objectContaining({ id: 'session-1', name: 'Active' }),
    ]);
  });

  it('backend_data_snapshot initializes recoveryStore data sync as ready and stamps ownership', () => {
    useRecoveryStore.setState({
      backends: {
        'remote-1': {
          backendId: 'remote-1',
          status: 'ready',
          subscribed: true,
          dataReady: false,
          retryCount: 0,
          lastError: null,
          lastCloseReason: null,
          statusEnteredAt: Date.now(),
        },
      },
      dataSyncs: {},
      nextOwnershipVersion: 1,
    } as any);

    syncToGatewayStore({
      type: 'backend_data_snapshot',
      backendId: 'remote-1',
      sessions: [
        { sessionId: 's1', title: 'S1', createdAt: 1, updatedAt: 2, runStatus: 'idle' },
        { sessionId: 's2', title: 'S2', createdAt: 3, updatedAt: 4, runStatus: 'idle' },
      ],
      projects: [],
    } as any);

    const dataSync = useRecoveryStore.getState().dataSyncs['remote-1'];
    expect(dataSync).toBeDefined();
    expect(dataSync.status).toBe('ready');
    expect(dataSync.ownershipVersion).toBe(1);

    const backend = useRecoveryStore.getState().backends['remote-1'];
    expect(backend.dataReady).toBe(true);
    expect(backend.status).toBe('ready');
  });

  it('cleans up stale runs only for the snapshot backend', () => {
    useRunStore.getState().startRun('run-remote', 'session-1');
    useRunStore.getState().startRun('run-local', 'session-local');
    useProjectStore.setState({
      ...useProjectStore.getState(),
      sessions: [
        { id: 'session-1', projectId: 'project-1', name: 'Session 1', isActive: true },
        { id: 'session-local', projectId: 'project-local', name: 'Local Session', isActive: true },
      ],
    } as any);
    useOwnershipStore.getState().setSessionOwner('session-1', 'remote-1');
    useOwnershipStore.getState().setSessionOwner('session-local', 'local-standalone');

    syncToGatewayStore({
      type: 'backend_data_snapshot',
      backendId: 'remote-1',
      sessions: [],
      projects: [],
    } as any);

    expect(useRunStore.getState().activeRuns['run-remote']).toBeUndefined();
    expect(useRunStore.getState().activeRuns['run-local']).toBe('session-local');
  });

  it('snapshot stale-run cleanup clears backend activity markers', () => {
    useRunStore.getState().startRun('run-1', 'session-1');
    useOwnershipStore.getState().setSessionOwner('session-1', 'remote-1');

    syncToGatewayStore({
      type: 'run_event',
      backendId: 'remote-1',
      event: {
        type: 'run_started',
        runId: 'run-1',
        sessionId: 'session-1',
        assistantMessageId: 'assistant-1',
      },
    } as any);

    syncToGatewayStore({
      type: 'backend_data_snapshot',
      backendId: 'remote-1',
      sessions: [],
      projects: [],
    } as any);

    syncToGatewayStore({
      type: 'backend_state_changed',
      backendId: 'remote-1',
      state: 'error',
      error: 'transport_disconnected',
    } as any);

    expect(useRunStore.getState().activeRuns['run-1']).toBeUndefined();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('cleans legacy stores when backends are removed from the registry', () => {
    useProjectStore.getState().replaceProjectsForBackend('remote-1', [
      {
        id: 'project-1',
        name: 'Remote Project',
        type: 'code',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(useSessionsStore.getState().remoteSessions.has('remote-1')).toBe(true);
    expect(useOwnershipStore.getState().getSessionBackendId('session-1')).toBe('remote-1');
    expect(useOwnershipStore.getState().getProjectBackendId('project-1')).toBe('remote-1');

    syncToGatewayStore({
      type: 'backends_removed',
      backendIds: ['remote-1'],
    } as any);

    expect(useSessionsStore.getState().remoteSessions.has('remote-1')).toBe(false);
    expect(useSessionsStore.getState().activeSessionIdsByBackend.has('remote-1')).toBe(false);
    expect(useProjectStore.getState().projects).toEqual([]);
    expect(useOwnershipStore.getState().getSessionBackendId('session-1')).toBeNull();
    expect(useOwnershipStore.getState().getProjectBackendId('project-1')).toBeNull();
  });

  it('removes archived sessions on backend data upsert events', () => {
    useSessionsStore.setState({
      ...useSessionsStore.getState(),
      remoteSessions: new Map([
        [
          'remote-1',
          [
            {
              id: 'session-1',
              projectId: '',
              name: 'Session 1',
              createdAt: 1,
              updatedAt: 1,
              isActive: false,
              type: 'regular',
            },
            {
              id: 'session-2',
              projectId: '',
              name: 'Session 2',
              createdAt: 2,
              updatedAt: 2,
              isActive: false,
              type: 'regular',
            },
          ],
        ],
      ]),
      activeSessionIdsByBackend: new Map([['remote-1', new Set()]]),
    } as any);

    syncToGatewayStore({
      type: 'backend_data_event',
      backendId: 'remote-1',
      event: {
        type: 'backend_resource_event',
        op: 'upsert',
        resourceType: 'session',
        resourceId: 'session-2',
        resource: {
          sessionId: 'session-2',
          title: 'Session 2',
          createdAt: 2,
          updatedAt: 3,
          runStatus: 'idle',
          archived: true,
        },
      },
    } as any);

    expect(useSessionsStore.getState().remoteSessions.get('remote-1')).toEqual([
      expect.objectContaining({ id: 'session-1', name: 'Session 1' }),
    ]);
  });

  it('upserts remote projects with the event backend owner instead of the active backend', () => {
    useServerStore.setState({
      ...useServerStore.getState(),
      activeServerId: 'local-standalone',
    });
    useProjectStore.setState({
      ...useProjectStore.getState(),
      projects: [
        { id: 'project-1', name: 'Local Project', type: 'code', createdAt: 1, updatedAt: 1 },
      ],
    } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      projectBackendIds: { 'project-1': 'local-standalone' },
    } as any);

    syncToGatewayStore({
      type: 'backend_data_event',
      backendId: 'remote-1',
      event: {
        type: 'backend_resource_event',
        op: 'upsert',
        resourceType: 'project',
        resourceId: 'project-2',
        resource: {
          projectId: 'project-2',
          name: 'Remote Project',
          createdAt: 10,
          updatedAt: 11,
        },
      },
    } as any);

    expect(useProjectStore.getState().projects).toEqual([
      expect.objectContaining({ id: 'project-1', name: 'Local Project' }),
      expect.objectContaining({ id: 'project-2', name: 'Remote Project' }),
    ]);
    expect(useOwnershipStore.getState().getProjectBackendId('project-2')).toBe('remote-1');
  });

  it('removes only the project owned by the event backend', () => {
    useProjectStore.setState({
      ...useProjectStore.getState(),
      projects: [
        { id: 'shared-project', name: 'Remote Project', type: 'code', createdAt: 1, updatedAt: 1 },
        { id: 'local-project', name: 'Local Project', type: 'code', createdAt: 2, updatedAt: 2 },
      ],
    } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      projectBackendIds: {
        'shared-project': 'remote-1',
        'local-project': 'local-standalone',
      },
    } as any);

    syncToGatewayStore({
      type: 'backend_data_event',
      backendId: 'local-standalone',
      event: {
        type: 'backend_resource_event',
        op: 'remove',
        resourceType: 'project',
        resourceId: 'shared-project',
      },
    } as any);

    expect(useProjectStore.getState().projects).toEqual([
      expect.objectContaining({ id: 'shared-project', name: 'Remote Project' }),
      expect.objectContaining({ id: 'local-project', name: 'Local Project' }),
    ]);

    syncToGatewayStore({
      type: 'backend_data_event',
      backendId: 'remote-1',
      event: {
        type: 'backend_resource_event',
        op: 'remove',
        resourceType: 'project',
        resourceId: 'shared-project',
      },
    } as any);

    expect(useProjectStore.getState().projects).toEqual([
      expect.objectContaining({ id: 'local-project', name: 'Local Project' }),
    ]);
  });

  it('ignores project_upsert when another backend already owns the same project id', () => {
    useProjectStore.setState({
      ...useProjectStore.getState(),
      projects: [
        { id: 'shared-project', name: 'Remote Project', type: 'code', createdAt: 1, updatedAt: 1 },
      ],
    } as any);
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      projectBackendIds: {
        'shared-project': 'remote-1',
      },
    } as any);

    syncToGatewayStore({
      type: 'backend_data_event',
      backendId: 'local-standalone',
      event: {
        type: 'backend_resource_event',
        op: 'upsert',
        resourceType: 'project',
        resourceId: 'shared-project',
        resource: {
          projectId: 'shared-project',
          name: 'Local Collision',
          createdAt: 10,
          updatedAt: 11,
        },
      },
    } as any);

    expect(useProjectStore.getState().projects).toEqual([
      expect.objectContaining({ id: 'shared-project', name: 'Remote Project' }),
    ]);
    expect(useOwnershipStore.getState().getProjectBackendId('shared-project')).toBe('remote-1');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring project event collision for shared-project')
    );
  });

  it('detaches remote terminals on transport disconnect', () => {
    const t1 = terminalRegistry.getOrCreate('terminal-1', {
      terminalId: 'terminal-1',
      sendMessage: vi.fn(),
      getTheme: () => ({}) as any,
      factories: {
        createTerminal: () =>
          ({
            cols: 80,
            rows: 24,
            options: {},
            open: vi.fn(),
            dispose: vi.fn(),
            loadAddon: vi.fn(),
            write: vi.fn(),
            writeln: vi.fn(),
            focus: vi.fn(),
            onData: () => ({ dispose: vi.fn() }),
          }) as any,
        createFitAddon: () => ({ fit: vi.fn(), dispose: vi.fn(), activate: vi.fn() }) as any,
      },
    });
    // Drive controller into 'open' so detach is allowed
    t1.open({ projectId: 'project-1' });
    t1.handleServerMessage({
      type: 'terminal_opened',
      terminalId: 'terminal-1',
      success: true,
    } as any);

    useTerminalStore.setState({
      ...useTerminalStore.getState(),
      terminals: {
        'remote-1::project-1': 'terminal-1',
        'remote-2::project-1': 'terminal-2',
      },
    });

    syncToGatewayStore({
      type: 'backend_state_changed',
      backendId: 'remote-1',
      state: 'offline',
      error: 'transport_disconnected',
    } as any);

    expect(t1.getState().kind).toBe('detached');
    terminalRegistry.delete('terminal-1');
  });

  it('does not detach terminals when backend was user-closed', () => {
    const t1 = terminalRegistry.getOrCreate('terminal-1', {
      terminalId: 'terminal-1',
      sendMessage: vi.fn(),
      getTheme: () => ({}) as any,
      factories: {
        createTerminal: () =>
          ({
            cols: 80,
            rows: 24,
            options: {},
            open: vi.fn(),
            dispose: vi.fn(),
            loadAddon: vi.fn(),
            write: vi.fn(),
            writeln: vi.fn(),
            focus: vi.fn(),
            onData: () => ({ dispose: vi.fn() }),
          }) as any,
        createFitAddon: () => ({ fit: vi.fn(), dispose: vi.fn(), activate: vi.fn() }) as any,
      },
    });
    t1.open({ projectId: 'project-1' });
    t1.handleServerMessage({
      type: 'terminal_opened',
      terminalId: 'terminal-1',
      success: true,
    } as any);

    useTerminalStore.setState({
      ...useTerminalStore.getState(),
      terminals: { 'remote-1::project-1': 'terminal-1' },
    });

    syncToGatewayStore({
      type: 'backend_state_changed',
      backendId: 'remote-1',
      state: 'offline',
      error: 'user_closed',
    } as any);

    expect(t1.getState().kind).toBe('open');
    terminalRegistry.delete('terminal-1');
  });
});

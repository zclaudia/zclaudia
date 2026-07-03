import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useActiveSessionStream } from '../useActiveSessionStream';
import { useFacadeStore } from '../../stores/facadeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useServerStore } from '../../stores/serverStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useChatMessageStore } from '../../stores/chatMessageStore';

describe('useActiveSessionStream', () => {
  const facade = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getSnapshot: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    onEvent: vi.fn(() => () => {}),
    openBackend: vi.fn(),
    closeBackend: vi.fn(),
    sendToBackend: vi.fn(),
    openSessionStream: vi.fn(),
    closeSessionStream: vi.fn(),
    catchUpContent: vi.fn(),
    getHttpBaseUrl: vi.fn(() => null),
    getHttpHeaders: vi.fn(() => ({})),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    useFacadeStore.setState({
      facade: facade as any,
      mode: 'embedded',
      connectionState: 'connected',
      backends: [],
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      snapshotVersion: 0,
      reconnectGeneration: 0,
    });

    // useActiveSessionStream sources the active session from the selection store.
    useSelectionStore.setState({ selectedSessionId: 'session-1' } as any);

    useProjectStore.setState({
      projects: [],
      sessions: [],
      providers: [],
      dataServerId: null,
      selectedProjectId: 'project-1',
      selectedSessionId: 'session-1',
      dashboardViews: {},
      providerCommands: {},
      providerCapabilities: {},
    });

    useServerStore.setState(state => ({
      ...state,
      activeServerId: 'backend-1',
    }));

    useOwnershipStore.setState({
      sessionBackendIds: { 'session-1': 'backend-1' },
      projectBackendIds: {},
      taskOwners: {},
    });

    // The route hook reads catch-up offset from the chat message store pagination.
    useChatMessageStore.setState({
      messages: {},
      pagination: { 'session-1': { maxOffset: 12 } },
    } as any);
  });

  it('opens the selected session stream and closes it on unmount', () => {
    const { unmount } = renderHook(() => useActiveSessionStream());

    expect(facade.openBackend).toHaveBeenCalledWith('backend-1');
    expect(facade.openSessionStream).toHaveBeenCalledWith('backend-1', 'session-1');

    unmount();

    expect(facade.closeSessionStream).toHaveBeenCalledWith('backend-1', 'session-1');
  });

  it('requests catch-up once the stream becomes open', () => {
    const { rerender } = renderHook(() => useActiveSessionStream());

    expect(facade.catchUpContent).not.toHaveBeenCalled();

    act(() => {
      useFacadeStore.setState(state => ({
        ...state,
        sessionStreams: {
          ...state.sessionStreams,
          'backend-1:session-1': {
            streamKey: 'backend-1:session-1',
            backendId: 'backend-1',
            sessionId: 'session-1',
            state: 'open',
            channelId: 'channel-1',
            latestOffset: 12,
            updatedAt: Date.now(),
          },
        },
      }));
    });

    rerender();

    expect(facade.catchUpContent).toHaveBeenCalledWith('backend-1', 'session-1', 12);
  });

  it('switches streams when the selected session changes', () => {
    const { rerender } = renderHook(() => useActiveSessionStream());

    act(() => {
      useOwnershipStore.setState(state => ({
        ...state,
        sessionBackendIds: {
          ...state.sessionBackendIds,
          'session-2': 'backend-2',
        },
      }));
      useSelectionStore.setState({ selectedSessionId: 'session-2' } as any);
      useServerStore.setState(state => ({
        ...state,
        activeServerId: 'backend-2',
      }));
    });

    rerender();

    expect(facade.closeSessionStream).toHaveBeenCalledWith('backend-1', 'session-1');
    expect(facade.openBackend).toHaveBeenCalledWith('backend-2');
    expect(facade.openSessionStream).toHaveBeenCalledWith('backend-2', 'session-2');
  });
});

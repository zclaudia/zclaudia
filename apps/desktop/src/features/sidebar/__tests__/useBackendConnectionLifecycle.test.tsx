import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackendConnectionLifecycle } from '../useBackendConnectionLifecycle';

const connectServer = vi.fn();
const disconnectServer = vi.fn();
const isServerConnected = vi.fn(() => false);

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ connectServer, disconnectServer, isServerConnected }),
}));

const expansionState = { expandedBackendIds: [] as string[] };
vi.mock('../../../stores/sidebarExpansionStore', () => ({
  useSidebarExpansionStore: (selector: any) => selector(expansionState),
}));

const serverState = { activeServerId: 'local' as string | null };
vi.mock('../../../stores/serverStore', () => ({
  useServerStore: (selector: any) => selector(serverState),
}));

const facadeState = { localBackendId: 'local' as string | null };
vi.mock('../../../stores/facadeStore', () => ({
  useFacadeStore: (selector: any) => selector(facadeState),
}));

describe('useBackendConnectionLifecycle', () => {
  beforeEach(() => {
    connectServer.mockClear();
    disconnectServer.mockClear();
    isServerConnected.mockReturnValue(false);
    expansionState.expandedBackendIds = [];
    serverState.activeServerId = 'local';
    facadeState.localBackendId = 'local';
  });

  it('connects a remote backend when it is expanded', () => {
    expansionState.expandedBackendIds = ['remote-1'];
    renderHook(() => useBackendConnectionLifecycle());
    expect(connectServer).toHaveBeenCalledWith('remote-1');
    expect(disconnectServer).not.toHaveBeenCalled();
  });

  it('does not connect the local backend on expand', () => {
    expansionState.expandedBackendIds = ['local'];
    renderHook(() => useBackendConnectionLifecycle());
    expect(connectServer).not.toHaveBeenCalled();
  });

  it('disconnects a remote backend after it is collapsed', () => {
    expansionState.expandedBackendIds = ['remote-1'];
    // Not yet connected at expand time -> the hook opens it and takes ownership.
    isServerConnected.mockReturnValue(false);
    const { rerender } = renderHook(() => useBackendConnectionLifecycle());
    expect(connectServer).toHaveBeenCalledWith('remote-1');
    connectServer.mockClear();
    // Now it is connected; collapsing must close the connection the hook owns.
    isServerConnected.mockReturnValue(true);

    expansionState.expandedBackendIds = [];
    rerender();
    expect(disconnectServer).toHaveBeenCalledWith('remote-1');
  });

  it('keeps the foreground remote backend connected when collapsed', () => {
    expansionState.expandedBackendIds = ['remote-1'];
    serverState.activeServerId = 'remote-1';
    isServerConnected.mockReturnValue(true);
    const { rerender } = renderHook(() => useBackendConnectionLifecycle());

    expansionState.expandedBackendIds = [];
    rerender();
    expect(disconnectServer).not.toHaveBeenCalled();
  });
});

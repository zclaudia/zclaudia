import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
}));

vi.mock('../../../hooks/useWslDiscovery', () => {
  const runDiscovery = vi.fn();
  return {
    useWslDiscovery: () => ({
      wslAvailable: null,
      distros: [],
      runDiscovery,
    }),
  };
});

// Mutable connection mock so tests can flip wslServer and drive the
// auto-connect effect (a second handleConnect invocation without a click).
const { connectionMock } = vi.hoisted(() => ({
  connectionMock: {
    connectServer: vi.fn(),
    wslServer: { status: 'idle', port: null as number | null },
  },
}));

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => connectionMock,
}));

import { WindowsSetup } from '../WindowsSetup';
import { LEGACY_LOCAL_SERVER_ID } from '../../../actions/controlPlane';
import { useGatewayStore } from '../../../stores/gatewayStore';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useRecoveryStore } from '../../../stores/recoveryStore';
import { useServerStore } from '../../../stores/serverStore';

// Captured before any test can swap in a spy, so each test starts with the
// real store actions (tests below replace setActiveServer temporarily).
const realSetActiveServer = useServerStore.getState().setActiveServer;

function backendRecoveryState(status: string) {
  return {
    backendId: LEGACY_LOCAL_SERVER_ID,
    status,
    subscribed: false,
    dataReady: false,
    retryCount: 0,
    lastError: null,
    lastCloseReason: null,
    statusEnteredAt: Date.now(),
  };
}

/** Navigate from the landing screen to the gateway form and press Connect. */
function connectThroughGatewayForm() {
  fireEvent.click(screen.getByRole('button', { name: /Gateway/ }));
  fireEvent.change(screen.getByPlaceholderText('http://gateway.example.com:3200'), {
    target: { value: 'https://gateway.example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('Enter gateway secret'), {
    target: { value: 'secret-1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
}

describe('WindowsSetup connection timer cleanup', () => {
  beforeEach(() => {
    connectionMock.connectServer.mockReset();
    connectionMock.wslServer = { status: 'idle', port: null };

    useGatewayStore.setState({
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
      backendAuthStatus: {},
      directGatewayUrl: null,
      directGatewaySecret: null,
      lastActiveBackendId: null,
      subscribedBackendIds: [],
      showLocalBackend: false,
    } as any);

    useFacadeStore.setState({
      facade: null,
      mode: 'direct',
      connectionState: 'idle',
      connectionError: null,
      backends: [],
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      snapshotVersion: 0,
    });

    useServerStore.setState({
      ...useServerStore.getState(),
      activeServerId: null,
      localServerPort: null,
      setActiveServer: realSetActiveServer,
    });

    useRecoveryStore.setState(state => ({
      ...state,
      transport: {
        ...state.transport,
        status: 'idle',
        error: null,
      },
      backends: {},
      dataSyncs: {},
    }));
  });

  describe('local server connect (handleConnect)', () => {
    it('activates the local backend and stops polling once it reports ready', () => {
      vi.useFakeTimers();
      try {
        render(<WindowsSetup />);
        fireEvent.click(screen.getByText('Or enter server address manually'));
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        expect(screen.getByText('Connecting...')).toBeInTheDocument();
        expect(vi.getTimerCount()).toBe(1);

        const setActiveServerSpy = vi.fn(realSetActiveServer);
        act(() => {
          useServerStore.setState({ setActiveServer: setActiveServerSpy });
        });

        // Not ready yet: the poll ticks but must not activate anything.
        act(() => {
          vi.advanceTimersByTime(500);
        });
        expect(setActiveServerSpy).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);

        act(() => {
          useRecoveryStore.setState(state => ({
            backends: { [LEGACY_LOCAL_SERVER_ID]: backendRecoveryState('ready') },
          }));
        });
        act(() => {
          vi.advanceTimersByTime(500);
        });

        expect(setActiveServerSpy).toHaveBeenCalledTimes(1);
        expect(setActiveServerSpy).toHaveBeenCalledWith(LEGACY_LOCAL_SERVER_ID);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops polling and never activates the backend after unmount', () => {
      vi.useFakeTimers();
      try {
        const { unmount } = render(<WindowsSetup />);
        fireEvent.click(screen.getByText('Or enter server address manually'));
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        expect(vi.getTimerCount()).toBe(1);

        const setActiveServerSpy = vi.fn(realSetActiveServer);
        act(() => {
          useServerStore.setState({ setActiveServer: setActiveServerSpy });
        });

        unmount();

        expect(vi.getTimerCount()).toBe(0);

        // Even if the backend becomes ready right after unmount, the leaked
        // poll must not fire again or touch the store.
        act(() => {
          useRecoveryStore.setState(state => ({
            backends: { [LEGACY_LOCAL_SERVER_ID]: backendRecoveryState('ready') },
          }));
          vi.advanceTimersByTime(16_000);
        });

        expect(setActiveServerSpy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('replaces pending polling when a new connection attempt starts', async () => {
      vi.useFakeTimers();
      try {
        const { rerender } = render(<WindowsSetup />);

        connectionMock.wslServer = { status: 'ready', port: 41573 };
        rerender(<WindowsSetup />);
        expect(connectionMock.connectServer).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);

        connectionMock.wslServer = { status: 'ready', port: 41574 };
        rerender(<WindowsSetup />);

        // The second attempt supersedes the first instead of stacking intervals.
        expect(connectionMock.connectServer).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1);

        // The surviving poll still times out after 20 attempts like before.
        // Await act so the rejected-promise continuation (setConnectError)
        // settles inside act as well.
        await act(async () => {
          vi.advanceTimersByTime(10_000);
        });
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('gateway connect (handleGatewayConnect)', () => {
    it('stops polling and cancels the 15s timeout once connected', () => {
      vi.useFakeTimers();
      try {
        const { unmount } = render(<WindowsSetup />);
        connectThroughGatewayForm();

        expect(screen.getByText('Connecting...')).toBeInTheDocument();
        expect(vi.getTimerCount()).toBe(2);

        act(() => {
          useRecoveryStore.setState(state => ({
            transport: { ...state.transport, status: 'connected' },
          }));
        });
        act(() => {
          vi.advanceTimersByTime(500);
        });

        expect(screen.getByText('Gateway connected. Waiting for backends...')).toBeInTheDocument();
        expect(screen.queryByText(/Connection timed out/)).not.toBeInTheDocument();
        // The polling interval and the pending 15s timeout are both gone.
        expect(vi.getTimerCount()).toBe(0);

        // A later attempt starts with a clean timer slate (no stacking).
        act(() => {
          useRecoveryStore.setState(state => ({
            transport: { ...state.transport, status: 'idle' },
          }));
        });
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(vi.getTimerCount()).toBe(2);

        unmount();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops gateway polling and its 15s timeout after unmount', () => {
      vi.useFakeTimers();
      try {
        const { unmount } = render(<WindowsSetup />);
        connectThroughGatewayForm();

        expect(vi.getTimerCount()).toBe(2);

        unmount();

        expect(vi.getTimerCount()).toBe(0);

        // Even if the gateway connects right after unmount, nothing may poll
        // the recovery store again.
        const getStateSpy = vi.spyOn(useRecoveryStore, 'getState');
        act(() => {
          useRecoveryStore.setState(state => ({
            transport: { ...state.transport, status: 'connected' },
          }));
          vi.advanceTimersByTime(16_000);
        });

        expect(getStateSpy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('still reports the gateway timeout while mounted and leaves no timers', () => {
      vi.useFakeTimers();
      try {
        render(<WindowsSetup />);
        connectThroughGatewayForm();

        expect(vi.getTimerCount()).toBe(2);

        act(() => {
          vi.advanceTimersByTime(15_000);
        });

        expect(
          screen.getByText('Connection timed out. Please check the URL and secret.')
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

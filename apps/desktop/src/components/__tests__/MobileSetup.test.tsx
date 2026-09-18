import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    connectServer: vi.fn(),
  }),
}));

import { MobileSetup } from '../setup/MobileSetup';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useServerStore } from '../../stores/serverStore';

describe('MobileSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');

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

    useServerStore.setState(state => ({
      ...state,
      activeServerId: null,
    }));

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

  it('shows the real facade connection error instead of waiting for timeout', async () => {
    const { rerender } = render(<MobileSetup />);

    fireEvent.change(screen.getByPlaceholderText('http://gateway.example.com:3200'), {
      target: { value: 'https://gateway.example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter gateway secret'), {
      target: { value: 'secret-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await act(async () => {
      useFacadeStore.setState({
        connectionState: 'error',
        connectionError: 'UNAUTHORIZED: Invalid gateway secret',
      });
      useRecoveryStore.setState(state => ({
        ...state,
        transport: {
          ...state.transport,
          status: 'error',
          error: 'UNAUTHORIZED: Invalid gateway secret',
        },
      }));
    });
    rerender(<MobileSetup />);

    await waitFor(() => {
      expect(screen.getByText('UNAUTHORIZED: Invalid gateway secret')).toBeInTheDocument();
    });
  });

  it('does not fake a connecting state when the saved gateway is connected but has no backends', () => {
    vi.useFakeTimers();
    try {
      useGatewayStore.setState({
        directGatewayUrl: 'https://gateway.example.com',
        directGatewaySecret: 'secret-1',
      } as any);
      useFacadeStore.setState({ connectionState: 'connected', backends: [] });

      render(<MobileSetup />);

      const button = screen.getByRole('button', { name: 'Connected' });
      expect(button).toBeDisabled();
      expect(screen.getByText('Gateway connected. Waiting for backends...')).toBeInTheDocument();

      fireEvent.click(button);
      act(() => {
        vi.advanceTimersByTime(16_000);
      });

      expect(useFacadeStore.getState().connectionState).toBe('connected');
      expect(screen.queryByText(/Connection timed out/)).not.toBeInTheDocument();
      expect(screen.getByText('Gateway connected. Waiting for backends...')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-enables Connect once the saved gateway config is edited', () => {
    useGatewayStore.setState({
      directGatewayUrl: 'https://gateway.example.com',
      directGatewaySecret: 'secret-1',
    } as any);
    useFacadeStore.setState({ connectionState: 'connected', backends: [] });

    render(<MobileSetup />);
    expect(screen.getByRole('button', { name: 'Connected' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('http://gateway.example.com:3200'), {
      target: { value: 'https://other.example.com' },
    });

    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('retries the saved gateway through the facade instead of overwriting its state', async () => {
    const forceReconnect = vi.fn(() => {
      useFacadeStore.setState({ connectionState: 'reconnecting', connectionError: null });
    });
    useGatewayStore.setState({
      directGatewayUrl: 'https://gateway.example.com',
      directGatewaySecret: 'secret-1',
    } as any);
    useFacadeStore.setState({
      facade: { forceReconnect } as any,
      connectionState: 'error',
      connectionError: 'connection_error (url: wss://gateway.example.com)',
      backends: [],
    });

    const { rerender } = render(<MobileSetup />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(forceReconnect).toHaveBeenCalledTimes(1);
    expect(useFacadeStore.getState().connectionState).toBe('reconnecting');
    expect(screen.queryByText(/connection_error/)).not.toBeInTheDocument();
    expect(screen.getByText('Connecting...')).toBeInTheDocument();

    await act(async () => {
      useFacadeStore.setState({ connectionState: 'connected' });
    });
    rerender(<MobileSetup />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connected' })).toBeDisabled();
    });
  });

  it('renders the mobile debug panel when mobileDebug=1 is present', () => {
    window.history.pushState({}, '', '/?mobileDebug=1');

    useGatewayStore.setState({
      showLocalBackend: false,
    } as any);

    useFacadeStore.setState({
      connectionState: 'connected',
      connectionError: null,
      currentInstanceId: 'inst-mobile',
      backends: [
        {
          backendId: 'backend-1',
          name: 'Backend 1',
          online: true,
          runtimeState: 'visible',
          openState: 'closed',
          channelId: null,
          instanceId: 'inst-remote',
          deviceId: 'dev-remote',
          channel: 'prod',
          isThisInstance: false,
          isThisDevice: false,
          capabilities: [],
        },
      ],
    } as any);

    render(<MobileSetup />);

    expect(screen.getByTestId('mobile-debug-panel')).toBeInTheDocument();
    expect(screen.getByText('backends: 1')).toBeInTheDocument();
    expect(screen.getByText(/Backend 1 \(backend-1\)/)).toBeInTheDocument();

    window.history.pushState({}, '', '/');
  });

  it('toggles the mobile debug panel after tapping the logo five times', () => {
    useGatewayStore.setState({
      showLocalBackend: false,
    } as any);

    useFacadeStore.setState({
      connectionState: 'connected',
      connectionError: null,
      currentInstanceId: 'inst-mobile',
      backends: [
        {
          backendId: 'backend-1',
          name: 'Backend 1',
          online: true,
          runtimeState: 'visible',
          openState: 'closed',
          channelId: null,
          instanceId: 'inst-remote',
          deviceId: 'dev-remote',
          channel: 'prod',
          isThisInstance: false,
          isThisDevice: false,
          capabilities: [],
        },
      ],
    } as any);

    render(<MobileSetup />);

    expect(screen.queryByTestId('mobile-debug-panel')).not.toBeInTheDocument();

    const logoButton = screen.getByRole('button', { name: '' });
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(logoButton);
    }

    expect(screen.getByTestId('mobile-debug-panel')).toBeInTheDocument();
  });

  it('shows backend selection when gateway is connected and backends are available', () => {
    useFacadeStore.setState({
      connectionState: 'connected',
      connectionError: null,
      backends: [
        {
          backendId: 'backend-1',
          name: 'Backend 1',
          online: true,
          runtimeState: 'ready',
          openState: 'open',
          channelId: 'ch-1',
          instanceId: 'inst-remote',
          deviceId: 'dev-remote',
          channel: 'prod',
          isThisInstance: false,
          isThisDevice: false,
          capabilities: [],
        },
      ],
    } as any);

    render(<MobileSetup />);

    expect(screen.getByText('Select a Server')).toBeInTheDocument();
  });
});

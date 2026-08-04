import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { resolveStatsBackendId, useStatsBackendId } from '../statsBackend';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useGatewayStore } from '../../../stores/gatewayStore';
import { useServerStore } from '../../../stores/serverStore';

afterEach(() => {
  useFacadeStore.setState({ localBackendId: null, backends: [] });
  useGatewayStore.setState({ directGatewayUrl: null, directGatewaySecret: null });
  useServerStore.setState({ activeServerId: null });
});

describe('resolveStatsBackendId', () => {
  it('targets the resolved local backend on an embedded-local control plane', () => {
    expect(
      resolveStatsBackendId({
        hasLocalControlPlane: true,
        localBackendId: 'local-be-1',
        activeBackendId: 'remote-be-9',
      })
    ).toBe('local-be-1');
  });

  it('falls back to the legacy local id when the local backend id is not known yet', () => {
    expect(
      resolveStatsBackendId({
        hasLocalControlPlane: true,
        localBackendId: null,
        activeBackendId: null,
      })
    ).toBe('local');
  });

  it('prefers a known local backend even without a local control plane', () => {
    expect(
      resolveStatsBackendId({
        hasLocalControlPlane: false,
        localBackendId: 'local-be-1',
        activeBackendId: 'remote-be-9',
      })
    ).toBe('local-be-1');
  });

  it('targets the active backend when no local backend exists (gateway-direct)', () => {
    expect(
      resolveStatsBackendId({
        hasLocalControlPlane: false,
        localBackendId: null,
        activeBackendId: 'remote-be-9',
      })
    ).toBe('remote-be-9');
  });

  it('returns null when there is no backend at all', () => {
    expect(
      resolveStatsBackendId({
        hasLocalControlPlane: false,
        localBackendId: null,
        activeBackendId: null,
      })
    ).toBeNull();
  });
});

describe('useStatsBackendId', () => {
  it('resolves the local backend in embedded-local mode', () => {
    useFacadeStore.setState({ localBackendId: 'local-be-1' });
    const { result } = renderHook(() => useStatsBackendId());
    expect(result.current).toBe('local-be-1');
  });

  it('resolves the active backend in gateway-direct mode without a local backend', () => {
    useGatewayStore.setState({ directGatewayUrl: 'wss://gw.example', directGatewaySecret: 's' });
    useServerStore.setState({ activeServerId: 'remote-be-9' });
    const { result } = renderHook(() => useStatsBackendId());
    expect(result.current).toBe('remote-be-9');
  });

  it('resolves null in gateway-direct mode before any backend is active', () => {
    useGatewayStore.setState({ directGatewayUrl: 'wss://gw.example', directGatewaySecret: 's' });
    const { result } = renderHook(() => useStatsBackendId());
    expect(result.current).toBeNull();
  });
});

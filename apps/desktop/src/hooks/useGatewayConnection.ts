/**
 * Gateway Connection Hook
 *
 * Manages gateway config polling and provides backward-compatible API
 * that delegates to BackendFacade. The GatewayTransport lifecycle is
 * fully managed by the facade — this hook only handles:
 * 1. Gateway config polling (30s) to discover URL/secret from embedded server
 * 2. Public API that delegates to facade
 */

import { useEffect, useCallback, useMemo } from 'react';
import type { ClientMessage } from '@zclaudia/shared';
import { useGatewayStore } from '../stores/gatewayStore';
import { getServerGatewayStatus } from '../services/api';
import { useFacadeStore } from '../stores/facadeStore';
import { isMobileBackendUsable } from '../services/mobileConnectionState';

export function useGatewayConnection() {
  const facade = useFacadeStore(s => s.facade);

  // Poll server gateway status and sync to store
  // Skip when direct config is active (mobile mode — no local server to poll)
  useEffect(() => {
    let mounted = true;
    // Direct mode takes precedence regardless of when it appears: the poll
    // below is armed at mount and would otherwise keep running and clobber
    // the runtime config the user just saved (mobile: the backend's
    // advertised LAN/cleartext address is never valid for the device).
    const syncFromServer = async () => {
      const { directGatewayUrl, directGatewaySecret } = useGatewayStore.getState();
      if (directGatewayUrl && directGatewaySecret) {
        useGatewayStore.setState({
          gatewayUrl: directGatewayUrl,
          gatewaySecret: directGatewaySecret,
        });
        return;
      }
      try {
        const status = await getServerGatewayStatus();
        if (!mounted || useGatewayStore.getState().directGatewayUrl) return;
        if (status.enabled && status.gatewayUrl && status.gatewaySecret) {
          useGatewayStore.setState({
            gatewayUrl: status.gatewayUrl,
            gatewaySecret: status.gatewaySecret,
            isConnected: status.connected,
          });
        } else {
          useGatewayStore.setState({
            gatewayUrl: null,
            gatewaySecret: null,
            isConnected: false,
          });
        }
      } catch {
        // Server not reachable, skip
      }
    };

    void syncFromServer();
    const interval = setInterval(syncFromServer, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Public API — delegates to facade
  const openChannel = useCallback(
    (backendId: string) => {
      facade?.openBackend(backendId);
    },
    [facade]
  );

  const sendToBackend = useCallback(
    (backendId: string, message: ClientMessage) => {
      facade?.sendToBackend(backendId, message);
    },
    [facade]
  );

  const isBackendConnected = useCallback(
    (backendId: string) => {
      if (!facade) return false;
      return isMobileBackendUsable({
        backendId,
        connectionState: useFacadeStore.getState().connectionState,
        backends: useFacadeStore.getState().backends,
      });
    },
    [facade]
  );

  const disconnectGateway = useCallback(() => {
    facade?.disconnect();
  }, [facade]);

  return useMemo(
    () => ({
      openChannel,
      sendToBackend,
      isBackendAuthenticated: isBackendConnected,
      isBackendConnected,
      disconnectGateway,
    }),
    [openChannel, sendToBackend, isBackendConnected, disconnectGateway]
  );
}

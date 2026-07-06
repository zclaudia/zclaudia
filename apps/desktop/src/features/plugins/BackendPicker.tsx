import { useState } from 'react';
import type { GatewayBackendInfo } from '@zclaudia/shared';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useConnection } from '../../contexts/ConnectionContext';
import {
  getMobileBackendViewState,
  getVisibleMobileBackends,
} from '../../services/mobileConnectionState';
import { ServerPickerDropdown } from '../settings/ServerPickerDropdown';

/**
 * Active-backend selector for shell modes. Reads and drives the app's active
 * server via the server/facade/gateway stores, reusing the Settings dropdown.
 * Renders a header-styled trigger showing the active backend name.
 */
export function BackendPicker() {
  const [open, setOpen] = useState(false);

  const activeServerId = useServerStore(s => s.activeServerId);
  const setActiveServer = useServerStore(s => s.setActiveServer);
  const { isConnected: isGatewayConnected, showLocalBackend } = useGatewayStore();
  const { connectServer } = useConnection();

  const facadeBackends = useFacadeStore(s => s.backends);
  const facadeConnectionState = useFacadeStore(s => s.connectionState);
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const currentInstanceId = useFacadeStore(s => s.currentInstanceId);
  const activeServer = facadeBackends.find(b => b.backendId === activeServerId) ?? null;

  const isActiveRemote = !!activeServerId && !!localBackendId && activeServerId !== localBackendId;
  const effectiveShowLocal = showLocalBackend || isActiveRemote;
  const visibleGatewayBackends = getVisibleMobileBackends(
    facadeBackends,
    currentInstanceId,
    effectiveShowLocal
  );

  const handleBackendSwitch = (backend: GatewayBackendInfo) => {
    const viewState = getMobileBackendViewState(
      backend.backendId,
      facadeConnectionState,
      facadeBackends
    );
    if (viewState === 'offline') return;
    setActiveServer(backend.backendId);
    connectServer(backend.backendId);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-1.5 flex items-center justify-between group rounded-md hover:bg-secondary"
      >
        <span
          className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate"
          title={activeServer?.name || 'Server'}
        >
          {activeServer?.name || 'Server'}
        </span>
        <svg
          className={`w-3 h-3 text-muted-foreground group-hover:text-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <ServerPickerDropdown
          isGatewayConnected={isGatewayConnected}
          visibleGatewayBackends={visibleGatewayBackends}
          activeServerId={activeServerId}
          facadeConnectionState={facadeConnectionState}
          facadeBackends={facadeBackends}
          onClose={() => setOpen(false)}
          onSwitch={handleBackendSwitch}
        />
      )}
    </div>
  );
}

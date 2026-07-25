import type { BackendConnectionState, BackendSnapshot, GatewayBackendInfo } from '@zclaudia/shared';
import { getMobileBackendViewState } from '../../services/mobileConnectionState';
import type { MobileBackendViewState } from '../../services/mobileConnectionState';
import { SECTION_LABEL } from '../../components/ui/typography';

export function getViewStateLabel(viewState: MobileBackendViewState): string | null {
  switch (viewState) {
    case 'transport_reconnecting':
      return 'Reconnecting';
    case 'backend_subscribing':
      return 'Connecting';
    case 'backend_visible':
      return 'Idle';
    case 'error':
      return 'Error';
    case 'offline':
      return 'Offline';
    default:
      return null;
  }
}

export function ServerPickerDropdown({
  isGatewayConnected,
  visibleGatewayBackends,
  activeServerId,
  facadeConnectionState,
  facadeBackends,
  onClose,
  onSwitch,
}: {
  isGatewayConnected: boolean;
  visibleGatewayBackends: GatewayBackendInfo[];
  activeServerId: string | null;
  facadeConnectionState: BackendConnectionState;
  facadeBackends: BackendSnapshot[];
  onClose: () => void;
  onSwitch: (backend: GatewayBackendInfo) => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-1 right-1 top-full bg-card border border-border rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto">
        {isGatewayConnected && visibleGatewayBackends.length > 0 && (
          <>
            <div className={`px-3 py-1 ${SECTION_LABEL} bg-secondary/50 border-t border-border`}>
              Via gateway
            </div>
            {visibleGatewayBackends.map(backend => {
              const gwId = backend.backendId;
              const isActive = activeServerId === gwId;
              const viewState = getMobileBackendViewState(
                gwId,
                facadeConnectionState,
                facadeBackends
              );
              const isReachable = viewState !== 'offline';
              const statusColor =
                viewState === 'ready'
                  ? 'bg-success'
                  : viewState === 'transport_reconnecting' || viewState === 'backend_subscribing'
                    ? 'bg-warning animate-pulse'
                    : viewState === 'backend_visible'
                      ? 'bg-warning'
                      : viewState === 'error'
                        ? 'bg-destructive'
                        : 'bg-muted-foreground';
              const statusLabel = getViewStateLabel(viewState);

              return (
                <button
                  key={backend.backendId}
                  onClick={() => onSwitch(backend)}
                  disabled={!isReachable}
                  className={`w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 text-sm ${
                    isActive ? 'bg-muted' : ''
                  } ${!isReachable ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
                  <span className="truncate flex-1" title={backend.name}>
                    {backend.name}
                  </span>
                  {isActive && (
                    <span className="px-1.5 py-0.5 bg-muted text-primary text-[10px] rounded-md flex-shrink-0">
                      Active
                    </span>
                  )}
                  {!isReachable && statusLabel && (
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {statusLabel}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

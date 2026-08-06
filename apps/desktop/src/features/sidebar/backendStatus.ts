import type { BackendRecoveryViewState } from '../../stores/recoveryStore';
import type { MobileBackendViewState } from '../../services/mobileConnectionState';

export type BackendViewState = BackendRecoveryViewState | MobileBackendViewState;

/**
 * Status presentation for one backend, shared by the sidebar's backend rows.
 * The sidebar tree is the only backend surface, so it carries the full
 * connection state rather than a plain online/offline dot.
 */
export function backendStatusColor(viewState: BackendViewState): string {
  switch (viewState) {
    case 'ready':
      return 'bg-success';
    case 'transport_reconnecting':
    case 'backend_subscribing':
    case 'data_syncing':
    case 'session_syncing':
      return 'bg-warning animate-pulse';
    case 'backend_visible':
      return 'bg-warning';
    case 'error':
      return 'bg-destructive';
    case 'offline':
    default:
      return 'bg-muted-foreground';
  }
}

/** Short label for states worth naming; null when the dot alone says enough. */
export function backendStatusLabel(viewState: BackendViewState): string | null {
  switch (viewState) {
    case 'transport_reconnecting':
      return 'Reconnecting';
    case 'backend_subscribing':
      return 'Subscribing';
    case 'data_syncing':
    case 'session_syncing':
      return 'Syncing';
    case 'backend_visible':
      return 'Idle';
    case 'error':
      return 'Error';
    case 'offline':
      return 'Offline';
    case 'ready':
    default:
      return null;
  }
}

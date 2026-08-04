import { useFacadeStore } from '../../stores/facadeStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useServerStore } from '../../stores/serverStore';
import { LOCAL_BACKEND_KEY, resolveSessionBucketBackendId } from '../../stores/sessionsStore';

/**
 * Which backend the Home stats panel (usage cards, heatmap, models chart)
 * targets. Shared by UsageStatsStrip and ModelsChart so both always agree.
 *
 * Stats are local-backend-scoped by design on desktop: an embedded-local
 * control plane always has a local server, so keep targeting it there. On
 * setups without a local backend (mobile / pure-UI builds run gateway-direct),
 * fall back to the active backend so stats still work through the gateway.
 * Returns null when there is no backend to ask at all.
 */
export function resolveStatsBackendId(input: {
  hasLocalControlPlane: boolean;
  localBackendId: string | null;
  activeBackendId: string | null;
}): string | null {
  const { hasLocalControlPlane, localBackendId, activeBackendId } = input;
  if (hasLocalControlPlane || localBackendId) {
    return resolveSessionBucketBackendId(LOCAL_BACKEND_KEY, localBackendId);
  }
  return activeBackendId;
}

/** Reactive form of resolveStatsBackendId — re-resolves when the control-plane
 *  mode, the local backend id, or the active backend change. */
export function useStatsBackendId(): string | null {
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const activeBackendId = useServerStore(s => s.activeServerId);
  // Mirrors getControlPlaneMode() (utils/controlPlane.ts), but subscribed so a
  // mode flip re-renders the stats panel instead of leaving it stale.
  const hasLocalControlPlane = useGatewayStore(s => !(s.directGatewayUrl && s.directGatewaySecret));
  return resolveStatsBackendId({ hasLocalControlPlane, localBackendId, activeBackendId });
}

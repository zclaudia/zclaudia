import { parseBackendId } from '../../stores/gatewayStore';
import { resolveCanonicalBackendId, resolveLocalBackendId } from '../../actions/controlPlane';

/** Resolve a routed WebSocket identity and a UI session route to one backend key. */
export function resolveOwnerBackendId(backendId: string | null, serverId: string): string {
  const rawBackendId = backendId || parseBackendId(serverId) || serverId;
  return (
    resolveCanonicalBackendId(rawBackendId, resolveLocalBackendId() ?? rawBackendId) ?? rawBackendId
  );
}

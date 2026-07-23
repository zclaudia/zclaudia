import { useFacadeStore } from '../stores/facadeStore';

/**
 * Reactive id of this device's own (local/embedded) backend.
 *
 * The authoritative source is `facadeStore.localBackendId` (delivered by the
 * backend facade snapshot). While the facade has not synced yet, fall back to
 * the backend entry flagged as this running instance / local channel. This
 * mirrors the imperative `resolveLocalBackendId()` in `utils/controlPlane`,
 * but subscribes to the store so components re-render once the id arrives.
 *
 * Use this (instead of `serverStore.activeServerId`) for settings surfaces
 * that must always edit the local machine, even when a remote backend is
 * active for chat.
 */
export function useLocalBackendId(): string | null {
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const backends = useFacadeStore(s => s.backends);

  if (localBackendId) return localBackendId;
  return backends.find(b => b.isThisInstance === true || b.channel === 'local')?.backendId ?? null;
}

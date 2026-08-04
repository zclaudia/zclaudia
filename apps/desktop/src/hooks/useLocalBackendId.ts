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
 * Returns null when this device has no local backend (e.g. mobile). Settings
 * surfaces that prefer the local backend but must stay usable without one
 * should use `useSettingsTargetBackend` instead — passing a raw null into the
 * api layer silently falls back to the active (possibly remote) backend.
 */
export function useLocalBackendId(): string | null {
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const backends = useFacadeStore(s => s.backends);

  if (localBackendId) return localBackendId;
  return backends.find(b => b.isThisInstance === true || b.channel === 'local')?.backendId ?? null;
}

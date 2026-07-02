import type { BackendSnapshot } from '@zclaudia/shared';
import { useFacadeStore } from '../../stores/facadeStore';

/** Is this the local backend (by id, or by the isThisInstance fallback)? */
function isLocal(backend: BackendSnapshot, localBackendId: string | null): boolean {
  return localBackendId ? backend.backendId === localBackendId : backend.isThisInstance;
}

/**
 * Online backends for the sidebar's top level: only `online` backends, the local
 * one first, then the rest by display name. Pure — never mutates its input.
 */
export function selectOnlineBackends(
  backends: BackendSnapshot[],
  localBackendId: string | null
): BackendSnapshot[] {
  return backends
    .filter(b => b.online)
    .slice()
    .sort((a, c) => {
      const aLocal = isLocal(a, localBackendId);
      const cLocal = isLocal(c, localBackendId);
      if (aLocal !== cLocal) return aLocal ? -1 : 1;
      return a.name.localeCompare(c.name);
    });
}

/** Reactive online-backends list for components. */
export function useOnlineBackends(): BackendSnapshot[] {
  const backends = useFacadeStore(s => s.backends);
  const localBackendId = useFacadeStore(s => s.localBackendId);
  return selectOnlineBackends(backends, localBackendId);
}

import { useMemo } from 'react';
import type { BackendSnapshot } from '@zclaudia/shared';
import { useFacadeStore } from '../../stores/facadeStore';
import type { AgentsBackend } from './agents-types';

/** Is this the local backend (by id, or by the isThisInstance fallback)? */
function isLocal(backend: BackendSnapshot, localBackendId: string | null): boolean {
  return localBackendId ? backend.backendId === localBackendId : backend.isThisInstance;
}

/**
 * Backends list for Agents shell mode. Mirrors `selectOnlineBackends` (local
 * backend first, then by display name) but keeps offline backends — the tree
 * renders them dimmed instead of hiding them. Pure — never mutates its input.
 */
export function selectAgentsBackends(
  backends: BackendSnapshot[],
  localBackendId: string | null
): AgentsBackend[] {
  return backends
    .slice()
    .sort((a, c) => {
      const aLocal = isLocal(a, localBackendId);
      const cLocal = isLocal(c, localBackendId);
      if (aLocal !== cLocal) return aLocal ? -1 : 1;
      return a.name.localeCompare(c.name);
    })
    .map(b => ({ backendId: b.backendId, name: b.name, online: b.online }));
}

/** Reactive agents-backends list for components. */
export function useAgentsBackends(): AgentsBackend[] {
  const backends = useFacadeStore(s => s.backends);
  const localBackendId = useFacadeStore(s => s.localBackendId);
  return useMemo(() => selectAgentsBackends(backends, localBackendId), [backends, localBackendId]);
}

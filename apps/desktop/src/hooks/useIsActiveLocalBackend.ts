import type { BackendSnapshot } from '@zclaudia/shared';
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';

export interface ActiveLocalBackendState {
  /** The currently active backend snapshot, or null if none is selected. */
  activeServer: BackendSnapshot | null;
  /**
   * True when the active backend is the local instance (matches localBackendId
   * or is this running instance).
   */
  isActiveLocalBackend: boolean;
  /** Inverse of {@link isActiveLocalBackend}. */
  isRemoteBackend: boolean;
}

/**
 * Derives whether the app's active backend is the local instance. Shared by the
 * settings and plugins shells so the locality check stays in one place.
 */
export function useIsActiveLocalBackend(): ActiveLocalBackendState {
  const activeServerId = useServerStore(s => s.activeServerId);
  const facadeBackends = useFacadeStore(s => s.backends);
  const localBackendId = useFacadeStore(s => s.localBackendId);

  const activeServer = facadeBackends.find(b => b.backendId === activeServerId) ?? null;
  const isActiveLocalBackend =
    !!activeServerId &&
    (activeServerId === localBackendId || activeServer?.isThisInstance === true);

  return {
    activeServer,
    isActiveLocalBackend,
    isRemoteBackend: !isActiveLocalBackend,
  };
}

import { useRunStore } from '../../stores/runStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useOwnershipStore } from '../../stores/ownershipStore';

const AUTO_OPEN_MAX_FAILURES = 3;

let facadeServerRuns = new Map<string, Set<string>>();
const pendingAutoOpenBackends = new Set<string>();
let autoOpenTimer: ReturnType<typeof setTimeout> | null = null;
const autoOpenFailures = new Map<string, number>();
// Last non-null local backend id seen in a facade snapshot. Survives facade
// re-creation on purpose: the session/project stores it guards outlive the
// facade too.
let lastLocalBackendId: string | null = null;

export function getFacadeServerRuns(): Map<string, Set<string>> {
  return facadeServerRuns;
}

export function resetFacadeSyncState(): void {
  facadeServerRuns = new Map();
  clearPendingAutoOpen();
}

/**
 * Record the current local backend id and return the previous one when it
 * changed. The server starts on a standalone facade (`local-standalone`) and
 * swaps to the gateway facade once a gateway is configured, so the same
 * machine shows up under a new id while the old one silently drops out.
 */
export function noteLocalBackendId(backendId: string | null): string | null {
  if (!backendId || backendId === lastLocalBackendId) return null;
  const previous = lastLocalBackendId;
  lastLocalBackendId = backendId;
  return previous;
}

export function clearPendingAutoOpen(): void {
  pendingAutoOpenBackends.clear();
  autoOpenFailures.clear();
  if (autoOpenTimer) {
    clearTimeout(autoOpenTimer);
    autoOpenTimer = null;
  }
}

export function noteAutoOpenFailure(backendId: string): void {
  autoOpenFailures.set(backendId, (autoOpenFailures.get(backendId) ?? 0) + 1);
}

export function noteAutoOpenSuccess(backendId: string): void {
  autoOpenFailures.delete(backendId);
}

export function clearAutoOpenFailures(): void {
  autoOpenFailures.clear();
}

export function scheduleAutoOpenBackends(backendIds: string[]): void {
  for (const backendId of backendIds) {
    if ((autoOpenFailures.get(backendId) ?? 0) >= AUTO_OPEN_MAX_FAILURES) continue;
    pendingAutoOpenBackends.add(backendId);
  }
  if (pendingAutoOpenBackends.size === 0 || autoOpenTimer) return;
  autoOpenTimer = setTimeout(() => {
    autoOpenTimer = null;
    const facade = useFacadeStore.getState().facade;
    const snapshot = facade?.getSnapshot?.() ?? useFacadeStore.getState();
    if (!facade || !('backends' in snapshot)) {
      pendingAutoOpenBackends.clear();
      return;
    }

    const queued = [...pendingAutoOpenBackends];
    pendingAutoOpenBackends.clear();
    for (const backendId of queued) {
      const backend = snapshot.backends.find((item: any) => item.backendId === backendId);
      if (backend && backend.openState === 'unsubscribed' && backend.runtimeState === 'visible') {
        facade.openBackend(backendId);
      }
    }
  }, 0);
}

export function hasActiveRunsForBackend(backendId: string): boolean {
  const chatStore = useRunStore.getState();
  const ownershipStore = useOwnershipStore.getState();
  const activeRunsForBackend = facadeServerRuns.get(backendId);

  if (activeRunsForBackend && activeRunsForBackend.size > 0) {
    return true;
  }

  for (const [, sessionId] of Object.entries(chatStore.activeRuns)) {
    const ownerBackendId = ownershipStore.getSessionBackendId(sessionId);
    if (ownerBackendId === backendId) {
      return true;
    }
  }

  return false;
}

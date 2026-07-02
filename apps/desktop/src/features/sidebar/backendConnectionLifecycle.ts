export interface ConnectionPlanInput {
  /** Backend rows currently expanded in the sidebar. */
  expandedBackendIds: string[];
  /** Foreground backend (owner of the selected session) — pinned connected. */
  foregroundBackendId: string | null;
  /** Local/embedded server id — never managed (always connected). */
  localBackendId: string | null;
  /** Backends this lifecycle currently keeps open (opened on a prior expand). */
  managedBackendIds: string[];
  /** Whether a backend already has a live connection. */
  isConnected: (backendId: string) => boolean;
}

export interface ConnectionPlan {
  /** Backends to open now. */
  toConnect: string[];
  /** Backends to close now (only ones we manage). */
  toDisconnect: string[];
  /** The managed set after applying this plan. */
  nextManaged: string[];
}

/**
 * Derive connect/disconnect actions for the lazy backend-connection lifecycle.
 *
 * Desired-connected = expanded ∪ {foreground}. The local backend is excluded
 * from management (always connected elsewhere). We only ever disconnect backends
 * we opened ourselves (tracked via managedBackendIds) and never reconnect ones
 * already connected. Pure — no side effects.
 */
export function computeConnectionPlan(input: ConnectionPlanInput): ConnectionPlan {
  const {
    expandedBackendIds,
    foregroundBackendId,
    localBackendId,
    managedBackendIds,
    isConnected,
  } = input;

  const desired = new Set<string>(expandedBackendIds);
  if (foregroundBackendId) desired.add(foregroundBackendId);

  // Manageable = desired minus the local backend (never managed).
  const manageable = [...desired].filter(id => id !== localBackendId);
  const manageableSet = new Set(manageable);

  const toConnect = manageable.filter(id => !managedBackendIds.includes(id) && !isConnected(id));
  const toDisconnect = managedBackendIds.filter(id => !manageableSet.has(id));
  const nextManaged = [...managedBackendIds.filter(id => manageableSet.has(id)), ...toConnect];

  return { toConnect, toDisconnect, nextManaged };
}

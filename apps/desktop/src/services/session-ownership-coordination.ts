// Session ownership bookkeeping shared by sessionsStore and projectStore.
// Both stores record/clear ownershipStore entries and clean up a session's
// right-workspace layout when a session disappears; those cross-store writes
// live here so the stores never import each other.
import { useOwnershipStore } from '../stores/ownershipStore';
import { useRightWorkspaceStore } from '../stores/rightWorkspaceStore';

/** Replace a backend's session ownership with the given snapshot. */
export function reassignSessionOwnersForBackend(backendId: string, sessionIds: string[]): void {
  const ownership = useOwnershipStore.getState();
  ownership.removeSessionOwnersByBackend(backendId);
  ownership.setSessionOwners(sessionIds, backendId);
}

/** Record which backend owns a session (created/updated events). */
export function recordSessionOwner(sessionId: string, backendId: string): void {
  useOwnershipStore.getState().setSessionOwner(sessionId, backendId);
}

/** Forget a deleted session: ownership record plus right-workspace layout. */
export function forgetSession(sessionId: string): void {
  useOwnershipStore.getState().removeSessionOwner(sessionId);
  useRightWorkspaceStore.getState().removeSession(sessionId);
}

/** Forget all session ownership recorded for a backend. */
export function forgetSessionOwnersForBackend(backendId: string): void {
  useOwnershipStore.getState().removeSessionOwnersByBackend(backendId);
}

/** Clear every session ownership record (full disconnect). */
export function clearSessionOwnership(): void {
  useOwnershipStore.getState().clearSessionOwners();
}

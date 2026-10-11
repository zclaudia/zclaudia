// Session ownership bookkeeping shared by sessionsStore and projectStore.
// Both stores record/clear ownershipStore entries and clean up a session's
// right-workspace layout when a session disappears; those cross-store writes
// live here so the stores never import each other.
import { useOwnershipStore } from '../stores/ownershipStore';
import { useRightWorkspaceStore } from '../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../stores/projectWorkspaceStore';
import { sessionWorkspaceId } from '../utils/workspaceStorage';

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

/**
 * An adopted project layout keeps its original session key as a stable anchor.
 * Deleting that session clears ownership, while catalog reconciliation removes
 * its chat ref without discarding the other chats or tools in the project tree.
 */
export function forgetSession(sessionId: string): void {
  useOwnershipStore.getState().removeSessionOwner(sessionId);
  const projectAnchors = new Set(Object.values(useProjectWorkspaceStore.getState().byProject)
    .map(workspace => workspace.workspaceId));
  for (const layoutId of [sessionId, sessionWorkspaceId(sessionId)]) {
    if (!projectAnchors.has(layoutId)) useRightWorkspaceStore.getState().removeSession(layoutId);
  }
}

/** Forget all session ownership recorded for a backend. */
export function forgetSessionOwnersForBackend(backendId: string): void {
  useOwnershipStore.getState().removeSessionOwnersByBackend(backendId);
}

/** Clear every session ownership record (full disconnect). */
export function clearSessionOwnership(): void {
  useOwnershipStore.getState().clearSessionOwners();
}

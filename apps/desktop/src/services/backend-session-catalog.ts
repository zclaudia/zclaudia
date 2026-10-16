import type { Session } from '@zclaudia/shared/core/session';
import { useOwnershipStore } from '../stores/ownershipStore';
import { useProjectStore } from '../stores/projectStore';
import { useSessionsStore } from '../stores/sessionsStore';

/** Project/sidebar consumers still read the REST catalog. Apply the accepted
 * sync bucket there too, preserving REST-only metadata and other backends. */
export function syncBackendSessionCatalog(
  backendId: string,
  previousSessionIds: readonly string[] = [],
  removed = false
): void {
  const sync = useSessionsStore.getState();
  const incoming = removed ? [] : (sync.remoteSessions.get(backendId) ?? []);
  const incomingById = new Map(incoming.map(session => [session.id, session]));
  const previousIds = new Set(previousSessionIds);
  const deletedIds = sync.deletedSessionIds.get(backendId);
  const authoritative = removed || sync.snapshotBackendIds.has(backendId);
  const ownership = useOwnershipStore.getState();
  useProjectStore.setState(state => {
    const sessions: Session[] = [];
    for (const existing of state.sessions) {
      const owner =
        ownership.getProjectBackendId(existing.projectId) ??
        ownership.getSessionBackendId(existing.id);
      if (owner && owner !== backendId) {
        sessions.push(existing);
        incomingById.delete(existing.id);
        continue;
      }
      const item = incomingById.get(existing.id);
      if (item) {
        // The resource protocol has no type/agent/worktree fields. Do not
        // replace a hydrated session with the sparse wire representation.
        sessions.push({ ...existing, ...item, type: existing.type ?? item.type });
        incomingById.delete(existing.id);
      } else if (
        !previousIds.has(existing.id) &&
        !deletedIds?.has(existing.id) &&
        !(authoritative && owner === backendId)
      ) {
        sessions.push(existing);
      }
    }
    for (const item of incomingById.values()) {
      const projectOwner = ownership.getProjectBackendId(item.projectId);
      if (!projectOwner || projectOwner === backendId) sessions.push(item);
    }
    return { sessions };
  });
}

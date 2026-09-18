import { useTopLevelViewStore } from '../stores/topLevelViewStore';
import { resolveCanonicalBackendId } from '../actions/controlPlane';
import { parseBackendId } from '../stores/gatewayStore';
import { useMemo } from 'react';
import { useClaudiaStore } from '../stores/claudiaStore';
import { usePermissionStore } from '../stores/permissionStore';

/**
 * Derives Claudia-level status flags from the backend-keyed Claudia store.
 * Used by the sidebar to show activity and attention badges. Aggregates across
 * all backends — the badge is global even though the state is backend-scoped.
 */
export function useClaudiaStatus() {
  const slices = useClaudiaStore(s => s.slices);
  const isDesktopOpen = useTopLevelViewStore(s => s.view.kind === 'claudia');
  const isExpanded = useClaudiaStore(s => s.isExpanded);
  const lastViewedAt = useClaudiaStore(s => s.lastViewedAt);
  const pendingRequests = usePermissionStore(s => s.pendingRequests);

  const claudiaTaskSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const slice of Object.values(slices)) {
      for (const task of slice.tasks) {
        if (task.sessionId) ids.add(task.sessionId);
      }
      for (const run of slice.runs) {
        if (run.sessionId) ids.add(run.sessionId);
      }
      for (const threadList of Object.values(slice.threadsByProject)) {
        for (const thread of threadList) {
          if (thread.session) ids.add(thread.session.id);
        }
      }
    }
    return ids;
  }, [slices]);

  const hasRunning = useMemo(
    () =>
      Object.values(slices).some(
        slice =>
          slice.runs.some(run => run.status === 'running' || run.status === 'submitting') ||
          slice.tasks.some(
            task =>
              task.status === 'running' || task.status === 'queued' || task.status === 'waiting'
          )
      ),
    [slices]
  );

  const hasPermissionPending = useMemo(
    () =>
      pendingRequests.some(request => {
        if (!request.sessionId || !request.serverId) return false;
        const owner = resolveCanonicalBackendId(parseBackendId(request.serverId));
        const slice = owner ? slices[owner] : undefined;
        return Boolean(
          slice &&
          (slice.tasks.some(task => task.sessionId === request.sessionId) ||
            slice.runs.some(run => run.sessionId === request.sessionId) ||
            Object.values(slice.threadsByProject).some(threads =>
              threads.some(thread => thread.session?.id === request.sessionId)
            ))
        );
      }),
    [pendingRequests, slices]
  );

  const hasUnread = useMemo(() => {
    if (isExpanded || isDesktopOpen) return false;
    return Object.values(slices).some(
      slice =>
        slice.runs.some(run => run.updatedAt > lastViewedAt && run.status !== 'rejected') ||
        slice.tasks.some(task => task.updatedAt > lastViewedAt)
    );
  }, [isExpanded, isDesktopOpen, slices, lastViewedAt]);

  return {
    claudiaTaskSessionIds,
    hasRunning,
    hasPermissionPending,
    hasUnread,
  };
}

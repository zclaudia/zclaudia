import type { BackendFacadeEvent } from '@zclaudia/shared/facade/types';
import { resolveCanonicalBackendId } from '../../actions/controlPlane';
import { getProjectForBackend } from '../../services/api/projects';
import { resolveOwnershipBackendId } from '../../services/project-store-coordination';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useProjectStore } from '../../stores/projectStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useSessionRunStateStore } from '../../stores/sessionRunStateStore';
import { syncBackendSessionCatalog } from '../../services/backend-session-catalog';

/**
 * Gateway resource payloads describe projects with id/name/timestamps only.
 * When such a partial record is the first (or last) thing the desktop sees for
 * a project, the cached entry loses `rootPath` and the real `type`, which
 * breaks every path-dependent surface (Git panel, file references, worktree
 * labels). Backfill the full record from its backend once per project.
 *
 * Only the active backend is hydrated: non-active backends get a full REST
 * load when they become active. Failed requests are retried on the next
 * snapshot/event instead of being remembered as done.
 */
const hydratedProjectKeys = new Set<string>();

function isActiveBackend(backendId: string): boolean {
  const activeBackendId = resolveOwnershipBackendId();
  if (!activeBackendId) return false;
  return activeBackendId === backendId || activeBackendId === resolveCanonicalBackendId(backendId);
}

function hydratePartialProjects(backendId: string, projectIds: Iterable<string>): void {
  if (!isActiveBackend(backendId)) return;
  for (const projectId of projectIds) {
    const key = `${backendId}:${projectId}`;
    if (hydratedProjectKeys.has(key)) continue;
    const project = useProjectStore.getState().projects.find(item => item.id === projectId);
    if (project?.rootPath || project?.type === 'chat_only') continue;
    hydratedProjectKeys.add(key);
    void getProjectForBackend(backendId, projectId)
      .then(fullProject => {
        // Keep the ownership record authoritative: a canonical backend id may
        // differ from the facade id used for the request.
        const ownerBackendId =
          useOwnershipStore.getState().getProjectBackendId(projectId) ?? backendId;
        useProjectStore.getState().upsertProjectForBackend(ownerBackendId, fullProject);
      })
      .catch(() => {
        // The backend may still be starting up — let the next snapshot retry.
        hydratedProjectKeys.delete(key);
      });
  }
}

function forgetHydratedProjects(backendId: string): void {
  const prefix = `${backendId}:`;
  for (const key of hydratedProjectKeys) {
    if (key.startsWith(prefix)) hydratedProjectKeys.delete(key);
  }
}

/** Test-only: clear the module-level hydration cache between cases. */
export function __resetBackendProjectHydrationForTests(): void {
  hydratedProjectKeys.clear();
}

export function syncBackendDataSnapshot(
  event: Extract<BackendFacadeEvent, { type: 'backend_data_snapshot' }>
): void {
  const { backendId, sessions, projects } = event;
  const activeItems = sessions.filter(item => !item.archived);
  const mappedSessions = activeItems.map(item => ({
    id: item.sessionId,
    projectId: item.projectId || '',
    name: item.title || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isActive: item.runStatus === 'running' || item.runStatus === 'waiting',
    // Keep the states apart: `waiting` means blocked on the user, `failed`
    // means the run ended badly — both are things Home acts on, and both are
    // lost if everything collapses into isActive.
    lastRunStatus:
      item.runStatus === 'running' || item.runStatus === 'waiting' || item.runStatus === 'failed'
        ? item.runStatus
        : null,
    type: 'regular' as const,
  }));

  const currentSessions = useSessionsStore.getState().remoteSessions.get(backendId);
  const sessionsChanged =
    !useSessionsStore.getState().snapshotBackendIds.has(backendId) ||
    !currentSessions ||
    currentSessions.length !== mappedSessions.length ||
    currentSessions.some(
      (s, i) =>
        s.id !== mappedSessions[i].id ||
        s.updatedAt !== mappedSessions[i].updatedAt ||
        s.isActive !== mappedSessions[i].isActive ||
        s.lastRunStatus !== mappedSessions[i].lastRunStatus
    );

  const ownershipVersion = useRecoveryStore.getState().noteDataSyncSucceeded(backendId);
  useOwnershipStore.getState().stampSessionOwnershipVersion(
    activeItems.map(item => item.sessionId),
    ownershipVersion
  );

  if (sessionsChanged) {
    useSessionsStore.getState().setRemoteSessions(backendId, mappedSessions);
  }
  syncBackendSessionCatalog(
    backendId,
    currentSessions?.map(session => session.id)
  );

  const activeSessionIds = new Set(
    activeItems
      .filter(item => item.runStatus === 'running' || item.runStatus === 'waiting')
      .map(item => item.sessionId)
  );
  useSessionsStore.getState().reconcileActiveStatus(backendId, activeSessionIds);
  useSessionRunStateStore.getState().reconcileBackendSessionStatuses({
    backendId,
    sessions: activeItems.map(item => ({
      sessionId: item.sessionId,
      runStatus: item.runStatus,
    })),
    knownSessionIds: [
      ...(currentSessions?.map(session => session.id) ?? []),
      ...mappedSessions.map(session => session.id),
    ],
    source: 'backend_snapshot',
  });

  if (projects) {
    useProjectStore.getState().replaceProjectsForBackend(
      backendId,
      projects.map(p => ({
        id: p.projectId,
        name: p.name,
        type: 'code' as const,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }))
    );
    hydratePartialProjects(
      backendId,
      projects.map(p => p.projectId)
    );
  }
}

export function syncBackendsRemoved(
  event: Extract<BackendFacadeEvent, { type: 'backends_removed' }>
): void {
  for (const backendId of event.backendIds) {
    const previousIds = useSessionsStore
      .getState()
      .remoteSessions.get(backendId)
      ?.map(s => s.id);
    syncBackendSessionCatalog(backendId, previousIds, true);
    useSessionsStore.getState().clearBackendSessions(backendId);
    useProjectStore.getState().replaceProjectsForBackend(backendId, []);
    useOwnershipStore.getState().removeProjectOwnersByBackend(backendId);
    // A backend can re-register under the same id; its projects come back as
    // partial snapshot records and must be hydrated again.
    forgetHydratedProjects(backendId);
  }
}

export function syncBackendDataEvent(
  event: Extract<BackendFacadeEvent, { type: 'backend_data_event' }>
): void {
  const { backendId, event: dataEvent } = event;
  const previousIds = useSessionsStore
    .getState()
    .remoteSessions.get(backendId)
    ?.map(s => s.id);
  if (dataEvent.resourceType === 'session' && dataEvent.op === 'upsert') {
    const item = dataEvent.resource as NonNullable<typeof dataEvent.resource> & {
      sessionId: string;
      projectId?: string;
      title?: string;
      createdAt: number;
      updatedAt: number;
      runStatus: 'idle' | 'running' | 'waiting' | 'failed' | 'completed';
      archived?: boolean;
    };
    if (item.archived) {
      useSessionsStore.getState().handleSessionEvent(backendId, 'deleted', {
        id: item.sessionId,
        projectId: item.projectId || '',
        isActive: false,
        type: 'regular' as const,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
      syncBackendSessionCatalog(backendId, previousIds);
      useSessionRunStateStore.getState().markSessionInactive({
        backendId,
        sessionId: item.sessionId,
        source: 'backend_event',
      });
      return;
    }
    const sessionStore = useSessionsStore.getState();
    const existingSessions = sessionStore.remoteSessions.get(backendId) || [];
    const eventType = existingSessions.some(s => s.id === item.sessionId) ? 'updated' : 'created';
    sessionStore.handleSessionEvent(backendId, eventType, {
      id: item.sessionId,
      projectId: item.projectId || '',
      name: item.title || '',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      isActive: item.runStatus === 'running' || item.runStatus === 'waiting',
      lastRunStatus:
        item.runStatus === 'running' || item.runStatus === 'waiting' || item.runStatus === 'failed'
          ? item.runStatus
          : null,
      type: 'regular' as const,
    });
    syncBackendSessionCatalog(backendId, previousIds);
    useSessionRunStateStore.getState().applySessionRunStatus({
      backendId,
      sessionId: item.sessionId,
      runStatus: item.runStatus,
      source: 'backend_event',
    });
  } else if (dataEvent.resourceType === 'session' && dataEvent.op === 'remove') {
    useSessionsStore.getState().handleSessionEvent(backendId, 'deleted', {
      id: dataEvent.resourceId,
      projectId: '',
      isActive: false,
      type: 'regular' as const,
      createdAt: 0,
      updatedAt: 0,
    });
    syncBackendSessionCatalog(backendId, previousIds);
    useSessionRunStateStore.getState().markSessionInactive({
      backendId,
      sessionId: dataEvent.resourceId,
      source: 'backend_event',
    });
  } else if (dataEvent.resourceType === 'project' && dataEvent.op === 'upsert') {
    const p = dataEvent.resource as NonNullable<typeof dataEvent.resource> & {
      projectId: string;
      name: string;
      createdAt: number;
      updatedAt: number;
    };
    useProjectStore.getState().upsertProjectForBackend(backendId, {
      id: p.projectId,
      name: p.name,
      type: 'code' as const,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
    hydratePartialProjects(backendId, [p.projectId]);
  } else if (dataEvent.resourceType === 'project' && dataEvent.op === 'remove') {
    useProjectStore.getState().removeProjectForBackend(backendId, dataEvent.resourceId);
  }
}

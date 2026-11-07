import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  getProjectForBackend: vi.fn(),
}));

vi.mock('../../../services/api/projects', () => apiMocks);

import type { BackendFacadeEvent } from '@zclaudia/shared/facade/types';
import {
  __resetBackendProjectHydrationForTests,
  syncBackendDataEvent,
  syncBackendDataSnapshot,
  syncBackendsRemoved,
} from '../backend-data-sync';
import { useOwnershipStore } from '../../../stores/ownershipStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useServerStore } from '../../../stores/serverStore';
import { useSessionsStore } from '../../../stores/sessionsStore';

const backendId = 'backend-a';
const projectId = 'project-1';

const fullProject = {
  id: projectId,
  name: 'Project',
  type: 'code' as const,
  rootPath: '/repo',
  createdAt: 1,
  updatedAt: 2,
};

type SnapshotEvent = Extract<BackendFacadeEvent, { type: 'backend_data_snapshot' }>;
type BackendsRemovedEvent = Extract<BackendFacadeEvent, { type: 'backends_removed' }>;
type DataEvent = Extract<BackendFacadeEvent, { type: 'backend_data_event' }>;

function snapshot(targetBackendId = backendId): SnapshotEvent {
  return {
    type: 'backend_data_snapshot',
    backendId: targetBackendId,
    sessions: [],
    projects: [{ projectId, name: 'Project', createdAt: 1, updatedAt: 2 }],
  } as SnapshotEvent;
}

function projectEvent(): DataEvent {
  return {
    type: 'backend_data_event',
    backendId,
    event: {
      type: 'backend_resource_event',
      op: 'upsert',
      resourceType: 'project',
      resourceId: projectId,
      resource: { projectId, name: 'Project', createdAt: 1, updatedAt: 2 },
    },
  } as DataEvent;
}

function cachedProject() {
  return useProjectStore.getState().projects.find(project => project.id === projectId);
}

describe('backend project hydration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __resetBackendProjectHydrationForTests();
    useServerStore.setState({ activeServerId: backendId });
    useSessionsStore.getState().clearAllSessions();
    useProjectStore.setState({ projects: [], sessions: [] });
    useOwnershipStore.setState({ projectBackendIds: {}, sessionBackendIds: {} });
  });

  it('backfills the full project when the active backend only sent a partial record', async () => {
    apiMocks.getProjectForBackend.mockResolvedValue(fullProject);

    syncBackendDataSnapshot(snapshot());

    // The partial snapshot creates the entry without a local path.
    expect(cachedProject()).toMatchObject({ id: projectId });
    expect(cachedProject()?.rootPath).toBeUndefined();

    await vi.waitFor(() => expect(cachedProject()?.rootPath).toBe('/repo'));
    expect(apiMocks.getProjectForBackend).toHaveBeenCalledWith(backendId, projectId);
    expect(cachedProject()?.type).toBe('code');
  });

  it('hydrates projects announced through a resource event', async () => {
    apiMocks.getProjectForBackend.mockResolvedValue(fullProject);

    syncBackendDataEvent(projectEvent());

    await vi.waitFor(() => expect(cachedProject()?.rootPath).toBe('/repo'));
    expect(apiMocks.getProjectForBackend).toHaveBeenCalledWith(backendId, projectId);
  });

  it('does not fetch project details for a non-active backend', async () => {
    useServerStore.setState({ activeServerId: 'backend-b' });

    syncBackendDataSnapshot(snapshot());

    await Promise.resolve();
    expect(apiMocks.getProjectForBackend).not.toHaveBeenCalled();
    expect(cachedProject()?.rootPath).toBeUndefined();
  });

  it('re-hydrates after a backend re-registers under the same id', async () => {
    apiMocks.getProjectForBackend.mockResolvedValue(fullProject);
    syncBackendDataSnapshot(snapshot());
    await vi.waitFor(() => expect(apiMocks.getProjectForBackend).toHaveBeenCalledTimes(1));

    syncBackendsRemoved({
      type: 'backends_removed',
      backendIds: [backendId],
    } as BackendsRemovedEvent);
    expect(cachedProject()).toBeUndefined();

    syncBackendDataSnapshot(snapshot());
    await vi.waitFor(() => expect(apiMocks.getProjectForBackend).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(cachedProject()?.rootPath).toBe('/repo'));
  });

  it('retries on the next snapshot after a failed hydration request', async () => {
    apiMocks.getProjectForBackend.mockRejectedValueOnce(new Error('offline'));
    syncBackendDataSnapshot(snapshot());
    await vi.waitFor(() => expect(apiMocks.getProjectForBackend).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));

    apiMocks.getProjectForBackend.mockResolvedValue(fullProject);
    syncBackendDataSnapshot(snapshot());
    await vi.waitFor(() => expect(cachedProject()?.rootPath).toBe('/repo'));
    expect(apiMocks.getProjectForBackend).toHaveBeenCalledTimes(2);
  });
});

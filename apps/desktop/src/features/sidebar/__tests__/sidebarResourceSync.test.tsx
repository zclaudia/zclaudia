import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSidebarData } from '../useSidebarData';
import {
  syncBackendDataEvent,
  syncBackendDataSnapshot,
  syncBackendsRemoved,
} from '../../../facade/sync/backend-data-sync';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionsStore } from '../../../stores/sessionsStore';
import { useOwnershipStore } from '../../../stores/ownershipStore';

const backendId = 'phone-backend';
const project = { projectId: 'phone-project', name: 'Phone project', createdAt: 1, updatedAt: 1 };
const session = {
  sessionId: 'phone-session',
  projectId: project.projectId,
  title: 'Phone session',
  createdAt: 2,
  updatedAt: 2,
  runStatus: 'idle' as const,
};
function sessionEvent(op: 'upsert' | 'remove', resource = session) {
  syncBackendDataEvent({
    type: 'backend_data_event',
    backendId,
    event: {
      type: 'backend_resource_event',
      resourceType: 'session',
      resourceId: resource.sessionId,
      op,
      resource: op === 'upsert' ? resource : undefined,
    },
  } as Parameters<typeof syncBackendDataEvent>[0]);
}
function snapshot(sessions = [session]) {
  syncBackendDataSnapshot({
    type: 'backend_data_snapshot',
    backendId,
    projects: [project],
    sessions,
  });
}

describe('sidebar resource synchronization', () => {
  beforeEach(() => {
    useSessionsStore.getState().clearAllSessions();
    useProjectStore.setState({ projects: [], sessions: [] });
    useOwnershipStore.setState({ projectBackendIds: {}, sessionBackendIds: {} });
  });

  it('shows a project and its session created by another client without a REST reload', () => {
    const { result } = renderHook(() => useSidebarData());
    act(() => {
      syncBackendDataEvent({
        type: 'backend_data_event',
        backendId,
        event: {
          type: 'backend_resource_event',
          op: 'upsert',
          resourceType: 'project',
          resourceId: project.projectId,
          resource: project,
        },
      } as Parameters<typeof syncBackendDataEvent>[0]);
      sessionEvent('upsert');
    });
    expect(result.current.visibleProjects.map(p => p.id)).toEqual([project.projectId]);
    expect(result.current.getFilteredSessionsForProject(project.projectId)).toEqual([
      expect.objectContaining({ id: session.sessionId, name: session.title }),
    ]);
    act(() => sessionEvent('upsert', { ...session, title: 'Renamed', updatedAt: 3 }));
    expect(result.current.getFilteredSessionsForProject(project.projectId)[0].name).toBe('Renamed');
    act(() => sessionEvent('remove'));
    expect(result.current.getFilteredSessionsForProject(project.projectId)).toEqual([]);
  });

  it('repairs missing sessions on reconnect and removes absent sessions without touching other backends', () => {
    useOwnershipStore.getState().setProjectOwner('other-project', 'other-backend');
    useProjectStore.setState({
      sessions: [
        {
          id: 'other-session',
          projectId: 'other-project',
          name: 'Other',
          type: 'regular',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const { result } = renderHook(() => useSidebarData());
    act(() => snapshot());
    expect(result.current.getFilteredSessionsForProject(project.projectId)).toHaveLength(1);
    act(() => snapshot([]));
    expect(result.current.getFilteredSessionsForProject(project.projectId)).toEqual([]);
    expect(useProjectStore.getState().sessions.map(s => s.id)).toEqual(['other-session']);
  });

  it('preserves REST metadata and applies archive/restore events to the displayed catalog', () => {
    snapshot();
    useProjectStore.getState().updateSession(session.sessionId, {
      agentProfileId: 'agent-1',
      workingDirectory: '/work/tree',
      sortOrder: 7,
    });
    const { result } = renderHook(() => useSidebarData());
    act(() => sessionEvent('upsert', { ...session, title: 'Renamed', updatedAt: 3 }));
    expect(result.current.getFilteredSessionsForProject(project.projectId)[0]).toMatchObject({
      name: 'Renamed',
      agentProfileId: 'agent-1',
      workingDirectory: '/work/tree',
      sortOrder: 7,
    });
    act(() => sessionEvent('upsert', { ...session, archived: true } as typeof session));
    expect(result.current.getFilteredSessionsForProject(project.projectId)).toEqual([]);
    act(() => sessionEvent('upsert'));
    expect(result.current.getFilteredSessionsForProject(project.projectId)).toHaveLength(1);
  });

  it('deduplicates a create response that arrives after the resource push', () => {
    snapshot();
    useProjectStore.getState().addSession({
      id: session.sessionId,
      projectId: project.projectId,
      name: session.title,
      type: 'regular',
      createdAt: 2,
      updatedAt: 2,
      agentProfileId: 'rest-agent',
    });
    expect(useProjectStore.getState().sessions).toEqual([
      expect.objectContaining({ id: session.sessionId, agentProfileId: 'rest-agent' }),
    ]);
  });

  it('mirrors accepted create admissions instead of a stale in-flight snapshot', () => {
    snapshot([]);
    useProjectStore.getState().addSession({
      id: session.sessionId,
      projectId: project.projectId,
      name: session.title,
      type: 'regular',
      createdAt: 2,
      updatedAt: 2,
    });
    snapshot([]);
    expect(useProjectStore.getState().sessions.map(s => s.id)).toEqual([session.sessionId]);
    snapshot([]);
    expect(useProjectStore.getState().sessions).toEqual([]);
  });

  it('clears the displayed sessions when their backend is removed', () => {
    snapshot();
    syncBackendsRemoved({ type: 'backends_removed', backendIds: [backendId] });
    expect(useProjectStore.getState().sessions).toEqual([]);
    expect(useProjectStore.getState().projects).toEqual([]);
  });
});

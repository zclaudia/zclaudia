import { beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '@zclaudia/shared';
import { useRunStore } from '../runStore';
import { useSessionConfigStore } from '../sessionConfigStore';
import { useOwnershipStore } from '../ownershipStore';
import { useProjectStore } from '../projectStore';
import { useSessionRunStateStore } from '../sessionRunStateStore';
import { useSessionsStore, type RemoteSession } from '../sessionsStore';

const baseSession: Session = {
  id: 's1',
  projectId: 'p1',
  name: 'Session 1',
  type: 'regular',
  createdAt: 1,
  updatedAt: 1,
  isActive: false,
};

const baseRemoteSession: RemoteSession = {
  ...baseSession,
  isActive: false,
};

function resetStores() {
  useSessionRunStateStore.setState({ records: {} });
  useRunStore.setState({
    activeRuns: {},
    backgroundRunIds: new Set(),
    runHealth: {},
    activeToolCalls: {},
    toolCallsHistory: {},
    runContentBlocks: {},
  } as any);
  useSessionConfigStore.setState({
    systemInfoBySession: {},
    modeBySession: {},
    runtimeModes: {},
    sessionUsage: {},
    compactionNotice: {},
  } as any);
  useProjectStore.setState({
    projects: [],
    sessions: [baseSession],
    dataServerId: null,
    selectedProjectId: null,
    selectedSessionId: null,
    dashboardViews: {},
    providers: [],
    providerCommands: {},
    providerCapabilities: {},
  } as any);
  useSessionsStore.setState({
    remoteSessions: new Map([['b1', [baseRemoteSession]]]),
    activeSessionIdsByBackend: new Map([['b1', new Set()]]),
  } as any);
  useOwnershipStore.setState({
    sessionBackendIds: { s1: 'b1' },
    projectBackendIds: {},
    taskOwners: {},
  } as any);
}

describe('sessionRunStateStore', () => {
  beforeEach(resetStores);

  it('marks foreground runs active through the unified layer', () => {
    useSessionRunStateStore.getState().markRunStarted({
      backendId: 'b1',
      runId: 'r1',
      sessionId: 's1',
      sessionType: 'regular',
      source: 'run_event',
    });

    const record = useSessionRunStateStore.getState().records['b1::s1'];
    expect(record).toMatchObject({
      backendId: 'b1',
      sessionId: 's1',
      phase: 'running',
      foregroundRunIds: ['r1'],
    });
    expect(useProjectStore.getState().sessions[0].isActive).toBe(true);
    expect(useSessionsStore.getState().activeSessionIdsByBackend.get('b1')?.has('s1')).toBe(true);
  });

  it('authoritative idle status clears a stale chat run', () => {
    useRunStore.getState().startRun('r1', 's1');
    useSessionRunStateStore.getState().markRunStarted({
      backendId: 'b1',
      runId: 'r1',
      sessionId: 's1',
      source: 'run_event',
    });

    useSessionRunStateStore.getState().applySessionRunStatus({
      backendId: 'b1',
      sessionId: 's1',
      runStatus: 'idle',
      source: 'backend_event',
    });

    expect(useRunStore.getState().activeRuns.r1).toBeUndefined();
    expect(useSessionRunStateStore.getState().records['b1::s1'].phase).toBe('idle');
    expect(useProjectStore.getState().sessions[0].isActive).toBe(false);
    expect(useSessionsStore.getState().activeSessionIdsByBackend.get('b1')?.has('s1')).toBe(false);
  });

  it('heartbeat reconciliation clears runs even when local run tracking was reset', () => {
    useRunStore.getState().startRun('r1', 's1');
    useSessionRunStateStore.getState().markRunStarted({
      backendId: 'b1',
      runId: 'r1',
      sessionId: 's1',
      source: 'run_event',
    });

    useSessionRunStateStore.getState().reconcileBackendActiveRuns({
      backendId: 'b1',
      activeRuns: [],
      source: 'heartbeat',
    });

    expect(useRunStore.getState().activeRuns.r1).toBeUndefined();
    expect(useSessionRunStateStore.getState().records['b1::s1'].phase).toBe('idle');
    expect(useSessionsStore.getState().activeSessionIdsByBackend.get('b1')?.has('s1')).toBe(false);
  });
});

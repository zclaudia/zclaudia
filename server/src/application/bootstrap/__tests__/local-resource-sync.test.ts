import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { BackendFacadeRuntimeCore } from '@zclaudia/shared/facade/index';
import type { BackendFacadeEvent } from '@zclaudia/shared/facade/index';
import type { Project } from '@zclaudia/shared/core/project';
import type { Session } from '@zclaudia/shared/core/session';
import { createDomainPorts } from '../domain-ports.js';
import { GatewayManager } from '../../../infra/gateway/manager.js';
import { StandaloneFacadeAdapter } from '../../../infra/gateway/standalone-adapter.js';
import {
  EmbeddedGatewayAdapter,
  type LocalBackendHandler,
} from '../../../infra/gateway/embedded-adapter.js';
import type { GatewayClient } from '../../../infra/gateway/gateway-client.js';
import { getGatewayClient } from '../../../infra/gateway/gateway-instance.js';
import { subscribeLocalBackendDataEvents } from '../../../infra/gateway/local-backend-data-events.js';
import { ServerState } from '../../../server-state.js';

vi.mock('../../conversation/transport/broadcast.js', () => ({ bumpProjectsVersion: vi.fn() }));
vi.mock('../../../infra/gateway/gateway-instance.js', () => ({
  getGatewayClient: vi.fn(),
  setGatewayClient: vi.fn(),
}));

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  vi.mocked(getGatewayClient).mockReset();
});

const project: Project = {
  id: 'mobile-project',
  name: 'From phone',
  type: 'code',
  createdAt: 1,
  updatedAt: 1,
};
const session: Session = {
  id: 'mobile-session',
  projectId: project.id,
  name: 'From phone',
  type: 'regular',
  createdAt: 2,
  updatedAt: 2,
};

function setup(mode: 'standalone' | 'embedded') {
  const state = new ServerState();
  const activeRuns = state.activeRuns;
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT, is_internal INTEGER DEFAULT 0,
      created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, name TEXT, project_id TEXT, created_at INTEGER,
      updated_at INTEGER, archived_at INTEGER, last_run_status TEXT
    );
  `);
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    project.id,
    project.name,
    project.createdAt,
    project.updatedAt
  );
  db.prepare(
    'INSERT INTO sessions (id, name, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(session.id, session.name, session.projectId, session.createdAt, session.updatedAt);
  const manager = new GatewayManager({
    db,
    serverContext: { db },
    activeRuns,
    connectedClients: new Map(),
    createVirtualClient: vi.fn(),
    cancelRun: vi.fn(),
    host: '127.0.0.1',
  } as unknown as ConstructorParameters<typeof GatewayManager>[0]);
  const localHandler = (
    manager as unknown as {
      createLocalBackendHandler(): LocalBackendHandler;
    }
  ).createLocalBackendHandler();
  const onBackendDataEvent = vi.spyOn(localHandler, 'onBackendDataEvent');
  const backendId = mode === 'standalone' ? 'local-standalone' : 'backend-local';
  const gatewayClient = {
    commands: { backend: { subscribe: vi.fn(), unsubscribe: vi.fn() } },
    queries: {
      connection: { isConnected: () => false },
      identity: {
        getInstanceId: () => 'instance-1',
        getDeviceId: () => 'device-1',
        getEpoch: () => 1,
      },
      registry: { getItems: () => new Map() },
    },
    events: { setOutgoingEvents: vi.fn() },
  } as unknown as GatewayClient;
  const adapter =
    mode === 'standalone'
      ? new StandaloneFacadeAdapter({
          serverPort: 3100,
          instanceId: 'standalone',
          deviceId: 'device-1',
          localHandler,
        })
      : new EmbeddedGatewayAdapter(gatewayClient, localHandler, 3100);
  if (adapter instanceof EmbeddedGatewayAdapter) adapter.setLocalBackendId(backendId);
  const core = new BackendFacadeRuntimeCore({ adapter, mode: 'embedded' });
  const events: BackendFacadeEvent[] = [];
  core.onEvent(event => events.push(event));
  core.start();
  core.openBackend(backendId);
  cleanups.push(() => {
    core.stop();
    db.close();
  });
  const ports = createDomainPorts({
    db,
    activeRuns,
    handleRunStart: vi.fn(),
    broadcastHeartbeat: vi.fn(),
  });
  const dataEvents = () => events.filter(event => event.type === 'backend_data_event');
  return { core, adapter, backendId, ports, dataEvents, onBackendDataEvent, state, db };
}

describe.each(['standalone', 'embedded'] as const)('%s local resource sync', mode => {
  it('pushes another client’s run completion to the local catalog without a session stream', () => {
    const { state, db, backendId, dataEvents } = setup(mode);
    const sync = state.getSessionSync();
    // The desktop only subscribes to the backend catalog. The mobile client
    // owns the run; no local session stream or run event is needed here.
    state.activeRuns.set('mobile-run', {
      sessionId: session.id,
      phase: 'running',
    } as never);
    db.prepare('UPDATE sessions SET last_run_status = ? WHERE id = ?').run('running', session.id);
    sync.broadcastSessionUpdated(session.id, db);

    state.activeRuns.get('mobile-run')!.phase = 'completed';
    db.prepare('UPDATE sessions SET last_run_status = NULL, updated_at = 3 WHERE id = ?').run(
      session.id
    );
    sync.broadcastSessionUpdated(session.id, db);

    expect(dataEvents().map(event => event.event.resource)).toEqual([
      expect.objectContaining({ sessionId: session.id, runStatus: 'running' }),
      expect.objectContaining({
        sessionId: session.id,
        projectId: project.id,
        title: session.name,
        createdAt: session.createdAt,
        updatedAt: 3,
        runStatus: 'idle',
      }),
    ]);
    expect(dataEvents().every(event => event.backendId === backendId)).toBe(true);
  });

  it('preserves waiting and failed run statuses for both local and gateway subscribers', () => {
    const { state, db, dataEvents } = setup(mode);
    const broadcastSessionEvent = vi.fn();
    vi.mocked(getGatewayClient).mockReturnValue({
      commands: { backendData: { broadcastSessionEvent } },
    } as unknown as GatewayClient);
    const sync = state.getSessionSync();

    for (const status of ['waiting', 'failed']) {
      db.prepare('UPDATE sessions SET last_run_status = ? WHERE id = ?').run(status, session.id);
      sync.broadcastSessionUpdated(session.id, db);
    }

    expect(
      dataEvents().map(event => (event.event.resource as { runStatus: string }).runStatus)
    ).toEqual(['waiting', 'failed']);
    expect(broadcastSessionEvent.mock.calls.map(call => call[1])).toEqual([
      expect.objectContaining({ id: session.id, projectId: project.id, lastRunStatus: 'waiting' }),
      expect.objectContaining({ id: session.id, projectId: project.id, lastRunStatus: 'failed' }),
    ]);
  });

  it('pushes projects and sessions created on another client without restarting or a gateway', () => {
    const { ports, backendId, dataEvents } = setup(mode);
    ports.handleProjectChanged({ type: 'project_upsert', project });
    ports.sessionEvents.publishSessionEvent('created', session);

    expect(dataEvents()).toEqual([
      expect.objectContaining({
        backendId,
        event: expect.objectContaining({
          resourceType: 'project',
          op: 'upsert',
          resourceId: project.id,
          resource: expect.objectContaining({ projectId: project.id, name: project.name }),
        }),
      }),
      expect.objectContaining({
        backendId,
        event: expect.objectContaining({
          resourceType: 'session',
          op: 'upsert',
          resourceId: session.id,
          resource: expect.objectContaining({
            sessionId: session.id,
            projectId: project.id,
            title: session.name,
            runStatus: 'idle',
          }),
        }),
      }),
    ]);
  });

  it('pushes updates, archive, restore and deletion through the same channel', () => {
    const { ports, dataEvents } = setup(mode);
    ports.handleProjectChanged({
      type: 'project_upsert',
      project: { ...project, name: 'Renamed' },
    });
    ports.sessionEvents.publishSessionEvent('updated', {
      ...session,
      name: 'Renamed',
      updatedAt: 3,
    });
    ports.sessionEvents.publishSessionEvent('updated', { ...session, archivedAt: 4 });
    ports.sessionEvents.publishSessionEvent('updated', session);
    ports.sessionEvents.publishSessionEvent('deleted', session);
    ports.handleProjectChanged({ type: 'project_remove', projectId: project.id });

    expect(dataEvents().map(event => [event.event.resourceType, event.event.op])).toEqual([
      ['project', 'upsert'],
      ['session', 'upsert'],
      ['session', 'remove'],
      ['session', 'upsert'],
      ['session', 'remove'],
      ['project', 'remove'],
    ]);
    expect(dataEvents()[1].event.resource).toMatchObject({ title: 'Renamed', updatedAt: 3 });
  });

  it('also preserves gateway delivery for remote subscribers', () => {
    const { ports, dataEvents } = setup(mode);
    const broadcastProjectEvent = vi.fn();
    const broadcastSessionEvent = vi.fn();
    vi.mocked(getGatewayClient).mockReturnValue({
      commands: { backendData: { broadcastProjectEvent, broadcastSessionEvent } },
    } as unknown as GatewayClient);

    ports.handleProjectChanged({ type: 'project_upsert', project });
    ports.sessionEvents.publishSessionEvent('created', session);

    expect(dataEvents()).toHaveLength(2);
    expect(broadcastProjectEvent).toHaveBeenCalledExactlyOnceWith('updated', project);
    expect(broadcastSessionEvent).toHaveBeenCalledExactlyOnceWith('created', session);
  });

  it('stops delivery for a closed backend and resumes when reopened', () => {
    const { core, backendId, ports, dataEvents } = setup(mode);
    core.closeBackend(backendId);
    ports.sessionEvents.publishSessionEvent('created', session);
    expect(dataEvents()).toHaveLength(0);
    core.openBackend(backendId);
    ports.sessionEvents.publishSessionEvent('created', session);
    expect(dataEvents()).toHaveLength(1);
  });

  it('releases its local event subscription when the facade stops and resubscribes once', () => {
    const { core, adapter, ports, dataEvents, onBackendDataEvent } = setup(mode);
    const secondListener = adapter.events.subscribe(() => {});
    core.stop();
    ports.sessionEvents.publishSessionEvent('created', session);
    expect(dataEvents()).toHaveLength(0);
    secondListener();
    core.start();
    ports.sessionEvents.publishSessionEvent('created', session);
    expect(dataEvents()).toHaveLength(1);
    expect(onBackendDataEvent).toHaveBeenCalledTimes(2);
  });
});

it('isolates local subscriber failures from the mutation and other subscribers', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  cleanups.push(() => consoleError.mockRestore());
  cleanups.push(
    subscribeLocalBackendDataEvents(() => {
      throw new Error('subscriber failed');
    })
  );
  const { ports, dataEvents } = setup('standalone');

  expect(() => ports.sessionEvents.publishSessionEvent('created', session)).not.toThrow();
  expect(dataEvents()).toHaveLength(1);
  expect(consoleError).toHaveBeenCalled();
});

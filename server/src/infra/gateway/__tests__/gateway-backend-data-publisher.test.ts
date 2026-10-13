import { describe, expect, it, vi } from 'vitest';
import type { BackendResourceSnapshotMessage } from '@zclaudia/protocol/sync';
import { RESOURCES_TOPIC } from '@zclaudia/protocol/transport';
import type { Database as BetterDatabase } from 'better-sqlite3';
import { GatewayBackendDataPublisher } from '../gateway-backend-data-publisher.js';

describe('GatewayBackendDataPublisher', () => {
  it('refreshes the retained full snapshot after session and project mutations', () => {
    let sessions: Array<Record<string, unknown>> = [];
    let projects: Array<Record<string, unknown>> = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: () => (sql.includes('FROM sessions') ? sessions : projects),
      })),
    } as unknown as BetterDatabase;
    const publishTopic = vi.fn();
    const publisher = new GatewayBackendDataPublisher({
      db,
      activeRuns: new Map(),
      publishTopic,
    });
    const retainedSnapshot = () =>
      publishTopic.mock.calls.filter(call => call[2]?.retain === true).at(-1)?.[1] as
        | BackendResourceSnapshotMessage
        | undefined;

    sessions = [
      { id: 'session-1', name: 'New session', projectId: 'project-1', createdAt: 1, updatedAt: 2 },
    ];
    publisher.broadcastSessionEvent('created', { id: 'session-1', name: 'New session' });
    expect(retainedSnapshot()?.resources).toEqual([
      expect.objectContaining({
        resourceType: 'session',
        resourceId: 'session-1',
        resource: expect.objectContaining({ title: 'New session' }),
      }),
    ]);

    sessions = [
      { id: 'session-1', name: 'Renamed', projectId: 'project-1', createdAt: 1, updatedAt: 3 },
    ];
    projects = [{ id: 'project-1', name: 'Project', createdAt: 1, updatedAt: 3 }];
    publisher.broadcastSessionEvent('updated', { id: 'session-1', name: 'Renamed' });
    expect(retainedSnapshot()?.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: 'session',
          resourceId: 'session-1',
          resource: expect.objectContaining({ title: 'Renamed' }),
        }),
        expect.objectContaining({
          resourceType: 'project',
          resourceId: 'project-1',
          resource: expect.objectContaining({ name: 'Project' }),
        }),
      ])
    );

    sessions = [];
    publisher.broadcastSessionEvent('deleted', { id: 'session-1' });
    expect(retainedSnapshot()?.resources).toEqual([
      expect.objectContaining({ resourceType: 'project', resourceId: 'project-1' }),
    ]);

    projects = [];
    publisher.broadcastProjectEvent('deleted', { id: 'project-1' });
    expect(retainedSnapshot()?.resources).toEqual([]);
  });

  it('refreshes run status from the database on a session status event', () => {
    let runStatus: string | null = 'waiting';
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: () =>
          sql.includes('FROM sessions')
            ? [
                {
                  id: 'session-1',
                  name: 'Session',
                  createdAt: 1,
                  updatedAt: 2,
                  lastRunStatus: runStatus,
                },
              ]
            : [],
      })),
    } as unknown as BetterDatabase;
    const publishTopic = vi.fn();
    const publisher = new GatewayBackendDataPublisher({ db, activeRuns: new Map(), publishTopic });

    publisher.broadcastSessionEvent('updated', { id: 'session-1', lastRunStatus: 'running' });
    runStatus = null;
    publisher.broadcastSessionEvent('updated', { id: 'session-1', lastRunStatus: null });

    const retained = publishTopic.mock.calls.filter(call => call[2]?.retain === true);
    expect((retained[0][1] as BackendResourceSnapshotMessage).resources[0].resource).toMatchObject({
      runStatus: 'waiting',
    });
    expect((retained[1][1] as BackendResourceSnapshotMessage).resources[0].resource).toMatchObject({
      runStatus: 'idle',
    });
  });

  it('publishes session snapshot even when projects cannot be queried', () => {
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('FROM sessions')) {
          return {
            all: () => [
              {
                id: 'session-1',
                name: 'Session One',
                projectId: 'project-1',
                createdAt: 10,
                updatedAt: 20,
              },
            ],
          };
        }
        if (sql.includes('FROM projects')) {
          throw new Error('no such table: projects');
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    } as unknown as BetterDatabase;
    const publishTopic = vi.fn();
    const publisher = new GatewayBackendDataPublisher({
      db,
      activeRuns: new Map(),
      publishTopic,
    });

    const published = publisher.publishSnapshot();

    expect(published).toBe(true);
    expect(publishTopic).toHaveBeenCalledTimes(1);
    expect(publishTopic.mock.calls[0][0]).toBe(RESOURCES_TOPIC);
    expect(publishTopic.mock.calls[0][2]).toEqual({ retain: true });
    const message = publishTopic.mock.calls[0][1] as BackendResourceSnapshotMessage;
    expect(message).toMatchObject({
      type: 'backend_resource_snapshot',
      namespace: 'zclaudia',
    });
    expect(message.resources).toEqual([
      {
        resourceType: 'session',
        resourceId: 'session-1',
        resource: {
          sessionId: 'session-1',
          projectId: 'project-1',
          title: 'Session One',
          createdAt: 10,
          updatedAt: 20,
          lastMessageAt: 20,
          runStatus: 'idle',
        },
        updatedAt: 20,
      },
    ]);
  });

  it('publishes to the resources topic: snapshots retained, events not', () => {
    const db = {
      prepare: vi.fn(() => ({ all: () => [] })),
    } as unknown as BetterDatabase;
    const publishTopic = vi.fn();
    const publisher = new GatewayBackendDataPublisher({
      db,
      activeRuns: new Map(),
      publishTopic,
    });

    publisher.publishSnapshot();
    expect(publishTopic).toHaveBeenCalledTimes(1);
    expect(publishTopic).toHaveBeenLastCalledWith(
      RESOURCES_TOPIC,
      expect.objectContaining({ type: 'backend_resource_snapshot' }),
      { retain: true }
    );

    publisher.publishSessionEvent('upsert', { id: 's1', name: 'S', updatedAt: 5 });
    expect(publishTopic).toHaveBeenCalledTimes(3);
    expect(publishTopic).toHaveBeenNthCalledWith(
      2,
      RESOURCES_TOPIC,
      expect.objectContaining({ type: 'backend_resource_event', op: 'upsert', resourceId: 's1' }),
      undefined
    );
    expect(publishTopic).toHaveBeenLastCalledWith(
      RESOURCES_TOPIC,
      expect.objectContaining({ type: 'backend_resource_snapshot' }),
      { retain: true }
    );

    publisher.broadcastProjectEvent('deleted', { id: 'p1' });
    expect(publishTopic).toHaveBeenNthCalledWith(
      4,
      RESOURCES_TOPIC,
      expect.objectContaining({ type: 'backend_resource_event', op: 'remove', resourceId: 'p1' }),
      undefined
    );
    expect(publishTopic).toHaveBeenLastCalledWith(
      RESOURCES_TOPIC,
      expect.objectContaining({ type: 'backend_resource_snapshot' }),
      { retain: true }
    );
  });
});

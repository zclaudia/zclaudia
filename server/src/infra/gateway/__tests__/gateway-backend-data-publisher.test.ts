import { describe, expect, it, vi } from 'vitest';
import type { BackendResourceSnapshotMessage } from '@zclaudia/protocol/gateway';
import type { Database as BetterDatabase } from 'better-sqlite3';
import { GatewayBackendDataPublisher, RESOURCES_TOPIC } from '../gateway-backend-data-publisher.js';

describe('GatewayBackendDataPublisher', () => {
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
    expect(publishTopic).toHaveBeenCalledTimes(2);
    expect(publishTopic).toHaveBeenLastCalledWith(
      RESOURCES_TOPIC,
      expect.objectContaining({ type: 'backend_resource_event', op: 'upsert', resourceId: 's1' }),
      undefined
    );

    publisher.broadcastProjectEvent('deleted', { id: 'p1' });
    expect(publishTopic).toHaveBeenLastCalledWith(
      RESOURCES_TOPIC,
      expect.objectContaining({ type: 'backend_resource_event', op: 'remove', resourceId: 'p1' }),
      undefined
    );

  });
});

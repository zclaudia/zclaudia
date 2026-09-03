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
    const sendMessage = vi.fn();
    const publisher = new GatewayBackendDataPublisher({
      db,
      activeRuns: new Map(),
      sendMessage,
    });

    const published = publisher.publishSnapshot();

    expect(published).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const message = sendMessage.mock.calls[0][0] as BackendResourceSnapshotMessage;
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

  it('dual-publishes to the resources topic: snapshots retained, events not', () => {
    const db = {
      prepare: vi.fn(() => ({ all: () => [] })),
    } as unknown as BetterDatabase;
    const sendMessage = vi.fn();
    const publishTopic = vi.fn();
    const publisher = new GatewayBackendDataPublisher({
      db,
      activeRuns: new Map(),
      sendMessage,
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

    // Topic payload and legacy message are the SAME object shape
    expect(publishTopic.mock.calls[0][1]).toBe(sendMessage.mock.calls[0][0]);

    // Targeted republish (late v3 subscriber) skips the topic mirror
    publishTopic.mockClear();
    publisher.publishSnapshot({ mirrorToTopic: false });
    expect(publishTopic).not.toHaveBeenCalled();
  });

  it('does not touch topics when publishTopic is not provided (v3 mode)', () => {
    const sendMessage = vi.fn();
    const publisher = new GatewayBackendDataPublisher({
      activeRuns: new Map(),
      sendMessage,
    });
    publisher.publishSessionEvent('upsert', { id: 's1', updatedAt: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

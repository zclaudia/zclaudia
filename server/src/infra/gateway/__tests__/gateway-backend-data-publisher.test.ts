import { describe, expect, it, vi } from 'vitest';
import type { BackendResourceSnapshotMessage } from '@zclaudia/protocol/gateway';
import type { Database as BetterDatabase } from 'better-sqlite3';
import { GatewayBackendDataPublisher } from '../gateway-backend-data-publisher.js';

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
});

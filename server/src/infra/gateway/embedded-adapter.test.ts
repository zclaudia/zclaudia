import { describe, expect, it, vi } from 'vitest';
import { EmbeddedGatewayAdapter } from './embedded-adapter.js';
import type { LocalBackendHandler } from './embedded-adapter.js';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';

type TestLocalHandler = LocalBackendHandler & { emit(message: ServerMessage): void };

function createLocalHandler(): TestLocalHandler {
  const listeners = new Set<(message: ServerMessage) => void>();
  return {
    onMessage: vi.fn(),
    onStreamOpen: vi.fn(),
    onStreamClose: vi.fn(),
    onCatchUp: vi.fn(async () => []),
    onServerEvent: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSessionItems: vi.fn(() => []),
    getProjectItems: vi.fn(() => []),
    getCapabilities: vi.fn(() => []),
    emit(message: ServerMessage) {
      for (const listener of listeners) listener(message);
    },
  } as TestLocalHandler;
}

function createGatewayClientMock(registryItems: Record<string, unknown>[] = []) {
  return {
    commands: {
      connection: { connect: vi.fn(), disconnect: vi.fn() },
      channel: { openOutgoing: vi.fn(), closeOutgoing: vi.fn(), sendToOutgoing: vi.fn() },
      catalog: { subscribeOutgoing: vi.fn(), unsubscribeOutgoing: vi.fn() },
      stream: { openOutgoing: vi.fn(), closeOutgoing: vi.fn(), catchUpOutgoing: vi.fn() },
    },
    queries: {
      connection: { isConnected: () => true },
      identity: {
        getInstanceId: () => 'instance-1',
        getDeviceId: () => 'device-1',
        getBackendId: () => 'backend-local',
        getEpoch: () => 1,
      },
      registry: { getItems: () => new Map(registryItems.map(i => [i.backendId, i])) },
      channel: {
        getOutgoing: vi.fn(),
        getAllOutgoing: () => new Map(),
      },
    },
    events: {
      setOutgoingEvents: vi.fn(),
    },
  };
}

describe('EmbeddedGatewayAdapter', () => {
  it('forwards local run events into facade adapter events', () => {
    const localHandler = createLocalHandler();
    const gatewayClient = createGatewayClientMock();
    const adapter = new EmbeddedGatewayAdapter(gatewayClient as any, localHandler, 3100);
    adapter.setLocalBackendId('backend-local');
    const events: any[] = [];
    adapter.events.subscribe(event => events.push(event));

    adapter.commands.backend.subscribe('backend-local');
    localHandler.emit({
      type: 'run_started',
      runId: 'run-1',
      sessionId: 'session-1',
      clientRequestId: 'client-1',
    });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'run_event_received',
          backendId: 'backend-local',
          sessionId: 'session-1',
          event: expect.objectContaining({ type: 'run_started', runId: 'run-1' }),
        }),
      ])
    );
  });

  describe('local backend name', () => {
    // The gateway lists this instance under its gateway display name
    // ("Backend on <host>"); locally it must always read "This Device".
    const ownGatewayEntry = {
      namespace: 'zclaudia',
      backendId: 'backend-local',
      instanceId: 'instance-1',
      deviceId: 'device-1',
      name: 'Backend on my-mac',
      channel: 'gateway',
      visible: true,
      capabilities: [],
      backendProtocolVersion: 1,
      minClientProtocolVersion: 1,
      epoch: 1,
      connectedAt: 0,
      lastSeenAt: 0,
    };
    const remoteEntry = {
      ...ownGatewayEntry,
      backendId: 'backend-remote',
      instanceId: 'instance-2',
      deviceId: 'device-2',
      name: 'Backend on devbox',
    };

    it('keeps "This Device" when a registry push includes our own gateway entry', () => {
      const gatewayClient = createGatewayClientMock();
      const adapter = new EmbeddedGatewayAdapter(gatewayClient as any, createLocalHandler(), 3100);
      adapter.setLocalBackendId('backend-local');
      const events: any[] = [];
      adapter.events.subscribe(event => events.push(event));

      const outgoing = gatewayClient.events.setOutgoingEvents.mock.calls[0][0];
      outgoing.onRegistrySnapshotChanged([ownGatewayEntry, remoteEntry]);

      const snapshot = events.find(e => e.type === 'registry_snapshot_received');
      const local = snapshot.items.filter((i: any) => i.backendId === 'backend-local');
      expect(local).toHaveLength(1);
      expect(local[0]).toMatchObject({ name: 'This Device', channel: 'local' });
      expect(snapshot.items).toContainEqual(remoteEntry);
    });

    it('names our own gateway entry "This Device" before the local id is known', () => {
      const gatewayClient = createGatewayClientMock([ownGatewayEntry, remoteEntry]);
      const adapter = new EmbeddedGatewayAdapter(gatewayClient as any, createLocalHandler(), 3100);

      const { items } = adapter.queries.bootstrap.getInitialState().registry;
      expect(items.find(i => i.backendId === 'backend-local')?.name).toBe('This Device');
      expect(items.find(i => i.backendId === 'backend-remote')?.name).toBe('Backend on devbox');
    });
  });
});

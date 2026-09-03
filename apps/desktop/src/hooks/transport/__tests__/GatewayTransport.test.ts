import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GatewayTransport } from '../GatewayTransport';
import type { ClientMessage, ServerMessage } from '@zclaudia/shared';

const storeMocks = vi.hoisted(() => ({
  clearBackendSessions: vi.fn(),
  replaceProjectsForBackend: vi.fn(),
  removeProjectOwnersByBackend: vi.fn(),
}));

// Mock stores
vi.mock('../../../stores/sessionsStore', () => ({
  useSessionsStore: {
    getState: vi.fn(() => ({
      setRemoteSessions: vi.fn(),
      handleSessionEvent: vi.fn(),
      clearBackendSessions: storeMocks.clearBackendSessions,
      clearAllSessions: vi.fn(),
    })),
  },
}));

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      replaceProjectsForBackend: storeMocks.replaceProjectsForBackend,
    })),
  },
}));

vi.mock('../../../stores/ownershipStore', () => ({
  useOwnershipStore: {
    getState: vi.fn(() => ({
      removeProjectOwnersByBackend: storeMocks.removeProjectOwnersByBackend,
    })),
  },
}));

// Mock sessionSync service
vi.mock('../../../services/sessionSync', () => ({
  startSessionSync: vi.fn(),
  stopSessionSync: vi.fn(),
}));

describe('GatewayTransport', () => {
  let mockConfig: any;
  let transport: GatewayTransport;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      url: 'ws://gateway.example.com',
      gatewaySecret: 'test-secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      onRegistryChanged: vi.fn(),
      onBackendDataSnapshot: vi.fn(),
      onBackendDataEvent: vi.fn(),
      onBackendSubscribed: vi.fn(),
      onBackendUnsubscribed: vi.fn(),
      onBackendServerMessage: vi.fn(),
      onRunStreamEvent: vi.fn(),
      onContentPatch: vi.fn(),
      onContentPatchError: vi.fn(),
      onBackendsRemoved: vi.fn(),
    };

    transport = new GatewayTransport(mockConfig);
  });

  afterEach(() => {
    transport.disconnect();
  });

  describe('constructor', () => {
    it('initializes with config', () => {
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('creates WebSocket connection', () => {
      transport.connect();

      expect((transport as any).ws).not.toBeNull();
    });

    it('closes existing WebSocket before creating new one', () => {
      transport.connect();
      const firstWs = (transport as any).ws;

      transport.connect();
      const secondWs = (transport as any).ws;

      expect(firstWs.close).toHaveBeenCalled();
      expect(secondWs).not.toBe(firstWs);
    });

    it('clears authenticated state on connect', () => {
      transport.connect();
      expect((transport as any).authenticated).toBe(false);
      expect(transport.subscribedBackends.size).toBe(0);
    });
  });

  describe('disconnect', () => {
    it('closes WebSocket and clears state', () => {
      transport.connect();
      transport.disconnect();

      expect((transport as any).ws).toBeNull();
      expect((transport as any).authenticated).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('returns false when WebSocket is null', () => {
      expect(transport.isConnected()).toBe(false);
    });

    it('returns false when not authenticated', () => {
      transport.connect();
      expect(transport.isConnected()).toBe(false);
    });

    it('returns true when WebSocket is open and authenticated', () => {
      transport.connect();

      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;

      expect(transport.isConnected()).toBe(true);
    });
  });

  describe('isBackendSubscribed', () => {
    it('returns false when backend is not subscribed', () => {
      expect(transport.isBackendSubscribed('backend-123')).toBe(false);
    });

    it('returns true when backend is subscribed', () => {
      transport.subscribedBackends.add('backend-123');
      expect(transport.isBackendSubscribed('backend-123')).toBe(true);
    });
  });

  function seedV4Backend(backendId: string, extra: Record<string, unknown> = {}) {
    (transport as any).registryItems.set(backendId, {
      backendId,
      namespace: 'zclaudia',
      epoch: 1,
      capabilities: [],
      gatewayProtocolVersion: 4,
      ...extra,
    });
  }

  describe('subscribe', () => {
    it('sends topic_subscribe for v4 backends', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;
      seedV4Backend('backend-123');

      transport.subscribe('backend-123');

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage).toEqual({
        type: 'topic_subscribe',
        backendId: 'backend-123',
        topic: 'resources',
      });
    });

    it('refuses non-v4 backends', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;
      (transport as any).registryItems.set('backend-v3', { backendId: 'backend-v3' });

      transport.subscribe('backend-v3');

      expect(mockWs.send).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not send if already subscribed to backend', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;
      transport.subscribedBackends.add('backend-123');

      transport.subscribe('backend-123');

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('sends topic_unsubscribe', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      transport.unsubscribe('backend-123');

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage).toEqual({
        type: 'topic_unsubscribe',
        backendId: 'backend-123',
        topic: 'resources',
      });
    });
  });

  describe('sendToBackend', () => {
    it('queues the frame and requests a channel when none is open yet', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;
      seedV4Backend('backend-123');
      transport.subscribedBackends.add('backend-123');

      const message: ClientMessage = {
        type: 'run_start',
        clientRequestId: 'test-request-id',
        sessionId: 'session-456',
        input: 'Test',
      };

      transport.sendToBackend('backend-123', message);

      // The message waits for the channel; a channel_open goes out
      const queued = (transport as any).pendingChannelFrames.get('backend-123');
      expect(queued).toHaveLength(1);
      expect(JSON.parse(queued[0])).toEqual(message);
      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage).toMatchObject({
        type: 'channel_open',
        target: 'backend-123',
        kind: 'zclaudia',
      });
    });

    it('logs error when not subscribed to backend', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      transport.sendToBackend('backend-123', {
        type: 'run_start',
        clientRequestId: 'test',
        sessionId: 'test',
        input: '',
      } as any);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[GatewayTransport] Cannot send: not subscribed to backend',
        'backend-123'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('WebSocket event handlers', () => {
    it('sends peer_hello on open', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.onopen();

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('peer_hello');
      expect(sentMessage.gatewaySecret).toBe('test-secret');
      expect(sentMessage.protocolVersion).toBe(4);
      expect(sentMessage.namespace).toBe('zclaudia');
      expect(sentMessage.clientProtocolVersion).toBe(1);
      expect(sentMessage.peerType).toBe('client-only');
      expect(sentMessage.identity).toEqual({ deviceId: 'device-1', instanceId: 'instance-1' });
    });

    it('calls onDisconnected on close', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.onclose({ code: 1000, reason: '', wasClean: true });

      expect(mockConfig.onDisconnected).toHaveBeenCalled();
    });

    it('calls onError on error', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      const error = new Event('error');
      mockWs.onerror(error);

      expect(mockConfig.onError).toHaveBeenCalledWith(error);
    });
  });

  describe('message handling', () => {
    beforeEach(() => {
      transport.connect();
    });

    it('handles peer_ready', () => {
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;

      const message = {
        type: 'peer_ready',
        peerSessionId: 'peer-session-1',
        recoveryToken: 'token-abc',
        registrySync: {
          mode: 'snapshot',
          items: [{ backendId: 'backend-1', name: 'Backend 1', epoch: 1 }],
          revision: 1,
        },
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect((transport as any).authenticated).toBe(true);
      expect(transport.getPeerSessionId()).toBe('peer-session-1');
      expect(transport.getRecoveryToken()).toBe('token-abc');
      expect(mockConfig.onConnected).toHaveBeenCalledWith('peer-session-1', 'token-abc');
      expect(mockConfig.onRegistryChanged).toHaveBeenCalled();
    });

    it('handles registry_snapshot', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'registry_snapshot',
        items: [{ backendId: 'backend-1', name: 'Backend 1', epoch: 1 }],
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(transport.getRegistryItems().size).toBe(1);
      expect(mockConfig.onRegistryChanged).toHaveBeenCalled();
    });

    it('handles registry_snapshot replacing previous items', () => {
      const mockWs = (transport as any).ws;

      // First snapshot
      mockWs.onmessage({
        data: JSON.stringify({
          type: 'registry_snapshot',
          items: [
            { backendId: 'backend-1', name: 'Backend 1', epoch: 1 },
            { backendId: 'backend-2', name: 'Backend 2', epoch: 1 },
          ],
        }),
      } as MessageEvent);

      expect(transport.getRegistryItems().size).toBe(2);

      // Second snapshot removes backend-1
      mockWs.onmessage({
        data: JSON.stringify({
          type: 'registry_snapshot',
          items: [{ backendId: 'backend-2', name: 'Backend 2', epoch: 1 }],
        }),
      } as MessageEvent);

      expect(transport.getRegistryItems().size).toBe(1);
      expect(transport.getRegistryItems().has('backend-1')).toBe(false);
      expect(transport.getRegistryItems().has('backend-2')).toBe(true);
    });

    it('emits removed backend ids without mutating business stores', () => {
      const mockWs = (transport as any).ws;

      mockWs.onmessage({
        data: JSON.stringify({
          type: 'registry_snapshot',
          items: [
            { backendId: 'backend-1', name: 'Backend 1', epoch: 1 },
            { backendId: 'backend-2', name: 'Backend 2', epoch: 1 },
          ],
        }),
      } as MessageEvent);

      mockWs.onmessage({
        data: JSON.stringify({
          type: 'registry_snapshot',
          items: [{ backendId: 'backend-2', name: 'Backend 2', epoch: 1 }],
        }),
      } as MessageEvent);

      expect(mockConfig.onBackendsRemoved).toHaveBeenCalledWith(['backend-1']);
      expect(storeMocks.clearBackendSessions).not.toHaveBeenCalled();
      expect(storeMocks.replaceProjectsForBackend).not.toHaveBeenCalled();
      expect(storeMocks.removeProjectOwnersByBackend).not.toHaveBeenCalled();
    });

    it('handles topic_subscribed (synthesizes backend_subscribed from presence)', () => {
      const mockWs = (transport as any).ws;
      (transport as any).authenticated = true;
      seedV4Backend('backend-123', { epoch: 5, capabilities: ['run'] });

      mockWs.onmessage({
        data: JSON.stringify({
          type: 'topic_subscribed',
          backendId: 'backend-123',
          topic: 'resources',
        }),
      } as MessageEvent);

      expect(transport.subscribedBackends.has('backend-123')).toBe(true);
      expect(transport.isBackendSubscribed('backend-123')).toBe(true);
      expect(mockConfig.onBackendSubscribed).toHaveBeenCalledWith('backend-123', 5, ['run']);
    });

    it('routes topic_message resource payloads through the data callbacks', () => {
      const mockWs = (transport as any).ws;
      mockWs.onmessage({
        data: JSON.stringify({
          type: 'topic_message',
          backendId: 'backend-123',
          topic: 'resources',
          payload: {
            type: 'backend_resource_snapshot',
            resources: [
              { resourceType: 'session', resourceId: 's1', resource: { sessionId: 's1' } },
              { resourceType: 'project', resourceId: 'p1', resource: { projectId: 'p1' } },
            ],
          },
        }),
      } as MessageEvent);

      expect(mockConfig.onBackendDataSnapshot).toHaveBeenCalledWith(
        'backend-123',
        [{ sessionId: 's1' }],
        [{ projectId: 'p1' }]
      );

      mockWs.onmessage({
        data: JSON.stringify({
          type: 'topic_message',
          backendId: 'backend-123',
          topic: 'resources',
          payload: { type: 'backend_resource_event', op: 'remove', resourceType: 'session', resourceId: 's1' },
        }),
      } as MessageEvent);
      expect(mockConfig.onBackendDataEvent).toHaveBeenCalledWith(
        'backend-123',
        expect.objectContaining({ op: 'remove', resourceId: 's1' })
      );
    });

    it('handles topic_unsubscribed', () => {
      const mockWs = (transport as any).ws;
      // Set up an existing subscription
      transport.subscribedBackends.add('backend-123');

      const message = {
        type: 'topic_unsubscribed',
        backendId: 'backend-123',
        topic: 'resources',
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(transport.subscribedBackends.has('backend-123')).toBe(false);
      expect(transport.isBackendSubscribed('backend-123')).toBe(false);
      expect(mockConfig.onBackendUnsubscribed).toHaveBeenCalledWith(
        'backend-123',
        'client_unsubscribed'
      );
    });

    it('handles backend_server_message', () => {
      const mockWs = (transport as any).ws;
      // Set up an existing subscription
      transport.subscribedBackends.add('backend-123');

      const innerMessage: ServerMessage = {
        type: 'delta',
        runId: 'test-run-id',
        sessionId: 'test-session',
        content: 'Hello',
      };

      const message = {
        type: 'backend_server_message',
        backendId: 'backend-123',
        message: innerMessage,
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onBackendServerMessage).toHaveBeenCalledWith('backend-123', innerMessage);
    });

    it('handles gateway_error', () => {
      const mockWs = (transport as any).ws;

      const message = {
        type: 'gateway_error',
        code: 'GENERIC_ERROR',
        message: 'Something went wrong',
      };

      mockWs.onmessage({ data: JSON.stringify(message) } as MessageEvent);

      expect(mockConfig.onError).toHaveBeenCalledWith('GENERIC_ERROR: Something went wrong');
    });

  });

  describe('health probe', () => {
    it('sends ping when connected', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;

      transport.probeHealth();

      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('ping');
      expect(sentMessage.ts).toBeDefined();
    });

    it('does nothing when not connected', () => {
      transport.probeHealth();
      // Should not throw
    });

    it('clears health probe timeout on pong', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;

      transport.probeHealth();
      expect((transport as any).healthProbeTimeout).not.toBeNull();

      mockWs.onmessage({ data: JSON.stringify({ type: 'pong', ts: Date.now() }) } as MessageEvent);
      expect((transport as any).healthProbeTimeout).toBeNull();
    });
  });

  describe('content operations', () => {
    it('sends catch_up_content over the message channel (queued until open)', () => {
      transport.connect();
      const mockWs = (transport as any).ws;
      mockWs.readyState = WebSocket.OPEN;
      (transport as any).authenticated = true;
      seedV4Backend('backend-1');

      transport.catchUpContent('backend-1', 'session-1', 10);

      const queued = (transport as any).pendingChannelFrames.get('backend-1');
      expect(queued).toHaveLength(1);
      expect(JSON.parse(queued[0])).toEqual({
        type: 'catch_up_content',
        backendId: 'backend-1',
        contentStreamId: 'session-1',
        afterOffset: 10,
      });
      const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe('channel_open');
    });
  });

  describe('forceReconnect', () => {
    it('resets reconnect attempt and reconnects', () => {
      transport.connect();
      const firstWs = (transport as any).ws;

      transport.forceReconnect();

      expect(firstWs.close).toHaveBeenCalled();
      expect((transport as any).reconnectAttempt).toBe(0);
    });
  });

  describe('v4 message channels', () => {
    let wsInstances: any[];

    beforeEach(() => {
      wsInstances = [];
      const Base: any = globalThis.WebSocket;
      class Tracked extends Base {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      }
      vi.stubGlobal('WebSocket', Tracked);
      transport = new GatewayTransport(mockConfig);
    });

    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    function presence(backendId: string, gatewayProtocolVersion?: number) {
      return {
        backendId,
        namespace: 'zclaudia',
        instanceId: `inst-${backendId}`,
        deviceId: `dev-${backendId}`,
        name: backendId,
        channel: 'prod',
        visible: true,
        capabilities: [],
        backendProtocolVersion: 1,
        epoch: 1,
        connectedAt: 0,
        lastSeenAt: 0,
        ...(gatewayProtocolVersion ? { gatewayProtocolVersion } : {}),
      };
    }

    async function connectReady(items: unknown[]) {
      transport.connect();
      await flush();
      const ctl = wsInstances[0];
      ctl.onmessage({
        data: JSON.stringify({
          type: 'peer_ready',
          peerSessionId: 'peer-1',
          recoveryToken: 'rt',
          registrySync: { items },
        }),
      });
      return ctl;
    }

    function subscribeAndConfirm(ctl: any, backendId: string) {
      transport.subscribe(backendId);
      ctl.onmessage({
        data: JSON.stringify({ type: 'topic_subscribed', backendId, topic: 'resources' }),
      });
    }

    it('subscribe drives topic_subscribe then a channel_open', async () => {
      const ctl = await connectReady([presence('b4', 4)]);
      subscribeAndConfirm(ctl, 'b4');
      await flush();

      const sent = ctl.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      expect(sent.filter((m: any) => m.type === 'topic_subscribe')).toHaveLength(1);
      const opens = sent.filter((m: any) => m.type === 'channel_open');
      expect(opens).toHaveLength(1);
      expect(opens[0]).toMatchObject({ target: 'b4', kind: 'zclaudia' });
    });

    it('dials the data socket on channel_ready, flushes queued frames, and routes replies', async () => {
      const ctl = await connectReady([presence('b4', 4)]);
      subscribeAndConfirm(ctl, 'b4');
      await flush();

      // Sent before the channel is up: must be queued, then flushed on open
      transport.sendToBackend('b4', { type: 'early' } as never);

      ctl.onmessage({
        data: JSON.stringify({
          type: 'channel_ready',
          channelId: 'ch-1',
          ticket: 'tk1',
          dataPath: '/channel/ch-1',
        }),
      });
      await flush();

      const dataWs = wsInstances.find((w: any) => String(w.url).includes('/channel/'));
      expect(dataWs).toBeDefined();
      expect(dataWs.url).toBe('ws://gateway.example.com/channel/ch-1?ticket=tk1');
      expect(JSON.parse(dataWs.send.mock.calls[0][0])).toEqual({ type: 'early' });

      transport.sendToBackend('b4', { type: 'ping' } as ClientMessage);
      expect(JSON.parse(dataWs.send.mock.calls[1][0])).toEqual({ type: 'ping' });

      // Inbound frames: server messages and in-band content patches
      dataWs.onmessage({ data: JSON.stringify({ type: 'state_heartbeat' }) });
      expect(mockConfig.onBackendServerMessage).toHaveBeenCalledWith('b4', {
        type: 'state_heartbeat',
      });
      dataWs.onmessage({
        data: JSON.stringify({
          type: 'content_patch',
          backendId: 'b4',
          contentStreamId: 'sess-1',
          patches: [{ offset: 7 }],
          latestOffset: 7,
        }),
      });
      expect(mockConfig.onContentPatch).toHaveBeenCalledWith('b4', 'sess-1', [{ offset: 7 }], 7);
    });

    it('queues frames and reopens when the channel drops', async () => {
      const ctl = await connectReady([presence('b4', 4)]);
      subscribeAndConfirm(ctl, 'b4');
      await flush();
      ctl.onmessage({
        data: JSON.stringify({
          type: 'channel_ready',
          channelId: 'ch-1',
          ticket: 'tk1',
          dataPath: '/channel/ch-1',
        }),
      });
      await flush();
      const dataWs = wsInstances.find((w: any) => String(w.url).includes('/channel/'));
      dataWs.onclose(new CloseEvent('close'));

      ctl.send.mockClear();
      transport.sendToBackend('b4', { type: 'ping' } as ClientMessage);
      await flush();

      // No v3 fallback exists any more: the frame waits for the reopen
      const queued = (transport as any).pendingChannelFrames.get('b4');
      expect(queued).toHaveLength(1);
      const sent = ctl.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      expect(sent.some((m: any) => m.type === 'channel_open')).toBe(true);
      expect(sent.some((m: any) => m.type === 'backend_client_message')).toBe(false);

      // Reopen completes: the queued frame flushes on the new socket
      ctl.onmessage({
        data: JSON.stringify({
          type: 'channel_ready',
          channelId: 'ch-2',
          ticket: 'tk2',
          dataPath: '/channel/ch-2',
        }),
      });
      await flush();
      const dataWs2 = wsInstances.find((w: any) => String(w.url).includes('/channel/ch-2'));
      expect(JSON.parse(dataWs2.send.mock.calls[0][0])).toEqual({ type: 'ping' });
    });

    it('consumes channel-open failures without escalating onError', async () => {
      const ctl = await connectReady([presence('b4', 4)]);
      subscribeAndConfirm(ctl, 'b4');
      await flush();

      ctl.onmessage({
        data: JSON.stringify({ type: 'gateway_error', code: 'BACKEND_OFFLINE', message: 'gone' }),
      });
      expect(mockConfig.onError).not.toHaveBeenCalled();
      expect((transport as any).channelOpenInFlight).toBe(false);
    });
  });
});

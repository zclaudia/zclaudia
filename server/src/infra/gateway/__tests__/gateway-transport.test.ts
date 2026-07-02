import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { GatewayTransport, type GatewayTransportDeps } from '../gateway-transport.js';

vi.mock('ws', () => {
  const MockWebSocket = vi.fn().mockImplementation(function (this: any) {
    this.on = vi.fn();
    this.removeAllListeners = vi.fn();
    this.close = vi.fn();
    this.send = vi.fn();
    this.readyState = 1;
  });
  (MockWebSocket as any).OPEN = 1;
  (MockWebSocket as any).CLOSED = 0;
  return { default: MockWebSocket };
});

function makeDeps(overrides: Partial<GatewayTransportDeps> = {}): GatewayTransportDeps {
  return {
    resolveWsUrl: () => 'ws://gateway.example.com/ws',
    createAgent: () => undefined,
    isConnected: () => false,
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onDisconnect: vi.fn(),
    ...overrides,
  };
}

function handlerFor(ws: any, event: string): (...args: any[]) => void {
  return ws.on.mock.calls.find((c: any[]) => c[0] === event)?.[1];
}

describe('GatewayTransport', () => {
  let transport: GatewayTransport;

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('connect', () => {
    it('creates a WebSocket to the resolved url and wires handlers', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      expect(WebSocket).toHaveBeenCalledWith('ws://gateway.example.com/ws', expect.any(Object));
      const ws = (transport as any).ws;
      expect(handlerFor(ws, 'open')).toBeTypeOf('function');
      expect(handlerFor(ws, 'message')).toBeTypeOf('function');
      expect(handlerFor(ws, 'close')).toBeTypeOf('function');
      expect(handlerFor(ws, 'error')).toBeTypeOf('function');
    });

    it('closes an existing socket before reconnecting', () => {
      transport = new GatewayTransport(makeDeps());
      const mockWs = { removeAllListeners: vi.fn(), close: vi.fn() };
      (transport as any).ws = mockWs;
      transport.connect();
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('invokes onOpen when the socket opens', () => {
      const onOpen = vi.fn();
      transport = new GatewayTransport(makeDeps({ onOpen }));
      transport.connect();
      handlerFor((transport as any).ws, 'open')();
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('parses and forwards messages to onMessage', () => {
      const onMessage = vi.fn();
      transport = new GatewayTransport(makeDeps({ onMessage }));
      transport.connect();
      handlerFor((transport as any).ws, 'message')(Buffer.from(JSON.stringify({ type: 'x' })));
      expect(onMessage).toHaveBeenCalledWith({ type: 'x' });
    });
  });

  describe('reconnect', () => {
    beforeEach(() => vi.useFakeTimers());

    it('schedules reconnect with an incremented attempt on close (code != 4000)', () => {
      const onDisconnect = vi.fn();
      transport = new GatewayTransport(makeDeps({ onDisconnect }));
      transport.connect();
      handlerFor((transport as any).ws, 'close')(1000);
      expect(onDisconnect).toHaveBeenCalledWith(1000);
      expect((transport as any).reconnectTimeout).not.toBeNull();
      expect((transport as any).reconnectAttempts).toBe(1);
    });

    it('does not reconnect on close code 4000', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      handlerFor((transport as any).ws, 'close')(4000);
      expect((transport as any).reconnectTimeout).toBeNull();
    });

    it('schedules reconnect on error', () => {
      const onDisconnect = vi.fn();
      transport = new GatewayTransport(makeDeps({ onDisconnect }));
      transport.connect();
      handlerFor((transport as any).ws, 'error')(new Error('boom'));
      expect(onDisconnect).toHaveBeenCalledWith(null);
      expect((transport as any).reconnectTimeout).not.toBeNull();
    });

    it('aborts + reconnects on connect-timeout only when not connected', () => {
      transport = new GatewayTransport(makeDeps({ isConnected: () => false }));
      transport.connect();
      vi.advanceTimersByTime((transport as any).connectTimeoutMs);
      expect((transport as any).reconnectTimeout).not.toBeNull();
    });

    it('does not abort on connect-timeout when already connected', () => {
      transport = new GatewayTransport(makeDeps({ isConnected: () => true }));
      transport.connect();
      vi.advanceTimersByTime((transport as any).connectTimeoutMs);
      expect((transport as any).reconnectTimeout).toBeNull();
    });

    it('does not reconnect after intentional disconnect', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      const close = handlerFor((transport as any).ws, 'close');
      transport.disconnect();
      close?.(1000);
      expect((transport as any).reconnectTimeout).toBeNull();
    });

    it('caps the backoff interval at the max', () => {
      transport = new GatewayTransport(makeDeps());
      (transport as any).reconnectAttempts = 10;
      (transport as any).scheduleReconnect();
      expect((transport as any).reconnectMaxInterval).toBe(60000);
    });
  });

  describe('disconnect', () => {
    it('sets intentional disconnect, notifies, and closes the socket', () => {
      const onDisconnect = vi.fn();
      transport = new GatewayTransport(makeDeps({ onDisconnect }));
      const mockWs = { removeAllListeners: vi.fn(), close: vi.fn() };
      (transport as any).ws = mockWs;
      transport.disconnect();
      expect((transport as any).intentionalDisconnect).toBe(true);
      expect(onDisconnect).toHaveBeenCalledWith(null);
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe('send + queue', () => {
    it('sends immediately when the socket is OPEN', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      const ws = (transport as any).ws;
      ws.readyState = 1;
      transport.send({ a: 1 });
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ a: 1 }));
    });

    it('drops the message when offline and not queueing', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      const ws = (transport as any).ws;
      ws.readyState = 0;
      transport.send({ a: 1 });
      expect(ws.send).not.toHaveBeenCalled();
      expect((transport as any).pendingMessages).toHaveLength(0);
    });

    it('queues when offline with queueIfOffline and flushes on flushQueue', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      const ws = (transport as any).ws;
      ws.readyState = 0;
      transport.send({ a: 1 }, true);
      expect((transport as any).pendingMessages).toHaveLength(1);
      ws.readyState = 1;
      transport.flushQueue();
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ a: 1 }));
      expect((transport as any).pendingMessages).toHaveLength(0);
    });

    it('drops the oldest queued message past the 200 cap', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      (transport as any).ws.readyState = 0;
      for (let i = 0; i < 205; i++) transport.send({ i }, true);
      expect((transport as any).pendingMessages).toHaveLength(200);
      expect((transport as any).pendingMessages[0]).toBe(JSON.stringify({ i: 5 }));
    });
  });

  describe('notifyHandshakeComplete', () => {
    it('clears the connect timeout and resets reconnect attempts', () => {
      vi.useFakeTimers();
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      (transport as any).reconnectAttempts = 3;
      transport.notifyHandshakeComplete();
      expect((transport as any).connectTimeout).toBeNull();
      expect((transport as any).reconnectAttempts).toBe(0);
    });
  });
});

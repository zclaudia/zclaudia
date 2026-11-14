import net from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayTransport } from '../gateway-transport.js';

describe('GatewayTransport handshake cancellation with real sockets', () => {
  let transport: GatewayTransport | undefined;
  let server: net.Server | undefined;
  const sockets = new Set<net.Socket>();

  afterEach(async () => {
    transport?.disconnect();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
  });

  it.each(['timeout', 'disconnect', 'replace'] as const)(
    'survives %s during an unfinished WebSocket handshake',
    async action => {
      // Accept TCP connections but never finish the HTTP upgrade. This exercises
      // ws's asynchronous error emission, which a close() spy cannot reproduce.
      server = net.createServer(socket => {
        sockets.add(socket);
        socket.resume();
        socket.on('error', () => {});
        socket.on('close', () => sockets.delete(socket));
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const port = (server.address() as net.AddressInfo).port;
      const onDisconnect = vi.fn();
      transport = new GatewayTransport({
        resolveWsUrl: () => `ws://127.0.0.1:${port}/ws`,
        createAgent: () => undefined,
        isConnected: () => false,
        onOpen: vi.fn(),
        onMessage: vi.fn(),
        onDisconnect,
      });
      if (action === 'timeout') Object.assign(transport, { connectTimeoutMs: 100 });
      const connected = once(server, 'connection');
      transport.connect();
      await connected;

      if (action === 'disconnect') transport.disconnect();
      if (action === 'replace') transport.connect();
      await vi.waitFor(() => {
        if (action === 'timeout') expect(onDisconnect).toHaveBeenCalledWith(null);
        expect([...sockets].some(socket => !socket.destroyed)).toBe(action === 'replace');
      });
      expect(transport.hasSocket()).toBe(action === 'replace');
      if (action === 'timeout') {
        // The timeout retains the reconnect timer; a subsequent attempt can run.
        expect(Reflect.get(transport, 'reconnectTimeout')).not.toBeNull();
      }
    }
  );
});

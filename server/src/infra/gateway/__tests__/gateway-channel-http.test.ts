// Tests for the v4 HTTP-over-channel unit: a mock gateway data endpoint
// (WebSocketServer) plus a real local HTTP server stand in for the two ends.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { handleHttpChannelOffer } from '../gateway-channel-http.js';
import type { ChannelOfferMessage } from '@zclaudia/gateway-protocol';

interface ResponseCapture {
  meta: { status: number; headers: Record<string, string> } | null;
  chunks: Buffer[];
  closed: boolean;
}

describe('gateway-channel-http', () => {
  let localServer: http.Server;
  let localPort: number;
  let wss: WebSocketServer;
  let wsPort: number;
  let localHandler: http.RequestListener;

  beforeEach(async () => {
    localHandler = (_req, res) => res.end('ok');
    localServer = http.createServer((req, res) => localHandler(req, res));
    await new Promise<void>(resolve => localServer.listen(0, '127.0.0.1', resolve));
    localPort = (localServer.address() as AddressInfo).port;

    wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(resolve => wss.once('listening', resolve));
    wsPort = (wss.address() as AddressInfo).port;
  });

  afterEach(async () => {
    wss.close();
    await new Promise<void>(resolve => localServer.close(() => resolve()));
  });

  function dial(request: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: Buffer;
  }): Promise<ResponseCapture> {
    return new Promise((resolve, reject) => {
      const capture: ResponseCapture = { meta: null, chunks: [], closed: false };
      const timer = setTimeout(() => reject(new Error('channel test timeout')), 5000);
      wss.once('connection', (socket: WebSocket) => {
        socket.on('message', (data: Buffer, isBinary: boolean) => {
          if (isBinary) {
            capture.chunks.push(data);
          } else {
            capture.meta = JSON.parse(data.toString());
          }
        });
        socket.on('close', () => {
          capture.closed = true;
          clearTimeout(timer);
          resolve(capture);
        });
        socket.send(
          JSON.stringify({
            type: 'http_request',
            method: request.method,
            path: request.path,
            headers: request.headers ?? {},
          })
        );
        if (request.body && request.body.length > 0) socket.send(request.body);
        socket.send(JSON.stringify({ type: 'http_request_end' }));
      });

      const offer: ChannelOfferMessage = {
        type: 'channel_offer',
        channelId: 'ch-test',
        kind: 'http',
        ticket: 'ticket-test',
        dataPath: '/',
      };
      handleHttpChannelOffer(offer, {
        serverPort: localPort,
        resolveWsBase: () => `ws://127.0.0.1:${wsPort}`,
        createAgent: () => undefined,
      });
    });
  }

  test('streams a binary response without base64', async () => {
    const payload = Buffer.alloc(300 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
    localHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(payload);
    };

    const result = await dial({ method: 'GET', path: '/blob' });
    expect(result.meta).toMatchObject({ type: 'http_response', status: 200 });
    expect(result.meta!.headers['content-type']).toBe('application/octet-stream');
    expect(Buffer.concat(result.chunks).equals(payload)).toBe(true);
    expect(result.closed).toBe(true);
  });

  test('delivers the request body and forwards status/headers back', async () => {
    let received: Buffer | null = null;
    let receivedPath = '';
    localHandler = (req, res) => {
      receivedPath = req.url ?? '';
      const parts: Buffer[] = [];
      req.on('data', c => parts.push(c));
      req.on('end', () => {
        received = Buffer.concat(parts);
        res.writeHead(201, { 'x-echo': 'yes' });
        res.end(JSON.stringify({ ok: true }));
      });
    };

    const body = Buffer.from(JSON.stringify({ hello: 'v4' }));
    const result = await dial({
      method: 'POST',
      path: '/api/things?a=1',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(receivedPath).toBe('/api/things?a=1');
    expect(received!.equals(body)).toBe(true);
    expect(result.meta!.status).toBe(201);
    expect(result.meta!.headers['x-echo']).toBe('yes');
    expect(JSON.parse(Buffer.concat(result.chunks).toString())).toEqual({ ok: true });
  });

  test('request body streams: local fetch starts before http_request_end', async () => {
    let sawHeadersAt = 0;
    let bodyDoneAt = 0;
    let received: Buffer | null = null;
    localHandler = (req, res) => {
      sawHeadersAt = Date.now();
      const parts: Buffer[] = [];
      req.on('data', c => parts.push(c));
      req.on('end', () => {
        bodyDoneAt = Date.now();
        received = Buffer.concat(parts);
        res.end('done');
      });
    };

    const chunk = Buffer.alloc(64 * 1024, 3);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stream test timeout')), 5000);
      wss.once('connection', (socket: WebSocket) => {
        socket.send(
          JSON.stringify({ type: 'http_request', method: 'POST', path: '/stream', headers: {} })
        );
        socket.send(chunk);
        // Hold the tail back long enough to observe the early fetch dispatch
        setTimeout(() => {
          socket.send(chunk);
          socket.send(JSON.stringify({ type: 'http_request_end' }));
        }, 300);
        socket.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      handleHttpChannelOffer(
        { type: 'channel_offer', channelId: 'ch-stream', kind: 'http', ticket: 't', dataPath: '/' },
        { serverPort: localPort, resolveWsBase: () => `ws://127.0.0.1:${wsPort}`, createAgent: () => undefined }
      );
    });

    expect(received!.length).toBe(chunk.length * 2);
    // The local request began (headers seen) well before the body finished —
    // i.e. the adapter did not buffer the request before dispatching.
    expect(bodyDoneAt - sawHeadersAt).toBeGreaterThanOrEqual(250);
  });

  test('unreachable local server yields a 502 frame', async () => {
    await new Promise<void>(resolve => localServer.close(() => resolve()));
    localServer = http.createServer(() => {}); // afterEach still has something to close
    await new Promise<void>(resolve => localServer.listen(0, '127.0.0.1', resolve));

    const result = await dial({ method: 'GET', path: '/dead' });
    expect(result.meta!.status).toBe(502);
    expect(result.closed).toBe(true);
  });

  test('closing the data socket aborts the local request', async () => {
    let aborted = false;
    localHandler = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.write('partial'); // start, never finish
      req.on('close', () => {
        aborted = true;
      });
    };

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('abort test timeout')), 5000);
      wss.once('connection', (socket: WebSocket) => {
        socket.send(
          JSON.stringify({ type: 'http_request', method: 'GET', path: '/slow', headers: {} })
        );
        socket.send(JSON.stringify({ type: 'http_request_end' }));
        // Tear the channel down as soon as the first response bytes arrive
        socket.on('message', (_data: Buffer, isBinary: boolean) => {
          if (isBinary) socket.close(1000);
        });
        socket.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      handleHttpChannelOffer(
        { type: 'channel_offer', channelId: 'ch-abort', kind: 'http', ticket: 't', dataPath: '/' },
        { serverPort: localPort, resolveWsBase: () => `ws://127.0.0.1:${wsPort}`, createAgent: () => undefined }
      );
    });

    await new Promise(resolve => setTimeout(resolve, 300));
    expect(aborted).toBe(true);
  });
});

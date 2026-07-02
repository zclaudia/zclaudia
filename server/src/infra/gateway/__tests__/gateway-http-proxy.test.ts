import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayHttpProxyRequest } from '@zclaudia/protocol/gateway';
import {
  handleHttpProxyRequest,
  isUtf8Response,
  normalizeProxyRequestBody,
  shouldStream,
} from '../gateway-http-proxy.js';

describe('gateway HTTP proxy helpers', () => {
  it('isUtf8Response treats text-like content types as utf8', () => {
    expect(isUtf8Response({ 'content-type': 'text/html; charset=utf-8' })).toBe(true);
    expect(isUtf8Response({ 'content-type': 'application/json' })).toBe(true);
    expect(isUtf8Response({ 'content-type': 'application/problem+json' })).toBe(true);
    expect(isUtf8Response({ 'content-type': 'image/png' })).toBe(false);
    expect(isUtf8Response({})).toBe(false);
  });

  it('normalizeProxyRequestBody passes through strings/buffers and JSON-encodes objects', () => {
    expect(normalizeProxyRequestBody(undefined)).toBeUndefined();
    expect(normalizeProxyRequestBody('raw')).toBe('raw');
    const buf = Buffer.from('x');
    expect(normalizeProxyRequestBody(buf)).toBe(buf);
    expect(normalizeProxyRequestBody(Uint8Array.from([1, 2]))).toEqual(Buffer.from([1, 2]));
    expect(normalizeProxyRequestBody({ a: 1 })).toBe('{"a":1}');
  });

  it('shouldStream streams binary and large payloads only', () => {
    expect(shouldStream({ 'content-type': 'application/json' })).toBe(false);
    expect(shouldStream({ 'content-type': 'application/octet-stream' })).toBe(true);
    expect(
      shouldStream({
        'content-type': 'application/json',
        'content-length': String(2 * 1024 * 1024),
      })
    ).toBe(true);
  });
});

describe('handleHttpProxyRequest', () => {
  const baseRequest: GatewayHttpProxyRequest = {
    type: 'http_proxy_request',
    requestId: 'req-1',
    method: 'GET',
    path: '/api/health',
    headers: {},
  } as GatewayHttpProxyRequest;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buffers a JSON response into a single http_proxy_response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    const sent: unknown[] = [];
    await handleHttpProxyRequest(baseRequest, { serverPort: 3100, sendWs: d => sent.push(d) });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'http_proxy_response',
      requestId: 'req-1',
      statusCode: 200,
      bodyEncoding: 'utf8',
      body: '{"ok":true}',
    });
  });

  it('streams binary responses as start/chunk/end frames', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        })
      )
    );
    const sent: Array<{ type: string }> = [];
    await handleHttpProxyRequest(baseRequest, {
      serverPort: 3100,
      sendWs: d => sent.push(d as { type: string }),
    });

    expect(sent.map(m => m.type)).toEqual([
      'http_proxy_response_start',
      'http_proxy_response_chunk',
      'http_proxy_response_end',
    ]);
  });

  it('returns a 502 http_proxy_response when the local server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sent: Array<{ statusCode?: number }> = [];
    await handleHttpProxyRequest(baseRequest, {
      serverPort: 3100,
      sendWs: d => sent.push(d as { statusCode?: number }),
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'http_proxy_response', statusCode: 502 });
  });
});

// HTTP-proxy handling for the gateway client. Extracted from GatewayClient so the
// request/response proxying is a cohesive, independently testable unit that depends only
// on the local server port and a WebSocket send function (see QA-0027).
import type {
  GatewayHttpProxyRequest,
  GatewayHttpProxyResponse,
  GatewayHttpProxyResponseChunk,
  GatewayHttpProxyResponseEnd,
  GatewayHttpProxyResponseStart,
} from '@zclaudia/protocol/gateway';

const STREAM_THRESHOLD = 1024 * 1024;

/** Whether a proxied response body should be streamed rather than buffered. */
export function shouldStream(headers: Record<string, string>): boolean {
  const contentLength = parseInt(headers['content-length'] || '0', 10);
  if (contentLength > STREAM_THRESHOLD) return true;
  const rawCt = (headers['content-type'] || '').toLowerCase();
  const ct = rawCt.split(';')[0].trim();
  if (!ct) return false;
  if (ct.startsWith('text/') || ct === 'application/json' || ct.endsWith('+json')) return false;
  if (ct === 'application/xml' || ct === 'text/xml' || ct.endsWith('+xml')) return false;
  if (ct === 'application/javascript' || ct === 'text/javascript') return false;
  if (ct === 'application/x-www-form-urlencoded') return false;
  return true;
}

/** Whether a buffered response body can be safely encoded as UTF-8 text. */
export function isUtf8Response(headers: Record<string, string>): boolean {
  const rawCt = (headers['content-type'] || '').toLowerCase();
  const ct = rawCt.split(';')[0].trim();
  if (!ct) return false;
  if (ct.startsWith('text/')) return true;
  if (ct === 'application/json' || ct.endsWith('+json')) return true;
  if (ct === 'application/xml' || ct === 'text/xml' || ct.endsWith('+xml')) return true;
  if (ct === 'application/javascript' || ct === 'text/javascript') return true;
  if (ct === 'application/x-www-form-urlencoded') return true;
  return false;
}

export function normalizeProxyRequestBody(body: unknown): string | Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string' || Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  return JSON.stringify(body);
}

export interface HttpProxyDeps {
  /** Local server port to proxy requests to. */
  serverPort: number;
  /** Sends a message back over the gateway WebSocket. */
  sendWs: (data: unknown) => void;
}

/**
 * Proxies a gateway HTTP request to the local server and streams or buffers the response
 * back over the WebSocket, mirroring the previous GatewayClient behaviour exactly.
 */
export async function handleHttpProxyRequest(
  msg: GatewayHttpProxyRequest,
  deps: HttpProxyDeps
): Promise<void> {
  const { serverPort, sendWs } = deps;
  const url = `http://localhost:${serverPort}${msg.path}`;
  try {
    const resp = await fetch(url, {
      method: msg.method,
      headers: msg.headers,
      body: !['GET', 'HEAD'].includes(msg.method)
        ? msg.bodyEncoding === 'base64' && typeof msg.body === 'string'
          ? Buffer.from(msg.body, 'base64')
          : normalizeProxyRequestBody(msg.body)
        : undefined,
    });
    const responseHeaders: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (shouldStream(responseHeaders) && resp.body) {
      sendWs({
        type: 'http_proxy_response_start',
        requestId: msg.requestId,
        statusCode: resp.status,
        headers: responseHeaders,
      } satisfies GatewayHttpProxyResponseStart);
      const reader = resp.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sendWs({
            type: 'http_proxy_response_chunk',
            requestId: msg.requestId,
            data: Buffer.from(value).toString('base64'),
          } satisfies GatewayHttpProxyResponseChunk);
        }
      } finally {
        reader.releaseLock();
      }
      sendWs({
        type: 'http_proxy_response_end',
        requestId: msg.requestId,
      } satisfies GatewayHttpProxyResponseEnd);
    } else {
      const bodyEncoding = isUtf8Response(responseHeaders)
        ? ('utf8' as const)
        : ('base64' as const);
      const body =
        bodyEncoding === 'utf8'
          ? await resp.text()
          : Buffer.from(await resp.arrayBuffer()).toString('base64');
      sendWs({
        type: 'http_proxy_response',
        requestId: msg.requestId,
        statusCode: resp.status,
        headers: responseHeaders,
        bodyEncoding,
        body,
      } satisfies GatewayHttpProxyResponse);
    }
  } catch (error) {
    console.error('[Gateway] HTTP proxy error:', error);
    sendWs({
      type: 'http_proxy_response',
      requestId: msg.requestId,
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      bodyEncoding: 'utf8',
      body: JSON.stringify({
        success: false,
        error: { code: 'PROXY_ERROR', message: 'Failed to reach local server' },
      }),
    } satisfies GatewayHttpProxyResponse);
  }
}

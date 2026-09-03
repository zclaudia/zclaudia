// HTTP-over-channel serving for Gateway Protocol v4. When this server registers
// with protocolVersion 4, the gateway routes /api/proxy/:backendId/* through a
// dedicated per-channel WebSocket (kind 'http') instead of http_proxy_* control
// messages: no base64, response bodies stream frame-by-frame. Mirrors
// gateway-http-proxy.ts in spirit — a cohesive unit depending only on the local
// server port and dial context. Frame protocol: zclaudia-gateway
// docs/protocol-v4.md §7.
import WebSocket from 'ws';
import type { SocksProxyAgent } from 'socks-proxy-agent';
import type { ChannelOfferMessage, HttpRequestFrame } from '@zclaudia/gateway-protocol';

export interface ChannelHttpDeps {
  /** Local server port to proxy requests to. */
  serverPort: number;
  /** ws(s)://host base of the gateway (no path). */
  resolveWsBase: () => string;
  /** Optional SOCKS proxy agent, same as the control connection uses. */
  createAgent: () => SocksProxyAgent | undefined;
}

/** Pause streaming to the socket above this send-buffer size. */
const SEND_HIGH_WATER = 4 * 1024 * 1024;

/** Send with backpressure: await the write when the buffer is over the mark. */
function sendWithBackpressure(ws: WebSocket, data: Buffer): Promise<void> {
  if (ws.bufferedAmount <= SEND_HIGH_WATER) {
    ws.send(data);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    ws.send(data, error => (error ? reject(error) : resolve()));
  });
}

/**
 * Dial the offered data socket and serve one HTTP request over it.
 * Request bodies are buffered (as the v3 path did); response bodies stream.
 */
export function handleHttpChannelOffer(offer: ChannelOfferMessage, deps: ChannelHttpDeps): void {
  const url = `${deps.resolveWsBase()}${offer.dataPath}?ticket=${encodeURIComponent(offer.ticket)}`;
  const wsOptions: { agent?: SocksProxyAgent } = {};
  const proxyAgent = deps.createAgent();
  if (proxyAgent) wsOptions.agent = proxyAgent;
  const ws = new WebSocket(url, wsOptions);

  let meta: HttpRequestFrame | null = null;
  const chunks: Buffer[] = [];
  const abort = new AbortController();
  let responding = false;

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      chunks.push(data);
      return;
    }
    let frame: { type?: string };
    try {
      frame = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (frame.type === 'http_request') {
      meta = frame as HttpRequestFrame;
    } else if (frame.type === 'http_request_end' && meta && !responding) {
      responding = true;
      void serve(ws, meta, Buffer.concat(chunks), deps, abort.signal);
    }
  });

  // Channel torn down (client gone, epoch change, timeout): stop local work.
  ws.on('close', () => abort.abort());
  ws.on('error', error => {
    console.error('[Gateway] HTTP channel error:', error);
    abort.abort();
  });
}

async function serve(
  ws: WebSocket,
  meta: HttpRequestFrame,
  body: Buffer,
  deps: ChannelHttpDeps,
  signal: AbortSignal
): Promise<void> {
  const url = `http://localhost:${deps.serverPort}${meta.path}`;
  try {
    const resp = await fetch(url, {
      method: meta.method,
      headers: meta.headers,
      body: !['GET', 'HEAD'].includes(meta.method) && body.length > 0 ? body : undefined,
      signal,
    });
    const headers: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      headers[key] = value;
    });
    ws.send(JSON.stringify({ type: 'http_response', status: resp.status, headers }));

    if (resp.body) {
      const reader = resp.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (ws.readyState !== WebSocket.OPEN) {
            await reader.cancel();
            break;
          }
          await sendWithBackpressure(ws, Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
    }
    // Closing the data socket marks end-of-response for the gateway.
    ws.close(1000);
  } catch (error) {
    if (!signal.aborted) {
      console.error('[Gateway] HTTP channel proxy error:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'http_response', status: 502, headers: {} }));
        ws.close(1000);
      }
    }
  }
}

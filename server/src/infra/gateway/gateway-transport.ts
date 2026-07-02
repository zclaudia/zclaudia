// Socket lifecycle + reconnect/backoff + offline send queue for the gateway client.
// Extracted from GatewayClient (QA-0027) as a standalone, injected-deps unit; session
// teardown (cleanup), isConnected and handshake stay in GatewayClient and are reached
// through the callbacks/queries below.
import WebSocket from 'ws';
import type { SocksProxyAgent } from 'socks-proxy-agent';

export interface GatewayTransportDeps {
  /** Full ws URL to connect to, e.g. ws://host/ws. */
  resolveWsUrl: () => string;
  /** Optional SOCKS proxy agent for the socket. */
  createAgent: () => SocksProxyAgent | undefined;
  /** Handshake-complete flag; used by the connect-timeout guard. */
  isConnected: () => boolean;
  /** Fired when the socket opens (client sends peer hello). */
  onOpen: () => void;
  /** Fired for each parsed inbound message. */
  onMessage: (parsed: Record<string, unknown>) => void;
  /** Fired on close/error/timeout so the client can run session teardown. */
  onDisconnect: (code: number | null) => void;
}

export class GatewayTransport {
  private static readonly MAX_PENDING_MESSAGES = 200;

  private ws: WebSocket | null = null;
  private intentionalDisconnect = false;
  private reconnectAttempts = 0;
  private reconnectBaseInterval = 5000;
  private reconnectMaxInterval = 60000;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectTimeout: NodeJS.Timeout | null = null;
  private connectTimeoutMs = 15000;
  private pendingMessages: string[] = [];

  constructor(private readonly deps: GatewayTransportDeps) {}

  connect(): void {
    this.intentionalDisconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearConnectTimeout();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    const wsUrl = this.deps.resolveWsUrl();
    console.log(`[Gateway] Connecting to ${wsUrl}...`);

    const wsOptions: { agent?: SocksProxyAgent } = {};
    const proxyAgent = this.deps.createAgent();
    if (proxyAgent) wsOptions.agent = proxyAgent;

    this.ws = new WebSocket(wsUrl, wsOptions);
    const currentWs = this.ws;

    this.connectTimeout = setTimeout(() => {
      if (this.ws !== currentWs || this.deps.isConnected()) return;
      console.warn(`[Gateway] Connection attempt timed out after ${this.connectTimeoutMs / 1000}s`);
      currentWs.removeAllListeners();
      currentWs.close();
      if (this.ws === currentWs) this.ws = null;
      this.deps.onDisconnect(null);
      this.scheduleReconnect();
    }, this.connectTimeoutMs);

    this.ws.on('open', () => {
      if (this.ws !== currentWs) return;
      this.deps.onOpen();
    });
    this.ws.on('message', (data: Buffer) => {
      if (this.ws !== currentWs) return;
      try {
        this.deps.onMessage(JSON.parse(data.toString()));
      } catch (error) {
        console.error('[Gateway] Failed to parse message:', error);
      }
    });
    this.ws.on('close', (code: number) => {
      if (this.ws !== currentWs) return;
      this.clearConnectTimeout();
      console.log(`[Gateway] Disconnected (code: ${code})`);
      this.deps.onDisconnect(code);
      if (code !== 4000) this.scheduleReconnect();
    });
    this.ws.on('error', error => {
      if (this.ws !== currentWs) return;
      this.clearConnectTimeout();
      console.error('[Gateway] Connection error:', error);
      this.deps.onDisconnect(null);
      this.scheduleReconnect();
    });
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearConnectTimeout();
    this.deps.onDisconnect(null);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  /** True when a socket object currently exists (mirrors the old `!!this.ws` guard). */
  hasSocket(): boolean {
    return this.ws !== null;
  }

  send(data: unknown, queueIfOffline = false): void {
    const json = JSON.stringify(data);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(json);
    } else if (queueIfOffline) {
      if (this.pendingMessages.length >= GatewayTransport.MAX_PENDING_MESSAGES) {
        this.pendingMessages.shift(); // drop oldest
      }
      this.pendingMessages.push(json);
    }
  }

  flushQueue(): void {
    if (this.pendingMessages.length === 0) return;
    const msgs = this.pendingMessages.splice(0);
    for (const json of msgs) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(json);
      }
    }
  }

  /** Called after a successful handshake: stop the connect timeout and reset backoff. */
  notifyHandshakeComplete(): void {
    this.clearConnectTimeout();
    this.reconnectAttempts = 0;
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect || this.reconnectTimeout) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectBaseInterval * Math.pow(2, this.reconnectAttempts - 1),
      this.reconnectMaxInterval
    );
    console.log(`[Gateway] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }
}

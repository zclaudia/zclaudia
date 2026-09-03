// Message channels for Gateway Protocol v4: a client opens a dedicated
// channel (kind 'zclaudia') to this backend and business messages flow over
// its data socket as JSON text frames — replacing the v3 pattern of
// backend_client_message / backend_server_message multiplexed over the shared
// control connection. One channel = one remote client session; the channelId
// keys the same virtual-client machinery that v3 uses (see manager.ts
// onIncomingMessage), so both paths coexist during migration.
import WebSocket from 'ws';
import type { SocksProxyAgent } from 'socks-proxy-agent';
import type { ChannelOfferMessage, ChannelReadyMessage } from '@zclaudia/gateway-protocol';

/** Channel kind carrying zclaudia business messages. */
export const MESSAGE_CHANNEL_KIND = 'zclaudia';

export interface MessageChannelDeps {
  /** ws(s)://host base of the gateway (no path). */
  resolveWsBase: () => string;
  /** Optional SOCKS proxy agent, same as the control connection uses. */
  createAgent: () => SocksProxyAgent | undefined;
  /** A parsed JSON text frame arrived from the client on this channel. */
  onMessage: (channelId: string, message: unknown) => void;
  /** The channel closed (client gone, epoch change, teardown). */
  onClosed: (channelId: string) => void;
}

export class GatewayMessageChannels {
  private readonly channels = new Map<string, WebSocket>();

  constructor(private readonly deps: MessageChannelDeps) {}

  /** Dial the offered data socket and wire it as a message channel. */
  handleOffer(offer: ChannelOfferMessage): void {
    const url = `${this.deps.resolveWsBase()}${offer.dataPath}?ticket=${encodeURIComponent(offer.ticket)}`;
    const wsOptions: { agent?: SocksProxyAgent } = {};
    const proxyAgent = this.deps.createAgent();
    if (proxyAgent) wsOptions.agent = proxyAgent;
    const ws = new WebSocket(url, wsOptions);

    ws.on('open', () => {
      this.channels.set(offer.channelId, ws);
    });
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      // Business messages are JSON text frames; binary frames are reserved.
      if (isBinary) return;
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.deps.onMessage(offer.channelId, message);
    });
    ws.on('close', () => {
      if (this.channels.delete(offer.channelId)) {
        this.deps.onClosed(offer.channelId);
      }
    });
    ws.on('error', error => {
      console.error('[Gateway] Message channel error:', error);
    });
  }

  /** True when channelId names a live message channel. */
  has(channelId: string): boolean {
    return this.channels.get(channelId)?.readyState === WebSocket.OPEN;
  }

  /**
   * Send a server message over the channel. Returns false when the channel
   * is unknown or not open (caller falls back to the legacy v3 path).
   */
  send(channelId: string, message: unknown): boolean {
    const ws = this.channels.get(channelId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  /** Close every channel (control-connection teardown). */
  closeAll(): void {
    for (const ws of this.channels.values()) {
      ws.close(1000);
    }
  }
}

// ============================================================================
// Outgoing channels (facade-client role: this server subscribes to REMOTE
// backends and opens message channels to them — the consumer mirror of
// GatewayMessageChannels above).
// ============================================================================

/** Max frames queued per backend while its channel (re)opens. */
const MAX_PENDING_FRAMES = 100;

export interface OutgoingChannelDeps {
  /** ws(s)://host base of the gateway (no path). */
  resolveWsBase: () => string;
  createAgent: () => SocksProxyAgent | undefined;
  /** Send a control-plane message (channel_open). */
  sendControl: (message: unknown) => void;
  /** A JSON text frame arrived from the remote backend on this channel. */
  onFrame: (backendId: string, frame: Record<string, unknown>) => void;
  /** The channel closed. */
  onClosed: (backendId: string) => void;
}

export class GatewayOutgoingChannels {
  private readonly channels = new Map<string, { channelId: string; ws: WebSocket }>();
  /** channel_ready has no request correlation: opens run FIFO, one at a time. */
  private pendingOpens: string[] = [];
  private openInFlight = false;
  private openTimer: NodeJS.Timeout | null = null;
  private pendingFrames = new Map<string, string[]>();

  constructor(private readonly deps: OutgoingChannelDeps) {}

  /** Queue a channel open toward this backend (no-op if open/queued). */
  request(backendId: string): void {
    if (this.channels.has(backendId)) return;
    if (this.pendingOpens.includes(backendId)) return;
    this.pendingOpens.push(backendId);
    this.pump();
  }

  /**
   * Send a frame to the backend over its channel, queueing (bounded) while
   * the channel (re)opens.
   */
  send(backendId: string, frame: unknown): void {
    const serialized = JSON.stringify(frame);
    const channel = this.channels.get(backendId);
    if (channel && channel.ws.readyState === WebSocket.OPEN) {
      channel.ws.send(serialized);
      return;
    }
    let queue = this.pendingFrames.get(backendId);
    if (!queue) {
      queue = [];
      this.pendingFrames.set(backendId, queue);
    }
    if (queue.length >= MAX_PENDING_FRAMES) queue.shift();
    queue.push(serialized);
    this.request(backendId);
  }

  has(backendId: string): boolean {
    return this.channels.get(backendId)?.ws.readyState === WebSocket.OPEN;
  }

  private pump(): void {
    if (this.openInFlight || this.pendingOpens.length === 0) return;
    this.openInFlight = true;
    const backendId = this.pendingOpens[0];
    this.deps.sendControl({ type: 'channel_open', target: backendId, kind: MESSAGE_CHANNEL_KIND });
    this.openTimer = setTimeout(() => this.settle(), 10_000);
  }

  private settle(): string | undefined {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    const backendId = this.pendingOpens.shift();
    this.openInFlight = false;
    queueMicrotask(() => this.pump());
    return backendId;
  }

  /** Route a channel_ready reply (FIFO match) — dial and flush. */
  handleChannelReady(msg: ChannelReadyMessage): void {
    const backendId = this.settle();
    if (!backendId) return;
    const url = `${this.deps.resolveWsBase()}${msg.dataPath}?ticket=${encodeURIComponent(msg.ticket)}`;
    const wsOptions: { agent?: SocksProxyAgent } = {};
    const proxyAgent = this.deps.createAgent();
    if (proxyAgent) wsOptions.agent = proxyAgent;
    const ws = new WebSocket(url, wsOptions);

    ws.on('open', () => {
      this.channels.set(backendId, { channelId: msg.channelId, ws });
      const queued = this.pendingFrames.get(backendId);
      if (queued) {
        this.pendingFrames.delete(backendId);
        for (const frame of queued) ws.send(frame);
      }
    });
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.deps.onFrame(backendId, frame);
    });
    ws.on('close', () => {
      const current = this.channels.get(backendId);
      if (current?.ws === ws) {
        this.channels.delete(backendId);
        this.deps.onClosed(backendId);
      }
    });
    ws.on('error', error => {
      console.error('[Gateway] Outgoing channel error:', error);
    });
  }

  /** Consume a gateway_error that answers an in-flight open. Returns true if consumed. */
  handleGatewayError(code: string): boolean {
    if (this.openInFlight && (code === 'BACKEND_OFFLINE' || code === 'RATE_LIMITED')) {
      this.settle();
      return true;
    }
    return false;
  }

  /** Gateway-driven teardown (epoch change, backend offline). */
  handleChannelClosed(channelId: string): void {
    for (const [backendId, channel] of this.channels) {
      if (channel.channelId === channelId) {
        this.channels.delete(backendId);
        channel.ws.close(1000);
        this.deps.onClosed(backendId);
        break;
      }
    }
  }

  close(backendId: string): void {
    const channel = this.channels.get(backendId);
    if (channel) {
      this.channels.delete(backendId);
      channel.ws.close(1000);
    }
    this.pendingOpens = this.pendingOpens.filter(id => id !== backendId);
    this.pendingFrames.delete(backendId);
  }

  closeAll(): void {
    for (const channel of this.channels.values()) {
      channel.ws.close(1000);
    }
    this.channels.clear();
    this.pendingOpens = [];
    this.pendingFrames.clear();
    this.openInFlight = false;
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
  }
}

// Message channels for Gateway Protocol v4: a client opens a dedicated
// channel (kind 'zclaudia') to this backend and business messages flow over
// its data socket as JSON text frames — replacing the v3 pattern of
// backend_client_message / backend_server_message multiplexed over the shared
// control connection. One channel = one remote client session; the channelId
// keys the same virtual-client machinery that v3 uses (see manager.ts
// onIncomingMessage), so both paths coexist during migration.
import WebSocket from 'ws';
import type { SocksProxyAgent } from 'socks-proxy-agent';
import type { ChannelOfferMessage } from '@zclaudia/gateway-protocol';

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

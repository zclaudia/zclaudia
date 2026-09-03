// Tests for v4 message channels: a mock gateway data endpoint stands in for
// the channel socket; the unit under test dials it and relays JSON frames.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { GatewayMessageChannels } from '../gateway-channel-messages.js';
import type { ChannelOfferMessage } from '@zclaudia/gateway-protocol';

describe('gateway-channel-messages', () => {
  let wss: WebSocketServer;
  let wsPort: number;

  beforeEach(async () => {
    wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(resolve => wss.once('listening', resolve));
    wsPort = (wss.address() as AddressInfo).port;
  });

  afterEach(() => {
    wss.close();
  });

  function makeOffer(channelId: string): ChannelOfferMessage {
    return { type: 'channel_offer', channelId, kind: 'zclaudia', ticket: 't', dataPath: '/' };
  }

  function setup() {
    const onMessage = vi.fn();
    const onClosed = vi.fn();
    const channels = new GatewayMessageChannels({
      resolveWsBase: () => `ws://127.0.0.1:${wsPort}`,
      createAgent: () => undefined,
      onMessage,
      onClosed,
    });
    return { channels, onMessage, onClosed };
  }

  function nextConnection(): Promise<WebSocket> {
    return new Promise(resolve => wss.once('connection', socket => resolve(socket)));
  }

  const until = async (predicate: () => boolean, timeoutMs = 3000) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error('condition not met');
      await new Promise(r => setTimeout(r, 20));
    }
  };

  test('inbound JSON frames reach onMessage keyed by channelId; binary is ignored', async () => {
    const { channels, onMessage } = setup();
    const connP = nextConnection();
    channels.handleOffer(makeOffer('ch-1'));
    const socket = await connP;

    socket.send(JSON.stringify({ type: 'ping', n: 1 }));
    socket.send(Buffer.from([1, 2, 3]));
    socket.send(JSON.stringify({ type: 'ping', n: 2 }));
    await until(() => onMessage.mock.calls.length >= 2);

    expect(onMessage).toHaveBeenNthCalledWith(1, 'ch-1', { type: 'ping', n: 1 });
    expect(onMessage).toHaveBeenNthCalledWith(2, 'ch-1', { type: 'ping', n: 2 });
  });

  test('send routes to the right channel and returns false for unknown/closed ones', async () => {
    const { channels } = setup();
    const connP = nextConnection();
    channels.handleOffer(makeOffer('ch-a'));
    const socket = await connP;
    await until(() => channels.has('ch-a'));

    const received: unknown[] = [];
    socket.on('message', d => received.push(JSON.parse(d.toString())));

    expect(channels.send('ch-a', { type: 'state', ok: true })).toBe(true);
    await until(() => received.length === 1);
    expect(received[0]).toEqual({ type: 'state', ok: true });

    expect(channels.send('ch-unknown', { type: 'state' })).toBe(false);
  });

  test('channel close fires onClosed and send falls back afterwards', async () => {
    const { channels, onClosed } = setup();
    const connP = nextConnection();
    channels.handleOffer(makeOffer('ch-c'));
    const socket = await connP;
    await until(() => channels.has('ch-c'));

    socket.close(1000);
    await until(() => onClosed.mock.calls.length === 1);
    expect(onClosed).toHaveBeenCalledWith('ch-c');
    expect(channels.send('ch-c', { type: 'state' })).toBe(false);
  });

  test('closeAll closes every channel and each fires onClosed', async () => {
    const { channels, onClosed } = setup();
    const conn1 = nextConnection();
    channels.handleOffer(makeOffer('ch-x'));
    await conn1;
    const conn2 = nextConnection();
    channels.handleOffer(makeOffer('ch-y'));
    await conn2;
    await until(() => channels.has('ch-x') && channels.has('ch-y'));

    channels.closeAll();
    await until(() => onClosed.mock.calls.length === 2);
    const closedIds = onClosed.mock.calls.map(c => c[0]).sort();
    expect(closedIds).toEqual(['ch-x', 'ch-y']);
  });
});

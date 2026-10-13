import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayTransport } from '../GatewayTransport';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((error: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSING;
  });

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  finishClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: 'network', wasClean: false } as CloseEvent);
  }
}

const configFor = (overrides: Record<string, unknown> = {}) => ({
  url: 'ws://gateway.example.com/ws',
  gatewaySecret: 'secret',
  deviceId: 'device',
  instanceId: 'instance',
  onConnected: vi.fn(),
  onDisconnected: vi.fn(),
  onError: vi.fn(),
  onRegistryChanged: vi.fn(),
  onBackendDataSnapshot: vi.fn(),
  onBackendDataEvent: vi.fn(),
  onBackendSubscribed: vi.fn(),
  onBackendUnsubscribed: vi.fn(),
  onBackendServerMessage: vi.fn(),
  onContentPatch: vi.fn(),
  onContentPatchError: vi.fn(),
  ...overrides,
});

const presence = (backendId: string) => ({
  backendId,
  gatewayProtocolVersion: 4,
  epoch: 1,
  capabilities: [],
});
const ready = (ws: MockWebSocket) =>
  ws.receive({
    type: 'peer_ready',
    peerSessionId: 'peer',
    recoveryToken: 'token',
    registrySync: { items: [presence('a'), presence('b')] },
  });
const subscribed = (ws: MockWebSocket, backendId: string) =>
  ws.receive({
    type: 'topic_subscribed',
    backendId,
    topic: 'resources',
  });
const channelReady = (ws: MockWebSocket, backendId: string) =>
  ws.receive({
    type: 'channel_ready',
    channelId: `channel-${backendId}`,
    ticket: `ticket-${backendId}`,
    dataPath: `/channel/${backendId}`,
  });
const frames = (ws: MockWebSocket) => ws.send.mock.calls.map(([raw]) => JSON.parse(raw as string));

let transport: GatewayTransport;
let config: ReturnType<typeof configFor>;

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as any);
  config = configFor();
  transport = new GatewayTransport(config);
  transport.connect();
  ready(MockWebSocket.instances[0]);
});

afterEach(() => {
  transport.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('GatewayTransport recovery', () => {
  it('clears active channels before an asynchronously closing control socket can interfere', () => {
    const oldControl = MockWebSocket.instances[0];
    subscribed(oldControl, 'a');
    channelReady(oldControl, 'a');
    const oldData = MockWebSocket.instances[1];
    oldData.onopen?.();

    transport.forceReconnect();
    oldControl.finishClose();
    const newControl = MockWebSocket.instances[2];
    ready(newControl);
    subscribed(newControl, 'a');

    expect(oldData.close).toHaveBeenCalled();
    expect(
      frames(newControl).some(frame => frame.type === 'channel_open' && frame.target === 'a')
    ).toBe(true);
  });

  it('resets the control generation when an uncorrelated channel open times out', () => {
    const control = MockWebSocket.instances[0];
    subscribed(control, 'a');
    subscribed(control, 'b');
    expect(frames(control).filter(frame => frame.type === 'channel_open')).toHaveLength(1);

    vi.advanceTimersByTime(10_000);
    expect(config.onDisconnected).toHaveBeenCalledTimes(1);
    expect(control.close).toHaveBeenCalledWith(4001, 'channel_open timeout');
    expect(MockWebSocket.instances).toHaveLength(1);

    // A response from the invalidated generation cannot be consumed as B's reply.
    channelReady(control, 'a');
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('recovers a dropped data socket without waiting for a user command or close timeout', () => {
    const control = MockWebSocket.instances[0];
    subscribed(control, 'a');
    channelReady(control, 'a');
    const data = MockWebSocket.instances[1];
    data.onopen?.();

    data.finishClose();

    expect(config.onDisconnected).toHaveBeenCalledTimes(1);
    expect(control.close).toHaveBeenCalledWith(4001, 'data channel closed: a');
    vi.advanceTimersByTime(2_000);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('ignores control messages delivered by a replaced socket', () => {
    const oldControl = MockWebSocket.instances[0];
    transport.forceReconnect();
    config.onBackendDataSnapshot.mockClear();

    oldControl.receive({
      type: 'topic_message',
      backendId: 'a',
      topic: 'resources',
      payload: { type: 'backend_resource_snapshot', resources: [] },
    });

    expect(config.onBackendDataSnapshot).not.toHaveBeenCalled();
  });

  it('bounds a control socket that never finishes connecting and ignores late events', () => {
    transport.disconnect();
    const pendingConfig = configFor();
    const pendingTransport = new GatewayTransport(pendingConfig);
    transport = pendingTransport;
    pendingTransport.connect();
    const control = MockWebSocket.instances.at(-1)!;

    vi.advanceTimersByTime(15_000);

    expect(pendingConfig.onDisconnected).toHaveBeenCalledTimes(1);
    expect((pendingTransport as any).ws).toBeNull();
    control.onopen?.();
    control.receive({
      type: 'peer_ready',
      peerSessionId: 'late-peer',
      recoveryToken: 'late-token',
      registrySync: { items: [] },
    });
    expect(pendingTransport.getPeerSessionId()).toBeNull();
    expect(control.send).not.toHaveBeenCalled();
  });

  it('bounds a control socket that opens without completing peer_ready', () => {
    const control = MockWebSocket.instances[0];
    config.onConnected.mockClear();
    control.onopen?.();

    vi.advanceTimersByTime(10_000);

    expect(config.onDisconnected).toHaveBeenCalledTimes(1);
    expect((transport as any).ws).toBeNull();
    control.receive({
      type: 'peer_ready',
      peerSessionId: 'late-peer',
      recoveryToken: 'late-token',
      registrySync: { items: [] },
    });
    expect(transport.getPeerSessionId()).toBeNull();
    expect(config.onConnected).not.toHaveBeenCalled();
  });

  it('deduplicates and cancels a channel socket that is still dialing', () => {
    const control = MockWebSocket.instances[0];
    subscribed(control, 'a');
    channelReady(control, 'a');
    const data = MockWebSocket.instances[1];
    subscribed(control, 'a');
    expect(frames(control).filter(frame => frame.type === 'channel_open')).toHaveLength(1);

    control.receive({ type: 'topic_unsubscribed', backendId: 'a', topic: 'resources' });

    expect(data.close).toHaveBeenCalled();
    expect((transport as any).dialingChannels.size).toBe(0);
    expect(config.onDisconnected).not.toHaveBeenCalled();
  });

  it('waits for the data channel before reporting readiness and flushes the retained snapshot', () => {
    const control = MockWebSocket.instances[0];
    subscribed(control, 'a');
    control.receive({
      type: 'topic_message',
      backendId: 'a',
      topic: 'resources',
      payload: { type: 'backend_resource_snapshot', resources: [] },
    });
    expect(config.onBackendSubscribed).not.toHaveBeenCalled();
    expect(config.onBackendDataSnapshot).not.toHaveBeenCalled();

    channelReady(control, 'a');
    const data = MockWebSocket.instances[1];
    data.onopen?.();

    expect(config.onBackendSubscribed).toHaveBeenCalledWith('a', 1, []);
    expect(config.onBackendDataSnapshot).toHaveBeenCalledWith('a', [], []);
  });

  it('sends a bootstrap ping as soon as the data channel opens without user traffic', () => {
    const control = MockWebSocket.instances[0];
    subscribed(control, 'a');
    channelReady(control, 'a');
    const data = MockWebSocket.instances[1];
    data.onopen?.();

    expect(frames(data)).toEqual([{ type: 'ping' }]);
    expect(config.onBackendSubscribed).toHaveBeenCalledWith('a', 1, []);
  });

  it('bounds a data socket dial and recovers if the socket never opens', () => {
    const control = MockWebSocket.instances[0];
    subscribed(control, 'a');
    channelReady(control, 'a');

    vi.advanceTimersByTime(10_000);

    expect(config.onDisconnected).toHaveBeenCalledTimes(1);
    expect(control.close).toHaveBeenCalledWith(4001, 'data channel open timeout: a');
    expect(MockWebSocket.instances[1].close).toHaveBeenCalled();
  });
});

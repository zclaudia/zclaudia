import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESOURCES_TOPIC } from '@zclaudia/protocol/transport';
import type { BackendFacadeEvent } from '@zclaudia/shared/facade/types';
import { DirectBackendFacadeProvider } from '../direct-provider';

/** Browser close() is asynchronous. Keep callbacks queued so a resume can
 * replace the control connection before the old sockets report their close. */
class BrowserSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: BrowserSocket[] = [];

  readyState = BrowserSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = BrowserSocket.CLOSING;
  });

  constructor(readonly url: string) {
    BrowserSocket.instances.push(this);
  }
  open(): void {
    this.readyState = BrowserSocket.OPEN;
    this.onopen?.();
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
  finishClose(): void {
    this.readyState = BrowserSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: 'network interrupted', wasClean: false } as CloseEvent);
  }
}

const presence = (backendId: string) => ({
  backendId,
  namespace: 'zclaudia',
  gatewayProtocolVersion: 4,
  instanceId: `instance-${backendId}`,
  deviceId: `device-${backendId}`,
  name: backendId,
  channel: 'prod',
  visible: true,
  capabilities: [],
  backendProtocolVersion: 1,
  minClientProtocolVersion: 1,
  epoch: 1,
  connectedAt: 1,
  lastSeenAt: 1,
});
const sent = (socket: BrowserSocket) => socket.send.mock.calls.map(([raw]) => JSON.parse(raw));
const controlSockets = () => BrowserSocket.instances.filter(socket => socket.url.endsWith('/ws'));
const dataSockets = () => BrowserSocket.instances.filter(socket => socket.url.includes('/data?'));

describe('mobile recovery across transport, adapter and runtime core', () => {
  let provider: DirectBackendFacadeProvider;
  let events: BackendFacadeEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    BrowserSocket.instances = [];
    vi.stubGlobal('WebSocket', BrowserSocket);
    provider = new DirectBackendFacadeProvider({
      url: 'ws://gateway.test',
      gatewaySecret: 'test-secret',
      deviceId: 'mobile-device',
      instanceId: 'mobile-instance',
    });
    events = [];
    provider.onEvent(event => events.push(event));
    provider.connect();
  });

  afterEach(() => {
    provider.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function authenticate(socket: BrowserSocket, backendIds = ['a']): void {
    socket.open();
    socket.receive({
      type: 'peer_ready',
      peerSessionId: `peer-${controlSockets().length}`,
      recoveryToken: 'token',
      registrySync: { items: backendIds.map(presence) },
    });
  }

  function sendResources(socket: BrowserSocket, backendId: string): void {
    socket.receive({ type: 'topic_subscribed', backendId, topic: RESOURCES_TOPIC });
    socket.receive({
      type: 'topic_message',
      backendId,
      topic: RESOURCES_TOPIC,
      payload: { type: 'backend_resource_snapshot', resources: [] },
    });
  }

  function dialChannel(socket: BrowserSocket, backendId: string): BrowserSocket {
    socket.receive({
      type: 'channel_ready',
      channelId: `channel-${backendId}-${controlSockets().length}`,
      ticket: backendId,
      dataPath: '/data',
    });
    return dataSockets().at(-1)!;
  }

  function readyBackend(): { control: BrowserSocket; data: BrowserSocket } {
    const control = controlSockets().at(-1)!;
    authenticate(control);
    provider.openBackend('a');
    sendResources(control, 'a');
    const data = dialChannel(control, 'a');
    data.open();
    expect(provider.getSnapshot().backends[0]?.runtimeState).toBe('ready');
    return { control, data };
  }

  it('does not expose a ready backend before its data socket opens', () => {
    const control = controlSockets()[0];
    authenticate(control);
    provider.openBackend('a');
    sendResources(control, 'a');
    expect(provider.getSnapshot().backends[0]?.runtimeState).not.toBe('ready');
    const data = dialChannel(control, 'a');
    expect(provider.getSnapshot().backends[0]?.runtimeState).not.toBe('ready');
    data.open();
    expect(provider.getSnapshot().backends[0]?.runtimeState).toBe('ready');
  });

  it('recovers an idle desired session after resume despite late old-socket callbacks', () => {
    const first = readyBackend();
    provider.openSessionStream('a', 'idle-session');
    provider.forceReconnect();
    const control = controlSockets().at(-1)!;
    expect(control).not.toBe(first.control);
    expect(first.data.close).toHaveBeenCalled();
    authenticate(control);
    expect(
      sent(control).some(frame => frame.type === 'topic_subscribe' && frame.backendId === 'a')
    ).toBe(true);
    sendResources(control, 'a');
    const data = dialChannel(control, 'a');
    data.open();
    const eventCount = events.length;
    first.control.receive({ type: 'registry_snapshot', items: [] });
    first.control.onerror?.(new Event('error'));
    first.control.finishClose();
    first.data.receive({ type: 'run_started', sessionId: 'stale', runId: 'stale-run' });
    first.data.finishClose();
    expect(events).toHaveLength(eventCount);
    expect(provider.getSnapshot().connectionState).toBe('connected');
    expect(provider.getSnapshot().backends[0]?.runtimeState).toBe('ready');
    const stream = provider.getSnapshot().sessionStreams['a:idle-session'];
    expect(
      stream?.state === 'open' || sent(data).some(frame => frame.type === 'catch_up_content')
    ).toBe(true);
  });

  it('reconnects a lost data pipe without a user action or control close callback', async () => {
    const first = readyBackend();
    first.data.finishClose();
    expect(provider.getSnapshot().connectionState).not.toBe('connected');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controlSockets()).toHaveLength(2);
    const second = controlSockets()[1];
    authenticate(second);
    sendResources(second, 'a');
    dialChannel(second, 'a').open();
    expect(provider.getSnapshot().connectionState).toBe('connected');
    expect(provider.getSnapshot().backends[0]?.runtimeState).toBe('ready');
  });

  it('cannot resurrect a data socket that finishes dialing after resume', () => {
    const control = controlSockets()[0];
    authenticate(control);
    provider.openBackend('a');
    sendResources(control, 'a');
    const obsolete = dialChannel(control, 'a');
    provider.forceReconnect();
    const eventCount = events.length;
    obsolete.open();
    obsolete.receive({ type: 'run_started', runId: 'old', sessionId: 'old' });
    expect(obsolete.close).toHaveBeenCalled();
    expect(events).toHaveLength(eventCount);
    expect(provider.getSnapshot().backends[0]?.runtimeState).not.toBe('ready');
  });

  it('drops a timed-out channel reply instead of assigning it to another backend', async () => {
    const control = controlSockets()[0];
    authenticate(control, ['a', 'b']);
    provider.openBackend('a');
    provider.openBackend('b');
    sendResources(control, 'a');
    sendResources(control, 'b');
    await vi.advanceTimersByTimeAsync(10_001);
    const count = dataSockets().length;
    control.receive({ type: 'channel_ready', channelId: 'late-a', ticket: 'a', dataPath: '/data' });
    expect(dataSockets()).toHaveLength(count);
    expect(provider.getSnapshot().connectionState).not.toBe('connected');
  });

  it('detects a silent data pipe even while the control plane answers pings', async () => {
    const { control } = readyBackend();
    for (let tick = 0; tick < 4; tick++) {
      provider.probeHealth();
      control.receive({ type: 'pong', ts: Date.now() });
      await vi.advanceTimersByTimeAsync(25_000);
    }
    expect(control.close).toHaveBeenCalled();
    expect(provider.getSnapshot().connectionState).not.toBe('connected');
  });
});

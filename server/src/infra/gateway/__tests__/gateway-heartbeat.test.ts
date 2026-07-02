import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayHeartbeat } from '../gateway-heartbeat.js';

describe('GatewayHeartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends heartbeats on interval while sendable', () => {
    const send = vi.fn();
    const hb = new GatewayHeartbeat({
      intervalMs: 1000,
      canSend: () => true,
      currentEpoch: () => 7,
      send,
    });
    hb.start();
    vi.advanceTimersByTime(3000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][0]).toMatchObject({ type: 'backend_heartbeat', epoch: 7 });
    hb.stop();
  });

  it('skips ticks when it cannot send or has no epoch', () => {
    const send = vi.fn();
    let sendable = false;
    let epoch: number | null = null;
    const hb = new GatewayHeartbeat({
      intervalMs: 1000,
      canSend: () => sendable,
      currentEpoch: () => epoch,
      send,
    });
    hb.start();
    vi.advanceTimersByTime(2000); // not sendable → nothing
    expect(send).not.toHaveBeenCalled();
    sendable = true; // sendable but epoch still null → still nothing
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
    epoch = 3;
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
    hb.stop();
  });

  it('stop() halts further heartbeats and start() replaces the prior timer', () => {
    const send = vi.fn();
    const hb = new GatewayHeartbeat({
      intervalMs: 1000,
      canSend: () => true,
      currentEpoch: () => 1,
      send,
    });
    hb.start();
    hb.start(); // should not double-fire
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
    hb.stop();
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

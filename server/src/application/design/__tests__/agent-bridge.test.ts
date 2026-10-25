import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DesignWorkbenchRequest,
  DesignWorkbenchResult,
} from '@zclaudia/shared/wire/messages/design';
import { DesignAgentBridge } from '../agent-bridge.js';

const result: DesignWorkbenchResult = {
  ok: true,
  displayed: false,
  context: {
    activePage: null,
    pages: [],
    dirtyStyles: [],
    viewport: { preset: 'fill', width: null },
  },
};
afterEach(() => vi.useRealTimers());

describe('DesignAgentBridge', () => {
  it('accepts only the matching request, session and originating client, once', async () => {
    const bridge = new DesignAgentBridge();
    const send = vi.fn();
    bridge.configure(() => ({ clientId: 'client-a', send }));
    const pending = bridge.request('session-a', { action: 'get_context' });
    const request = send.mock.calls[0]![0] as DesignWorkbenchRequest;
    const response = {
      type: 'design_workbench_response' as const,
      requestId: request.requestId,
      sessionId: 'session-a',
      result,
    };
    expect(bridge.respond('client-b', response)).toBe(false);
    expect(bridge.respond('client-a', { ...response, sessionId: 'session-b' })).toBe(false);
    expect(bridge.respond('client-a', response)).toBe(true);
    expect(bridge.respond('client-a', response)).toBe(false);
    await expect(pending).resolves.toEqual(result);
  });

  it('returns unavailable when no run client exists', async () => {
    await expect(
      new DesignAgentBridge().request('s', { action: 'get_context' })
    ).resolves.toMatchObject({ ok: false, code: 'UI_UNAVAILABLE' });
  });

  it('times out and rejects a late result, sending a cancellation', async () => {
    vi.useFakeTimers();
    const bridge = new DesignAgentBridge();
    const send = vi.fn();
    bridge.configure(() => ({ clientId: 'c', send }));
    const pending = bridge.request('s', { action: 'present', path: 'design/new.html' }, 100);
    const request = send.mock.calls[0]![0] as DesignWorkbenchRequest;
    await vi.advanceTimersByTimeAsync(101);
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'UI_TIMEOUT' });
    expect(send).toHaveBeenLastCalledWith({
      type: 'design_workbench_cancel',
      requestId: request.requestId,
      sessionId: 's',
    });
    expect(
      bridge.respond('c', {
        type: 'design_workbench_response',
        requestId: request.requestId,
        sessionId: 's',
        result,
      })
    ).toBe(false);
  });

  it('cancels an in-flight UI request when its run is aborted', async () => {
    const bridge = new DesignAgentBridge();
    const controller = new AbortController();
    const send = vi.fn();
    bridge.configure(() => ({ clientId: 'c', send, signal: controller.signal }));
    const pending = bridge.request('s', { action: 'get_context' });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(send.mock.calls[1]![0]).toMatchObject({ type: 'design_workbench_cancel' });
  });

  it('rejects malformed UI observations', async () => {
    const bridge = new DesignAgentBridge();
    const send = vi.fn();
    bridge.configure(() => ({ clientId: 'c', send }));
    const pending = bridge.request('s', { action: 'get_context' });
    bridge.respond('c', {
      type: 'design_workbench_response',
      requestId: send.mock.calls[0]![0].requestId,
      sessionId: 's',
      result: { ok: true } as DesignWorkbenchResult,
    });
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'INVALID_RESPONSE' });
  });
});

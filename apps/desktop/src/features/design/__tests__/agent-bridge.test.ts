import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignWorkbenchRequest } from '@zclaudia/shared/wire/messages/design';
import {
  executeDesignRequest,
  handleDesignMessage,
  registerDesignAgentBinding,
  type DesignAgentBinding,
} from '../agent-bridge';

const host = vi.hoisted(() => ({
  current: { sessionId: 's', backendId: 'b' },
  activate: vi.fn(),
  available: true,
  visibility: vi.fn(),
  send: vi.fn(),
}));
vi.mock('../../../actions/openPanel', () => ({
  currentSessionCtx: () => host.current,
  isPanelAvailable: () => host.available,
  activatePanel: (...args: unknown[]) => host.activate(...args),
}));
vi.mock('../../../actions/controlPlane', () => ({ resolveCanonicalBackendId: (id: string) => id }));
vi.mock('../../../stores/pluginStore', () => ({
  usePluginStore: { getState: () => ({ updatePanelVisibility: host.visibility }) },
}));
const facade = { sendToBackend: host.send };
vi.mock('../../../stores/facadeStore', () => ({
  useFacadeStore: { getState: () => ({ facade }) },
}));

const context = {
  activePage: null,
  pages: [],
  dirtyStyles: [],
  viewport: { preset: 'fill', width: null },
};
const disposers: Array<() => void> = [];
const request = (action: 'get_context' | 'present' = 'present'): DesignWorkbenchRequest => ({
  type: 'design_workbench_request',
  requestId: crypto.randomUUID(),
  sessionId: 's',
  expiresAt: Date.now() + 500,
  action,
  path: 'design/settings.html',
  expectedRevision: 'rev',
});
const bind = (overrides: Partial<DesignAgentBinding> = {}) => {
  const binding = {
    context: () => context,
    visible: () => true,
    present: vi.fn(async () => ({ ok: true as const, displayed: true, context })),
    ...overrides,
  };
  disposers.push(registerDesignAgentBinding('b', 's', binding));
  return binding;
};
beforeEach(() => {
  vi.clearAllMocks();
  host.current = { sessionId: 's', backendId: 'b' };
  host.available = true;
});
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose());
  vi.useRealTimers();
});

describe('Design client routing', () => {
  it('reads the exact visible session without opening a panel', async () => {
    bind();
    await expect(executeDesignRequest('b', request('get_context'))).resolves.toEqual({
      ok: true,
      displayed: false,
      context,
    });
    expect(host.activate).not.toHaveBeenCalled();
  });
  it('reports closed context instead of inventing an empty selection', async () => {
    await expect(executeDesignRequest('b', request('get_context'))).resolves.toMatchObject({
      ok: false,
      code: 'PANEL_CLOSED',
    });
  });
  it('rejects the wrong backend, session and expired requests without opening', async () => {
    bind();
    for (const [backend, input] of [
      ['other', request()],
      ['b', { ...request(), sessionId: 'other' }],
      ['b', { ...request(), expiresAt: 0 }],
    ] as const) {
      expect((await executeDesignRequest(backend, input)).ok).toBe(false);
    }
    expect(host.activate).not.toHaveBeenCalled();
  });
  it('opens the intended panel, waits for mount, then presents', async () => {
    vi.useFakeTimers();
    const pending = executeDesignRequest('b', request());
    const binding = bind();
    await vi.advanceTimersByTimeAsync(51);
    await expect(pending).resolves.toMatchObject({ ok: true, displayed: true });
    expect(host.activate).toHaveBeenCalledWith('design', { sessionId: 's', backendId: 'b' });
    expect(binding.present).toHaveBeenCalledOnce();
  });
  it('does not activate a late-mounted binding after the user changes session', async () => {
    vi.useFakeTimers();
    const pending = executeDesignRequest('b', request());
    const binding = bind();
    host.current = { sessionId: 'other', backendId: 'b' };
    await vi.advanceTimersByTimeAsync(51);
    expect((await pending).ok).toBe(false);
    expect(binding.present).not.toHaveBeenCalled();
  });
  it('deduplicates requests and replies on the original backend', async () => {
    const binding = bind();
    const input = request();
    handleDesignMessage(input, 'b');
    handleDesignMessage(input, 'b');
    await vi.waitFor(() => expect(host.send).toHaveBeenCalledOnce());
    expect(binding.present).toHaveBeenCalledOnce();
    expect(host.send.mock.calls[0]![0]).toBe('b');
    expect(host.send.mock.calls[0]![1]).toMatchObject({
      type: 'design_workbench_response',
      sessionId: 's',
      requestId: input.requestId,
    });
  });
  it('ignores a cancelled request even if delivery arrives later', async () => {
    const binding = bind();
    const input = request();
    handleDesignMessage(
      { type: 'design_workbench_cancel', sessionId: 's', requestId: input.requestId },
      'b'
    );
    await expect(executeDesignRequest('b', input)).resolves.toMatchObject({ ok: false });
    expect(binding.present).not.toHaveBeenCalled();
  });
});

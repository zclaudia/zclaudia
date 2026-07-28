import { describe, expect, it, vi } from 'vitest';

import { ServerState } from '../server-state.js';
import type { ConnectedClient } from '../application/conversation/transport/types.js';

function stubClient(authenticated: boolean): ConnectedClient {
  return {
    id: authenticated ? 'authed' : 'unauthed',
    ws: { readyState: 1, send: vi.fn() } as never,
    isAlive: true,
    isLocal: true,
    authenticated,
  };
}

describe('ServerState browser agent activity', () => {
  it('broadcasts only to authenticated clients', () => {
    const state = new ServerState();
    const authed = stubClient(true);
    const unauthed = stubClient(false);
    state.connectedClients.set(authed.id, authed);
    state.connectedClients.set(unauthed.id, unauthed);

    state.broadcastBrowserAgentActivity('s1', true);

    expect(authed.ws.send).toHaveBeenCalledTimes(1);
    expect(unauthed.ws.send).not.toHaveBeenCalled();
    const [sent] = (authed.ws.send as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(sent)).toEqual({
      type: 'browser_agent_activity',
      sessionId: 's1',
      active: true,
    });
  });

  it('is not cached (transient, unlike engine status)', () => {
    const state = new ServerState();
    expect(state.lastBrowserEngineStatus).toBeUndefined();

    state.broadcastBrowserAgentActivity('s1', true);
    state.broadcastBrowserAgentActivity('s1', false);

    // No lastBrowserAgentActivity-style field exists on ServerState.
    expect((state as unknown as Record<string, unknown>).lastBrowserAgentActivity).toBeUndefined();
    expect(state.lastBrowserEngineStatus).toBeUndefined();
  });
});

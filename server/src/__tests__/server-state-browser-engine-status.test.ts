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

describe('ServerState browser engine status', () => {
  it('broadcasts only to authenticated clients (status carries a server executablePath)', () => {
    const state = new ServerState();
    const authed = stubClient(true);
    const unauthed = stubClient(false);
    state.connectedClients.set(authed.id, authed);
    state.connectedClients.set(unauthed.id, unauthed);

    state.broadcastBrowserEngineStatus({ type: 'browser_engine_status', status: 'ready' });

    expect(authed.ws.send).toHaveBeenCalledTimes(1);
    expect(unauthed.ws.send).not.toHaveBeenCalled();
  });

  it('caches the last-broadcast status so a late-authenticating client can be replayed it', () => {
    const state = new ServerState();
    expect(state.lastBrowserEngineStatus).toBeUndefined();

    state.broadcastBrowserEngineStatus({ type: 'browser_engine_status', status: 'downloading', progress: 0.5 });
    expect(state.lastBrowserEngineStatus).toEqual({
      type: 'browser_engine_status',
      status: 'downloading',
      progress: 0.5,
    });

    state.broadcastBrowserEngineStatus({ type: 'browser_engine_status', status: 'ready', executablePath: '/x/chrome' });
    expect(state.lastBrowserEngineStatus).toEqual({
      type: 'browser_engine_status',
      status: 'ready',
      executablePath: '/x/chrome',
    });
  });
});

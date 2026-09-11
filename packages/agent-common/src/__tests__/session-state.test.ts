import { describe, expect, it } from 'vitest';
import { AdapterSessionState } from '../session-state.js';

describe('AdapterSessionState', () => {
  it('tracks provider run state and modes under the host session', () => {
    const state = new AdapterSessionState({ trackModes: true });
    const context = { cwd: '/project', claudiaSessionId: 'host-1', mode: 'default' };
    const session = state.begin(context);

    state.registerProviderSession(session, 'provider-1');
    state.observe(session, {
      type: 'mode_transition',
      modeTransition: { mode: 'plan', reason: 'enter' },
    });

    expect(state.getRunState(context)).toEqual({
      providerSessionId: 'provider-1',
      providerCwd: '/project',
    });
    expect(state.effectiveMode(context)).toBe('plan');
  });

  it('aborts through a provider alias and clears the host mode while active', () => {
    const state = new AdapterSessionState({ trackModes: true });
    const controller = new AbortController();
    const context = {
      cwd: '/project',
      claudiaSessionId: 'host-1',
      mode: 'default',
      abortController: controller,
    };
    const session = state.begin(context);
    state.registerProviderSession(session, 'provider-1');
    state.setSessionMode('host-1', 'plan');

    state.abort('provider-1');

    expect(controller.signal.aborted).toBe(true);
    expect(state.effectiveMode(context)).toBe('default');
  });

  it('removes provider aliases after completion without clearing persisted host mode', () => {
    const state = new AdapterSessionState({ trackModes: true });
    const context = { cwd: '/project', claudiaSessionId: 'host-1', mode: 'default' };
    const session = state.begin(context);
    state.registerProviderSession(session, 'provider-1');
    state.setSessionMode('host-1', 'plan');
    state.finish(session);

    state.abort('provider-1');

    expect(state.effectiveMode(context)).toBe('plan');
  });

  it('allows abort by either host or provider id during a run', () => {
    const state = new AdapterSessionState();
    const hostController = new AbortController();
    const hostSession = state.begin({
      cwd: '/project',
      claudiaSessionId: 'host-1',
      abortController: hostController,
    });
    state.registerProviderSession(hostSession, 'provider-1');
    state.abort('host-1');
    expect(hostController.signal.aborted).toBe(true);

    const providerController = new AbortController();
    const providerSession = state.begin({
      cwd: '/project',
      claudiaSessionId: 'host-2',
      abortController: providerController,
    });
    state.registerProviderSession(providerSession, 'provider-2');
    state.abort('provider-2');
    expect(providerController.signal.aborted).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetInflightForegroundCommandsForTests,
  listInflightForegroundCommands,
  registerInflightForegroundCommand,
  requestBackgroundForCommand,
} from '../inflight-bash-registry.js';

function entry(sessionId: string, toolUseId: string, startedAt = Date.now()) {
  return {
    sessionId,
    toolUseId,
    command: `cmd-${toolUseId}`,
    startedAt,
    requestBackground: () => {},
  };
}

afterEach(() => {
  __resetInflightForegroundCommandsForTests();
  vi.useRealTimers();
});

describe('inflight-bash-registry', () => {
  it('lists and unregisters live entries', () => {
    const unregister = registerInflightForegroundCommand(entry('s1', 't1'));
    registerInflightForegroundCommand(entry('s1', 't2'));

    expect(listInflightForegroundCommands('s1').map(e => e.toolUseId)).toEqual(['t1', 't2']);
    unregister();
    expect(listInflightForegroundCommands('s1').map(e => e.toolUseId)).toEqual(['t2']);
  });

  it('sweeps entries older than 2x the 600s command timeout on access', () => {
    // A run that never settles never runs its unregister finally — the entry
    // would leak forever without the age-based sweep.
    registerInflightForegroundCommand(entry('s1', 'stale', Date.now() - 2 * 600_000 - 1));
    registerInflightForegroundCommand(entry('s1', 'fresh'));

    expect(listInflightForegroundCommands('s1').map(e => e.toolUseId)).toEqual(['fresh']);
  });

  it('keeps entries just inside the stale horizon', () => {
    registerInflightForegroundCommand(entry('s1', 'recent', Date.now() - 2 * 600_000 + 60_000));
    expect(listInflightForegroundCommands('s1')).toHaveLength(1);
  });

  it('a swept stale entry no longer answers background requests', () => {
    const stale = entry('s1', 'stale', Date.now() - 2 * 600_000 - 1);
    const spy = vi.spyOn(stale, 'requestBackground');
    registerInflightForegroundCommand(stale);

    const result = requestBackgroundForCommand('s1', 'stale');
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('routes a background request to the oldest live entry', () => {
    const older = entry('s1', 'older', Date.now() - 1000);
    const newer = entry('s1', 'newer');
    const olderSpy = vi.spyOn(older, 'requestBackground');
    const newerSpy = vi.spyOn(newer, 'requestBackground');
    registerInflightForegroundCommand(older);
    registerInflightForegroundCommand(newer);

    const result = requestBackgroundForCommand('s1');
    expect(result).toEqual({ ok: true, command: 'cmd-older' });
    expect(olderSpy).toHaveBeenCalledOnce();
    expect(newerSpy).not.toHaveBeenCalled();
  });
});

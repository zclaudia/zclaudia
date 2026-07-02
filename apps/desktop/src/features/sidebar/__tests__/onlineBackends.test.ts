import { describe, it, expect } from 'vitest';
import { selectOnlineBackends } from '../onlineBackends';

function b(
  over: Partial<{ backendId: string; name: string; online: boolean; isThisInstance: boolean }>
) {
  return {
    backendId: over.backendId ?? 'x',
    name: over.name ?? 'X',
    online: over.online ?? true,
    isThisInstance: over.isThisInstance ?? false,
    runtimeState: 'ready',
    openState: 'open',
    instanceId: 'i',
    deviceId: 'd',
    channel: 'prod',
    isThisDevice: true,
    capabilities: [],
  } as any;
}

describe('selectOnlineBackends', () => {
  it('returns only online backends', () => {
    const result = selectOnlineBackends(
      [b({ backendId: 'a', online: true }), b({ backendId: 'b', online: false })],
      null
    );
    expect(result.map(x => x.backendId)).toEqual(['a']);
  });

  it('sorts the local backend first, then others by name', () => {
    const result = selectOnlineBackends(
      [
        b({ backendId: 'remote-z', name: 'Zeta' }),
        b({ backendId: 'local', name: 'Local Server' }),
        b({ backendId: 'remote-a', name: 'Alpha' }),
      ],
      'local'
    );
    expect(result.map(x => x.backendId)).toEqual(['local', 'remote-a', 'remote-z']);
  });

  it('falls back to isThisInstance for local-first ordering when localBackendId is null', () => {
    const result = selectOnlineBackends(
      [
        b({ backendId: 'remote', name: 'Alpha' }),
        b({ backendId: 'me', name: 'Zeta', isThisInstance: true }),
      ],
      null
    );
    expect(result[0].backendId).toBe('me');
  });

  it('is a pure function (does not mutate the input array order)', () => {
    const input = [b({ backendId: 'b', name: 'B' }), b({ backendId: 'a', name: 'A' })];
    const snapshot = input.map(x => x.backendId);
    selectOnlineBackends(input, null);
    expect(input.map(x => x.backendId)).toEqual(snapshot);
  });
});

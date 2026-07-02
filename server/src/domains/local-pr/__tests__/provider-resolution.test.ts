import { describe, expect, it } from 'vitest';
import { resolveAvailableProviderId } from '../provider-resolution.js';

type Profile = { id: string };

function makeRepo(profiles: Profile[], defaultId?: string) {
  return {
    findById: (id: string) => profiles.find(p => p.id === id) ?? null,
    findDefault: () => (defaultId ? (profiles.find(p => p.id === defaultId) ?? null) : null),
    findAll: () => profiles,
  };
}

describe('resolveAvailableProviderId', () => {
  const repo = makeRepo([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b');

  it('returns the first preferred id that exists', () => {
    expect(resolveAvailableProviderId(repo, ['missing', 'c', 'a'])).toBe('c');
  });

  it('skips undefined and duplicate preferred ids', () => {
    expect(resolveAvailableProviderId(repo, [undefined, 'a', 'a'])).toBe('a');
  });

  it('falls back to the default profile when no preferred id matches', () => {
    expect(resolveAvailableProviderId(repo, ['nope'])).toBe('b');
  });

  it('falls back to the first profile when there is no default', () => {
    const noDefault = makeRepo([{ id: 'x' }, { id: 'y' }]);
    expect(resolveAvailableProviderId(noDefault, ['nope'])).toBe('x');
  });

  it('returns null when there are no profiles at all', () => {
    expect(resolveAvailableProviderId(makeRepo([]), ['nope'])).toBeNull();
  });
});

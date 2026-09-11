import { describe, expect, it } from 'vitest';
import { resolveExecutableFromPath } from '../executable.js';

function existsFor(paths: string[]): (candidate: string) => boolean {
  const existing = new Set(paths);
  return candidate => existing.has(candidate);
}

describe('resolveExecutableFromPath', () => {
  it('honors POSIX PATH order and skips blank entries', () => {
    expect(
      resolveExecutableFromPath('agent', ':/first:/second', {
        platform: 'linux',
        exists: existsFor(['/first/agent', '/second/agent']),
      })
    ).toBe('/first/agent');
  });

  it('prefers Windows executable extensions in shell order', () => {
    expect(
      resolveExecutableFromPath('agent', 'C:\\bin', {
        platform: 'win32',
        exists: existsFor(['C:\\bin\\agent.cmd', 'C:\\bin\\agent.exe']),
      })
    ).toBe('C:\\bin\\agent.exe');
  });

  it('returns undefined for an empty or missing PATH', () => {
    expect(resolveExecutableFromPath('agent', undefined)).toBeUndefined();
    expect(resolveExecutableFromPath('agent', '')).toBeUndefined();
  });
});

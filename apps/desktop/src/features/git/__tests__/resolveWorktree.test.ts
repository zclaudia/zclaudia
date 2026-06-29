import { describe, it, expect } from 'vitest';
import { resolveEffectiveWorktree } from '../resolveWorktree';

describe('resolveEffectiveWorktree', () => {
  it('prefers the manual override', () => {
    expect(resolveEffectiveWorktree('/override', '/wd', '/root')).toBe('/override');
  });

  it('falls back to the session working directory', () => {
    expect(resolveEffectiveWorktree(null, '/wd', '/root')).toBe('/wd');
  });

  it('falls back to the project root', () => {
    expect(resolveEffectiveWorktree(null, undefined, '/root')).toBe('/root');
  });

  it('returns null when nothing is available', () => {
    expect(resolveEffectiveWorktree(null, undefined, undefined)).toBeNull();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionOverridesStore } from '../sessionOverridesStore';

const reset = () =>
  useSessionOverridesStore.setState({ permissionOverrides: {}, worktreeOverrides: {} });

describe('sessionOverridesStore', () => {
  beforeEach(reset);

  it('sets and reads a permission override', () => {
    useSessionOverridesStore.getState().setPermissionOverride('s1', { mode: 'plan' } as never);
    expect(useSessionOverridesStore.getState().getPermissionOverride('s1')).toEqual({
      mode: 'plan',
    });
  });

  it('clears a permission override when passed null', () => {
    useSessionOverridesStore.getState().setPermissionOverride('s1', { mode: 'plan' } as never);
    useSessionOverridesStore.getState().setPermissionOverride('s1', null);
    expect(useSessionOverridesStore.getState().getPermissionOverride('s1')).toBeNull();
  });

  it('sets, reads, and clears a worktree override', () => {
    useSessionOverridesStore.getState().setWorktreeOverride('s1', '/wt');
    expect(useSessionOverridesStore.getState().getWorktreeOverride('s1')).toBe('/wt');
    useSessionOverridesStore.getState().clearWorktreeOverride('s1');
    expect(useSessionOverridesStore.getState().getWorktreeOverride('s1')).toBe('');
  });
});

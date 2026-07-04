import { describe, it, expect, beforeEach } from 'vitest';
import { useHomeQuickActionsStore } from '../homeQuickActionsStore';

describe('homeQuickActionsStore', () => {
  beforeEach(() => {
    useHomeQuickActionsStore.setState({ pending: null });
  });

  it('stores a requested action', () => {
    useHomeQuickActionsStore.getState().request('new-session');
    expect(useHomeQuickActionsStore.getState().pending).toBe('new-session');
  });

  it('consume returns the pending action once and clears it', () => {
    useHomeQuickActionsStore.getState().request('new-project');
    expect(useHomeQuickActionsStore.getState().consume()).toBe('new-project');
    expect(useHomeQuickActionsStore.getState().pending).toBeNull();
    expect(useHomeQuickActionsStore.getState().consume()).toBeNull();
  });
});

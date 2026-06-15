import { describe, it, expect, beforeEach } from 'vitest';
import { useSidebarExpansionStore } from '../sidebarExpansionStore';

describe('sidebarExpansionStore', () => {
  beforeEach(() => {
    useSidebarExpansionStore.setState({ expandedBackendIds: [] });
  });

  it('toggleBackend adds then removes an id', () => {
    const { toggleBackend } = useSidebarExpansionStore.getState();
    toggleBackend('b1');
    expect(useSidebarExpansionStore.getState().expandedBackendIds).toEqual(['b1']);
    toggleBackend('b1');
    expect(useSidebarExpansionStore.getState().expandedBackendIds).toEqual([]);
  });

  it('isBackendExpanded reflects membership', () => {
    useSidebarExpansionStore.getState().toggleBackend('b1');
    expect(useSidebarExpansionStore.getState().isBackendExpanded('b1')).toBe(true);
    expect(useSidebarExpansionStore.getState().isBackendExpanded('b2')).toBe(false);
  });

  it('expandBackend is idempotent (no duplicates)', () => {
    const { expandBackend } = useSidebarExpansionStore.getState();
    expandBackend('b1');
    expandBackend('b1');
    expect(useSidebarExpansionStore.getState().expandedBackendIds).toEqual(['b1']);
  });
});

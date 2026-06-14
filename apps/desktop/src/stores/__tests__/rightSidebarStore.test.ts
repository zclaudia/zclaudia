import { describe, it, expect, beforeEach } from 'vitest';
import { useRightSidebarStore } from '../rightSidebarStore';

describe('rightSidebarStore — collapse & unread', () => {
  beforeEach(() => {
    useRightSidebarStore.setState({ collapsed: false, unread: false });
  });

  it('toggleCollapsed flips collapsed state', () => {
    const { toggleCollapsed } = useRightSidebarStore.getState();
    toggleCollapsed();
    expect(useRightSidebarStore.getState().collapsed).toBe(true);
    toggleCollapsed();
    expect(useRightSidebarStore.getState().collapsed).toBe(false);
  });

  it('markUnread only takes effect while collapsed', () => {
    const { markUnread } = useRightSidebarStore.getState();
    markUnread();
    expect(useRightSidebarStore.getState().unread).toBe(false);

    useRightSidebarStore.setState({ collapsed: true });
    markUnread();
    expect(useRightSidebarStore.getState().unread).toBe(true);
  });

  it('expanding clears the unread marker', () => {
    useRightSidebarStore.setState({ collapsed: true, unread: true });
    useRightSidebarStore.getState().setCollapsed(false);
    expect(useRightSidebarStore.getState().unread).toBe(false);
  });

  it('collapsing preserves any existing unread marker', () => {
    useRightSidebarStore.setState({ collapsed: false, unread: true });
    useRightSidebarStore.getState().setCollapsed(true);
    expect(useRightSidebarStore.getState().unread).toBe(true);
  });
});

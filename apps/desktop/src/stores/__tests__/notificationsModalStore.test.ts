import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationsModalStore } from '../notificationsModalStore';

describe('notificationsModalStore', () => {
  beforeEach(() => {
    useNotificationsModalStore.setState({ isOpen: false });
  });

  it('starts closed', () => {
    expect(useNotificationsModalStore.getState().isOpen).toBe(false);
  });

  it('open() sets isOpen true', () => {
    useNotificationsModalStore.getState().open();
    expect(useNotificationsModalStore.getState().isOpen).toBe(true);
  });

  it('close() sets isOpen false', () => {
    useNotificationsModalStore.setState({ isOpen: true });
    useNotificationsModalStore.getState().close();
    expect(useNotificationsModalStore.getState().isOpen).toBe(false);
  });

  it('toggle() flips isOpen', () => {
    const { toggle } = useNotificationsModalStore.getState();
    toggle();
    expect(useNotificationsModalStore.getState().isOpen).toBe(true);
    toggle();
    expect(useNotificationsModalStore.getState().isOpen).toBe(false);
  });
});

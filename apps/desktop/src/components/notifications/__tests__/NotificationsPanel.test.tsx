import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationsPanel } from '../NotificationsPanel';
import { useNotificationFeedStore } from '../../../stores/notificationFeedStore';

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ sendMessage: vi.fn() }),
}));

describe('NotificationsPanel — close button', () => {
  beforeEach(() => {
    // Mark hydrated so the panel does not try to fetch on mount.
    useNotificationFeedStore.setState({
      items: [],
      unreadCount: 0,
      hasMore: false,
      loading: false,
      hydrated: true,
    } as any);
  });

  it('shows a close button only when onClose is provided', () => {
    const { rerender } = render(<NotificationsPanel />);
    expect(screen.queryByLabelText('Close notifications')).toBeNull();

    rerender(<NotificationsPanel onClose={() => {}} />);
    expect(screen.getByLabelText('Close notifications')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<NotificationsPanel onClose={onClose} />);
    screen.getByLabelText('Close notifications').click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

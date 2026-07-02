import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationsModal } from '../NotificationsModal';

vi.mock('../../../components/notifications/NotificationsPanel', () => ({
  NotificationsPanel: ({ onClose }: { onClose?: () => void }) => (
    <button data-testid="panel" onClick={onClose}>
      panel
    </button>
  ),
}));

describe('NotificationsModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<NotificationsModal open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('panel')).toBeNull();
  });

  it('renders the panel when open', () => {
    render(<NotificationsModal open onClose={() => {}} />);
    expect(screen.getByTestId('panel')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<NotificationsModal open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Notifications' }).parentElement!, {
      key: 'Escape',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on backdrop click', () => {
    const onClose = vi.fn();
    render(<NotificationsModal open onClose={onClose} />);
    fireEvent.click(screen.getByTestId('notifications-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the dialog when opened (so Escape works)', () => {
    render(<NotificationsModal open onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toHaveFocus();
  });
});

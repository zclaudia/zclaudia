import { Modal } from '../../components/ui/Modal';
import { NotificationsPanel } from '../../components/notifications/NotificationsPanel';

interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Centered command-palette style Notifications popup (desktop), on the shared
 * Modal shell (portal + dimmed backdrop + Esc / backdrop close).
 */
export function NotificationsModal({ open, onClose }: NotificationsModalProps) {
  return (
    <Modal open={open} onClose={onClose} ariaLabel="Notifications" size="md">
      <NotificationsPanel onClose={onClose} />
    </Modal>
  );
}

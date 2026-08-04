import { Modal } from '../../components/ui/Modal';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { NotificationsPanel } from '../../components/notifications/NotificationsPanel';

interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Centered command-palette style Notifications popup (desktop), on the shared
 * Modal shell (portal + dimmed backdrop + Esc / backdrop close).
 * Expands to a full-screen sheet on mobile.
 */
export function NotificationsModal({ open, onClose }: NotificationsModalProps) {
  const isMobile = useIsMobile();
  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Notifications"
      size="md"
      mobileFullscreen
      isMobile={isMobile}
    >
      <NotificationsPanel onClose={onClose} />
    </Modal>
  );
}

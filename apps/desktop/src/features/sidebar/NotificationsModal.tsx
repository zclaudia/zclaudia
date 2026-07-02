import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NotificationsPanel } from '../../components/notifications/NotificationsPanel';

interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Centered command-palette style Notifications popup (desktop). Mirrors
 * SearchModal: portal + dimmed backdrop + centered card, Esc / backdrop / ×
 * close. Independent of the notch panel — both read the same feed store.
 */
export function NotificationsModal({ open, onClose }: NotificationsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  // Focus the dialog on open so the container's onKeyDown (Escape) actually
  // receives key events — nothing inside is auto-focused otherwise.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[apple-fade-in_120ms_ease-out]"
        onClick={onClose}
        aria-hidden
        data-testid="notifications-backdrop"
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-apple-xl outline-none animate-[apple-fade-in_150ms_ease-out]"
      >
        <div className="flex max-h-[70vh] flex-col">
          <NotificationsPanel onClose={onClose} />
        </div>
      </div>
    </div>,
    document.body
  );
}

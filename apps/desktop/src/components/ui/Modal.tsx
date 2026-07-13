import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useAndroidBack } from '../../hooks/useAndroidBack';

type ModalSize = 'md' | 'lg' | '2xl';
type ModalPlacement = 'top' | 'center';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  ariaLabel: string;
  children: ReactNode;
  /** Optional header text; when set, a header row with a close (×) button renders. */
  title?: string;
  /** Optional pinned action row at the bottom of the card. */
  footer?: ReactNode;
  /** Whether the content area scrolls when it exceeds the modal height. */
  bodyScrollable?: boolean;
  /** Optional maximum-height utility for compact, non-scrolling dialogs. */
  maxHeightClassName?: string;
  size?: ModalSize;
  placement?: ModalPlacement;
  /** On mobile, expand the card to a full-screen sheet (inset-0, no radius). */
  mobileFullscreen?: boolean;
  isMobile?: boolean;
  /** Stacking context; override for nested dialogs. Defaults to z-[100]. */
  zClassName?: string;
}

const SIZE_CLASS: Record<ModalSize, string> = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  '2xl': 'max-w-2xl',
};

/**
 * Shared modal shell: portal to body, dimmed blurred backdrop, focus-on-open,
 * Esc / backdrop / × dismissal. Consumers supply the body (and optional
 * title/footer); placement/size/mobileFullscreen tune layout.
 */
export function Modal({
  open,
  onClose,
  ariaLabel,
  children,
  title,
  footer,
  bodyScrollable = true,
  maxHeightClassName = 'max-h-[80vh]',
  size = 'md',
  placement = 'top',
  mobileFullscreen = false,
  isMobile = false,
  zClassName = 'z-[100]',
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useAndroidBack(onClose, isMobile && open, 30);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const fullscreen = mobileFullscreen && isMobile;
  const wrapperAlign = placement === 'center' ? 'items-center pt-0' : 'items-start pt-[12vh]';
  const cardLayout = fullscreen
    ? 'inset-0 rounded-none safe-top-pad safe-bottom-pad'
    : `relative w-full ${SIZE_CLASS[size]} ${maxHeightClassName} rounded-2xl border border-border`;

  return createPortal(
    <div
      className={`fixed inset-0 ${zClassName} flex justify-center px-4 ${fullscreen ? 'items-stretch px-0' : wrapperAlign}`}
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[apple-fade-in_120ms_ease-out]"
        onClick={onClose}
        aria-hidden
        data-testid="modal-backdrop"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`${fullscreen ? 'fixed' : ''} ${cardLayout} flex flex-col overflow-hidden bg-card shadow-apple-xl outline-none animate-[apple-fade-in_150ms_ease-out]`}
      >
        {title && (
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="truncate text-[13px] font-semibold text-foreground">{title}</span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        )}
        <div
          data-testid="modal-body"
          className={`min-h-0 flex-1 ${bodyScrollable ? 'overflow-y-auto' : ''}`}
        >
          {children}
        </div>
        {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

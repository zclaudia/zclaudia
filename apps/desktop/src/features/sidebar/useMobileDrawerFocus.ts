import { useCallback, useEffect, useRef, type RefObject } from 'react';

interface UseMobileDrawerFocusOptions {
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  /** External ref for the drawer panel (App-owned); an internal one is used otherwise. */
  drawerPanelRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Focus management for the mobile navigation drawer, which is a modal dialog:
 * moves focus into the panel on open so keyboard and screen-reader users land
 * inside instead of on whatever was focused behind the (still-mounted) app,
 * traps Tab/Shift+Tab within the panel, and closes on Escape.
 */
export function useMobileDrawerFocus({
  isMobile,
  isOpen,
  onClose,
  drawerPanelRef,
}: UseMobileDrawerFocusOptions) {
  const internalDrawerPanelRef = useRef<HTMLDivElement>(null);
  const mobileDrawerPanelRef = drawerPanelRef ?? internalDrawerPanelRef;

  useEffect(() => {
    if (isMobile && isOpen) {
      mobileDrawerPanelRef.current?.focus();
    }
  }, [isMobile, isOpen, mobileDrawerPanelRef]);

  // Escape closes the drawer; Tab/Shift+Tab is trapped within the panel so
  // keyboard focus can't leak out to the visually-hidden app behind the scrim.
  const handleDrawerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = mobileDrawerPanelRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose, mobileDrawerPanelRef]
  );

  return { panelRef: mobileDrawerPanelRef, handleDrawerKeyDown };
}

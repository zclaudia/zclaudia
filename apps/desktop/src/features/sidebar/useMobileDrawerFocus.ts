import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { trapTab } from '../../utils/focusTrap';
import { useMobileNavigationBlocker } from '../../app/useMobileNavigationBlocker';

interface UseMobileDrawerFocusOptions {
  isMobile?: boolean;
  /** Modal lifetime, including the full closing animation. */
  isOpen?: boolean;
  paused?: boolean;
  onClose?: () => void;
  drawerPanelRef?: RefObject<HTMLDivElement | null>;
}

export function useMobileDrawerFocus({ isMobile, isOpen, paused = false, onClose, drawerPanelRef }: UseMobileDrawerFocusOptions) {
  const internalRef = useRef<HTMLDivElement>(null);
  const panelRef = drawerPanelRef ?? internalRef;
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  const modalBlocked = useMobileNavigationBlocker();
  const suspend = paused || modalBlocked;
  const suspendedRef = useRef(suspend);
  useLayoutEffect(() => { suspendedRef.current = suspend; }, [suspend]);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isMobile || !isOpen) return;
    const panel = panelRef.current;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!suspendedRef.current) panel?.focus();
    const backgrounds = [...document.querySelectorAll<HTMLElement>('[data-mobile-drawer-background]')];
    const originals = backgrounds.map(element => ({ element, inert: element.inert }));
    backgrounds.forEach(element => { element.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      originals.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = overflow;
      // A destination may have replaced the menu's trigger while closing.
      if (suspendedRef.current) return;
      const original = restoreRef.current;
      if (original?.isConnected && !original.closest('[inert]')) original.focus();
      else document.querySelector<HTMLElement>('main[data-mobile-drawer-background]')?.focus();
    };
  }, [isMobile, isOpen, panelRef]);

  // Return from an upper dialog without resetting the drawer's restore target.
  const wasSuspendedRef = useRef(suspend);
  useEffect(() => {
    if (isMobile && isOpen && wasSuspendedRef.current && !suspend &&
      !panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    wasSuspendedRef.current = suspend;
  }, [suspend, isMobile, isOpen, panelRef]);

  const handleDrawerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (suspendedRef.current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current?.();
      return;
    }
    trapTab(event, panelRef.current);
  }, [panelRef]);
  return { panelRef, handleDrawerKeyDown };
}

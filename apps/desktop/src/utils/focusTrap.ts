import type { KeyboardEvent } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible, tabbable elements inside `container`, in DOM order. */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => el.getClientRects().length > 0
  );
}

/**
 * Keep Tab focus cycling within `container` so it can't escape a modal dialog
 * into the inert background (WCAG 2.1.2 / 2.4.3). Call from the dialog's
 * `onKeyDown` after handling Esc; no-ops for non-Tab keys.
 */
export function trapTab(e: KeyboardEvent, container: HTMLElement | null): void {
  if (e.key !== 'Tab' || !container) return;
  const focusable = getFocusable(container);
  if (focusable.length === 0) {
    // Nothing to tab to — pin focus on the dialog shell.
    e.preventDefault();
    container.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    // Wrap backward off the first element (or from outside the dialog).
    if (active === first || active === container || !container.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    e.preventDefault();
    first.focus();
  }
}

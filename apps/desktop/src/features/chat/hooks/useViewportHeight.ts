import { useCallback, useEffect, useState } from 'react';

/**
 * Tracks the height actually available to the composer: the visual viewport
 * height when present (what remains above the mobile soft keyboard), falling
 * back to `window.innerHeight`. Re-syncs on window resize and on visual
 * viewport resize/scroll (keyboard open/close).
 */
export function useViewportHeight() {
  const getAvailableViewportHeight = useCallback(() => {
    if (typeof window === 'undefined') return 800;
    return window.visualViewport?.height ?? window.innerHeight;
  }, []);

  const [availableViewportHeight, setAvailableViewportHeight] = useState(
    getAvailableViewportHeight
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateViewportHeight = () => {
      setAvailableViewportHeight(getAvailableViewportHeight());
    };

    const viewport = window.visualViewport;
    updateViewportHeight();

    window.addEventListener('resize', updateViewportHeight);
    viewport?.addEventListener('resize', updateViewportHeight);
    viewport?.addEventListener('scroll', updateViewportHeight);

    return () => {
      window.removeEventListener('resize', updateViewportHeight);
      viewport?.removeEventListener('resize', updateViewportHeight);
      viewport?.removeEventListener('scroll', updateViewportHeight);
    };
  }, [getAvailableViewportHeight]);

  return availableViewportHeight;
}

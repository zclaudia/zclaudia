import { useCallback, useEffect, useRef, useState } from 'react';

const COMPOSITION_END_DELAY_MS = 50;

/**
 * Tracks IME composition state for the composer textarea.
 *
 * `compositionend` can fire before the final `keydown` on some IMEs, so the
 * "composing" flag is lowered on a short delay instead of immediately — that
 * keeps Enter-to-send from firing while the candidate window still owns the
 * key events. The timeout is cancelled by a new `compositionstart` and on
 * unmount.
 */
export function useImeComposition() {
  const [isComposing, setIsComposing] = useState(false); // Track IME composition state
  const compositionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup composition timeout on unmount
  useEffect(() => {
    return () => {
      if (compositionTimeoutRef.current) {
        clearTimeout(compositionTimeoutRef.current);
      }
    };
  }, []);

  const handleCompositionStart = useCallback(() => {
    if (compositionTimeoutRef.current) {
      clearTimeout(compositionTimeoutRef.current);
      compositionTimeoutRef.current = null;
    }
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    compositionTimeoutRef.current = setTimeout(() => {
      setIsComposing(false);
      compositionTimeoutRef.current = null;
    }, COMPOSITION_END_DELAY_MS);
  }, []);

  return { isComposing, handleCompositionStart, handleCompositionEnd };
}

import { useEffect, useRef, useState } from 'react';

/**
 * Coalesces rapid value changes to at most one state commit per animation
 * frame. The pending handle is always cleared both after execution and after
 * cancellation, which keeps the scheduling invariant safe under StrictMode
 * effect replay.
 */
export function useAnimationFrameThrottle<T>(value: T): T {
  const [throttled, setThrottled] = useState(value);
  const latestRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    latestRef.current = value;
  }, [value]);

  useEffect(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setThrottled(latestRef.current);
    });
  }, [value]);

  useEffect(
    () => () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    },
    []
  );

  return throttled;
}

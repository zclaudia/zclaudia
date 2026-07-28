import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a stable predicate that reports whether the current component
 * lifetime is mounted.
 *
 * The setup deliberately re-arms the ref. React StrictMode replays mount
 * effects as setup -> cleanup -> setup while preserving refs, so a cleanup-only
 * `mountedRef.current = false` guard would otherwise remain false forever.
 */
export function useIsMounted(): () => boolean {
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return useCallback(() => isMountedRef.current, []);
}

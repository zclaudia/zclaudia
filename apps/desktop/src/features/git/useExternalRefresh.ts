import { useEffect, useRef } from 'react';

/**
 * Re-run a view's own `refresh` whenever an external `signal` counter changes.
 * Lets the shared refresh control in the tabs row drive whichever sub-tab is
 * mounted, without each view needing to own a refresh button. The initial
 * value is ignored so this never double-fires alongside a view's mount refresh.
 */
export function useExternalRefresh(
  refresh: () => Promise<void> | void,
  signal: number | undefined
): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  const isFirst = useRef(true);
  useEffect(() => {
    if (signal === undefined) return;
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    void refreshRef.current();
  }, [signal]);
}

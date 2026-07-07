import { useEffect, useState } from 'react';

/**
 * Debounce a value by `delayMs`. Useful for keeping responsive inputs while
 * deferring expensive downstream work (search, filtering, API calls).
 */
export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

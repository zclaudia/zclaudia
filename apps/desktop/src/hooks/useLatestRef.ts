import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Keeps the latest committed value available to stable async callbacks without
 * mutating refs during render.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);
  return valueRef;
}

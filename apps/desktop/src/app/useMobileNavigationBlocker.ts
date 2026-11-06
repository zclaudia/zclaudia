import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

const blockers = new Set<symbol>();
const subscribers = new Set<() => void>();
const subscribe = (listener: () => void) => {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
};
const snapshot = () => blockers.size > 0;
const emit = () => subscribers.forEach(listener => listener());

/** Explicit registration for portaled modal shells; mounted hidden drawers never register. */
export function useMobileNavigationBlocker(active = false) {
  const identity = useRef(Symbol('navigation-modal'));
  useLayoutEffect(() => {
    if (!active) return;
    const id = identity.current;
    blockers.add(id);
    emit();
    return () => { blockers.delete(id); emit(); };
  }, [active]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

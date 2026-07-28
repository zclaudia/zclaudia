import { StrictMode, type PropsWithChildren } from 'react';

/**
 * Shared wrapper for lifecycle-sensitive tests. Production mounts under
 * StrictMode, so hooks that own async work, timers, subscriptions, or frame
 * handles should be exercised through this wrapper.
 */
export function StrictModeTestWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
}

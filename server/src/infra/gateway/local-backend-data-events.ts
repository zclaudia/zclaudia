import type { BackendResourceEventMessage } from '@zclaudia/protocol/sync';

// Local facade subscriptions bypass the gateway. Deliver resource mutations
// through the same protocol events even when the gateway is unavailable.
const listeners = new Set<(event: BackendResourceEventMessage) => void>();

export function subscribeLocalBackendDataEvents(
  listener: (event: BackendResourceEventMessage) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishLocalBackendDataEvent(event: BackendResourceEventMessage): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[LocalBackendData] Failed to deliver resource event:', error);
    }
  }
}

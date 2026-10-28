import type { Session } from '@zclaudia/shared/core/session';

export interface SessionEventPublisherPort {
  publishSessionEvent(type: 'created' | 'updated' | 'deleted', session: Session): void;
}

// Global instance holder (same pattern as infra/gateway/gateway-instance): the
// conversation runtime's title path needs to publish session resource events
// without threading the port through the whole provider-event call chain.
let sessionEventPublisherInstance: SessionEventPublisherPort | null = null;

export function setSessionEventPublisher(port: SessionEventPublisherPort | null): void {
  sessionEventPublisherInstance = port;
}

export function getSessionEventPublisher(): SessionEventPublisherPort | null {
  return sessionEventPublisherInstance;
}

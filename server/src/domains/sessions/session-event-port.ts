import type { Session } from '@zclaudia/shared/core/session';

export interface SessionEventPublisherPort {
  publishSessionEvent(type: 'created' | 'updated' | 'deleted', session: Session): void;
}

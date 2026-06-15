import type { ClientMessage } from '@zclaudia/shared';

/** Dependencies for resolving a message's target backend. */
export interface MessageTargetResolver {
  getSessionBackendId: (sessionId: string | null | undefined) => string | null;
  getProjectBackendId: (projectId: string | null | undefined) => string | null;
  /** Foreground backend used when the message has no owner (e.g. global messages). */
  fallbackBackendId: string | null;
}

function stringField(message: ClientMessage, key: 'sessionId' | 'projectId'): string | undefined {
  const value = (message as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Choose which backend a client message should be sent to.
 *
 * Owned messages (carrying a sessionId/projectId) route to their owner backend;
 * messages without an owner fall back to the foreground backend. With a single
 * connected backend the owner equals the fallback, so this is behavior-preserving
 * until multi-backend connections are enabled in a later phase.
 */
export function resolveMessageTarget(
  message: ClientMessage,
  resolver: MessageTargetResolver,
): string | null {
  const sessionId = stringField(message, 'sessionId');
  const projectId = stringField(message, 'projectId');

  const owner =
    (sessionId !== undefined ? resolver.getSessionBackendId(sessionId) : null) ??
    (projectId !== undefined ? resolver.getProjectBackendId(projectId) : null);

  return owner ?? resolver.fallbackBackendId;
}

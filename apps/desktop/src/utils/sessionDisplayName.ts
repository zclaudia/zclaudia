import type { Session } from '@zclaudia/shared/core/session';

export interface SessionDisplayName {
  text: string;
  /** True while the backend is generating an AI title for an otherwise unnamed session. */
  titlePending: boolean;
}

/**
 * Resolve the display title for a session: the explicit user name wins (a
 * rename is never overridden), the AI auto-title fills in for unnamed
 * sessions, then the caller's fallback text.
 */
export function resolveSessionDisplayName(
  session: Pick<Session, 'name' | 'autoTitle' | 'autoTitlePending'> | null | undefined,
  fallback = 'Untitled Session'
): SessionDisplayName {
  const text = session?.name || session?.autoTitle || fallback;
  const titlePending = !session?.name && !session?.autoTitle && session?.autoTitlePending === true;
  return { text, titlePending };
}

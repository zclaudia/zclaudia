/**
 * Soft byte budget for a single `GET /:id/messages` response. Sessions with
 * heavy tool-result metadata can carry hundreds of KB per assistant message, so
 * this is generous — the goal is only to bound pathological pages, not to keep
 * pages small. See {@link applyMessagePageBudget}.
 */
export const MESSAGE_PAGE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Minimum messages a page returns even when the byte budget is already blown.
 * Guards against the failure where a single oversized message (e.g. a 548 KB
 * assistant turn full of tool results) collapses the page to 1-2 items, forcing
 * the user to click "Load older messages" one fat message at a time.
 */
export const MESSAGE_PAGE_MIN_MESSAGES = 10;

/**
 * Trim a page of messages to a byte budget WITHOUT letting a single oversized
 * message collapse the page. The budget only trims the tail once at least
 * `minMessages` have been kept, so:
 *   - sessions under the budget return in full;
 *   - sessions with one giant message still return a useful page;
 *   - sessions with fewer than `minMessages` always return everything.
 *
 * `wasTrimmed` feeds the route's `hasMore` so the client keeps paginating.
 */
export function applyMessagePageBudget<
  T extends { content?: string | null; metadata?: string | null },
>(
  messages: T[],
  maxBytes: number = MESSAGE_PAGE_MAX_BYTES,
  minMessages: number = MESSAGE_PAGE_MIN_MESSAGES
): { trimmed: T[]; wasTrimmed: boolean } {
  let cumSize = 0;
  let keepCount = messages.length;
  for (let i = 0; i < messages.length; i++) {
    const rawSize = (messages[i].content?.length || 0) + (messages[i].metadata?.length || 0);
    cumSize += rawSize;
    if (i >= minMessages && cumSize > maxBytes) {
      keepCount = i;
      break;
    }
  }
  return { trimmed: messages.slice(0, keepCount), wasTrimmed: keepCount < messages.length };
}

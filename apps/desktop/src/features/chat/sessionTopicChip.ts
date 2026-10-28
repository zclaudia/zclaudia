/**
 * Resolve the header topic-chip text: prefer the AI title, else the first user
 * message. When the session name is the written-through auto title (unnamed
 * session, title mirrored into `name`), the header title already shows it —
 * the chip falls back to the first user message instead of duplicating it.
 */
export function resolveTopicChip(
  autoTitle: string | undefined,
  firstUserTopic: string | null,
  sessionName?: string
): string | null {
  const ai = autoTitle?.trim();
  if (ai && ai !== sessionName) return ai;
  return firstUserTopic;
}

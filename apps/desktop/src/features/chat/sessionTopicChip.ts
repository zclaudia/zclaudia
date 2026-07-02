/** Resolve the header topic-chip text: prefer the AI title, else the first user message. */
export function resolveTopicChip(
  autoTitle: string | undefined,
  firstUserTopic: string | null
): string | null {
  const ai = autoTitle?.trim();
  if (ai) return ai;
  return firstUserTopic;
}

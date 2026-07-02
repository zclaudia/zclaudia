import type { Message, AssistantMessage, TextContent } from '@earendil-works/pi-ai';

/** Regenerate the title once this many new user messages accumulate. */
export const TITLE_REGEN_THRESHOLD = 3;

/** Hard cap on the stored/displayed title length (chars). */
export const TITLE_MAX_CHARS = 40;

export const TITLE_SYSTEM_PROMPT =
  'You are a titling assistant. Read the conversation and produce a very short ' +
  'topic title (at most 6 words). Reply with ONLY the title text — no quotes, no ' +
  'trailing punctuation, no preamble. Use the same language as the conversation.';

export const TITLE_INSTRUCTION =
  'Reply with only a short title (≤6 words) summarizing this conversation, in its language.';

export function shouldRegenerateTitle(input: {
  autoTitle?: string;
  autoTitleMsgCount?: number;
  userMsgCount: number;
}): boolean {
  const { autoTitle, autoTitleMsgCount, userMsgCount } = input;
  if (userMsgCount < 1) return false;
  if (!autoTitle) return true;
  return userMsgCount - (autoTitleMsgCount ?? 0) >= TITLE_REGEN_THRESHOLD;
}

/** Keep the conversation excerpt small: first user message + the recent tail. */
export function pickTitleWindow(messages: Message[], maxRecent = 8): Message[] {
  if (messages.length <= maxRecent + 1) return messages;
  const recent = messages.slice(-maxRecent);
  const firstUser = messages.find(m => m.role === 'user');
  return firstUser && !recent.includes(firstUser) ? [firstUser, ...recent] : recent;
}

export function extractTitle(content: AssistantMessage['content']): string {
  return content
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'""]+|["'""]+$/g, '')
    .slice(0, TITLE_MAX_CHARS);
}

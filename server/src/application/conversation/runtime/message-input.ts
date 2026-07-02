import type { MessageAttachment } from '@zclaudia/shared/core/message';

export interface ParsedMessageInput {
  text: string;
  attachments: MessageAttachment[];
}

function isMessageAttachment(value: unknown): value is MessageAttachment {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.fileId === 'string' &&
    typeof a.name === 'string' &&
    typeof a.mimeType === 'string' &&
    (a.type === 'image' || a.type === 'file')
  );
}

/**
 * The desktop client wraps every run_start input as JSON {text, attachments}
 * (useSendMessage). Tolerant parse: anything that isn't that exact envelope —
 * plain text, user-typed JSON, legacy rows — passes through as text so we
 * never mangle a literal message.
 */
export function parseMessageInput(raw: string): ParsedMessageInput {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).text === 'string'
    ) {
      const candidate = (parsed as Record<string, unknown>).attachments;
      const attachments = Array.isArray(candidate) ? candidate.filter(isMessageAttachment) : [];
      return { text: (parsed as Record<string, unknown>).text as string, attachments };
    }
  } catch {
    // not JSON — plain text input
  }
  return { text: raw, attachments: [] };
}

import type { SessionTreeEntry, MessageEntry } from '@earendil-works/pi-agent-core';

export interface ProjectedMessageRow {
  /** Source tree entry id (the assistant/user message entry). Stored on the messages row for the two-way link. */
  entryId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    toolCalls?: Array<{ toolUseId: string; name: string; input?: unknown; output?: unknown; isError?: boolean }>;
    thinkingBlocks?: Array<{ text: string; signature?: string; redacted?: boolean }>;
    usage?: unknown;
  };
}

function isMessageEntry(e: SessionTreeEntry): e is MessageEntry {
  return e.type === 'message';
}

/**
 * Collapse a contiguous list of tree entries (one active path, or one turn's
 * fresh entries) into the coarse `messages` projection rows — the inverse of the
 * old messages-row→message expansion. Non-message entries (compaction /
 * state-change) are skipped here — compaction projects separately.
 */
export function projectEntriesToMessageRows(entries: SessionTreeEntry[]): ProjectedMessageRow[] {
  const rows: ProjectedMessageRow[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isMessageEntry(entry)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message = entry.message as any;

    if (message.role === 'user') {
      const content = typeof message.content === 'string'
        ? message.content
        : (message.content.find((b: any) => b.type === 'text')?.text ?? '');
      rows.push({ entryId: entry.id, role: 'user', content, metadata: undefined });
      continue;
    }
    if (message.role === 'assistant') {
      const blocks = Array.isArray(message.content) ? message.content : [];
      const thinkingBlocks = blocks
        .filter((b: any) => b.type === 'thinking')
        .map((b: any) => ({ text: b.thinking, signature: b.thinkingSignature, redacted: b.redacted }));
      const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const toolCallBlocks = blocks.filter((b: any) => b.type === 'toolCall');

      const toolCalls = toolCallBlocks.map((tc: any) => {
        let j = i + 1;
        let matched: any;
        while (j < entries.length && isMessageEntry(entries[j]) && (entries[j] as any).message.role === 'toolResult') {
          const tr = (entries[j] as any).message;
          if (tr.toolCallId === tc.id) { matched = tr; break; }
          j++;
        }
        const output = matched
          ? matched.content.map((c: any) => (c.type === 'text' ? c.text : '')).join('')
          : undefined;
        return { toolUseId: tc.id, name: tc.name, input: tc.arguments, output, isError: matched?.isError ?? false };
      });

      const metadata = (thinkingBlocks.length || toolCalls.length || message.usage)
        ? {
            ...(thinkingBlocks.length ? { thinkingBlocks } : {}),
            ...(toolCalls.length ? { toolCalls } : {}),
            ...(message.usage ? { usage: message.usage } : {}),
          }
        : undefined;

      rows.push({ entryId: entry.id, role: 'assistant', content: text, metadata });
      while (i + 1 < entries.length && isMessageEntry(entries[i + 1]) && (entries[i + 1] as any).message.role === 'toolResult') {
        i++;
      }
    }
  }
  return rows;
}

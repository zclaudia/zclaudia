import type { SessionTreeEntry, MessageEntry } from '@earendil-works/pi-agent-core';

export interface ProjectedMessageRow {
  /** Source tree entry id (the assistant/user message entry). Stored on the messages row for the two-way link. */
  entryId: string;
  /** Source entry ISO timestamp — carried so the projection preserves per-message times (and ordering). */
  timestamp: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    toolCalls?: Array<{
      toolUseId: string;
      name: string;
      input?: unknown;
      output?: unknown;
      isError?: boolean;
    }>;
    thinkingBlocks?: Array<{ text: string; signature?: string; redacted?: boolean }>;
    usage?: unknown;
  };
}

function isMessageEntry(e: SessionTreeEntry): e is MessageEntry {
  return e.type === 'message';
}

type MessageLike = {
  role?: unknown;
  content?: unknown;
  usage?: unknown;
};

type TextBlockLike = {
  type: 'text';
  text: string;
};

type ThinkingBlockLike = {
  type: 'thinking';
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
};

type ToolCallBlockLike = {
  type: 'toolCall';
  id: string;
  name: string;
  arguments?: unknown;
};

type ToolResultMessageLike = {
  role: 'toolResult';
  toolCallId: string;
  content: unknown;
  isError?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTextBlock(block: unknown): block is TextBlockLike {
  return isRecord(block) && block.type === 'text' && typeof block.text === 'string';
}

function isThinkingBlock(block: unknown): block is ThinkingBlockLike {
  return isRecord(block) && block.type === 'thinking' && typeof block.thinking === 'string';
}

function isToolCallBlock(block: unknown): block is ToolCallBlockLike {
  return (
    isRecord(block) &&
    block.type === 'toolCall' &&
    typeof block.id === 'string' &&
    typeof block.name === 'string'
  );
}

function isToolResultMessage(message: unknown): message is ToolResultMessageLike {
  return (
    isRecord(message) && message.role === 'toolResult' && typeof message.toolCallId === 'string'
  );
}

function isToolResultEntry(entry: SessionTreeEntry | undefined): entry is MessageEntry & {
  message: ToolResultMessageLike;
} {
  return !!entry && isMessageEntry(entry) && isToolResultMessage(entry.message);
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.find(isTextBlock)?.text ?? '';
}

function joinedTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(isTextBlock)
    .map(block => block.text)
    .join('');
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
    const message = entry.message as MessageLike;

    if (message.role === 'user') {
      const content = textFromContent(message.content);
      rows.push({
        entryId: entry.id,
        timestamp: entry.timestamp,
        role: 'user',
        content,
        metadata: undefined,
      });
      continue;
    }
    if (message.role === 'assistant') {
      const blocks = Array.isArray(message.content) ? message.content : [];
      const thinkingBlocks = blocks.filter(isThinkingBlock).map(block => ({
        text: block.thinking,
        signature: block.thinkingSignature,
        redacted: block.redacted,
      }));
      const text = joinedTextFromContent(blocks);
      const toolCallBlocks = blocks.filter(isToolCallBlock);

      const toolCalls = toolCallBlocks.map(tc => {
        let j = i + 1;
        let matched: ToolResultMessageLike | undefined;
        while (j < entries.length) {
          const candidate = entries[j];
          if (!isToolResultEntry(candidate)) break;
          const tr = candidate.message;
          if (tr.toolCallId === tc.id) {
            matched = tr;
            break;
          }
          j++;
        }
        const output = matched ? joinedTextFromContent(matched.content) : undefined;
        return {
          toolUseId: tc.id,
          name: tc.name,
          input: tc.arguments,
          output,
          isError: matched?.isError ?? false,
        };
      });

      const metadata =
        thinkingBlocks.length || toolCalls.length || message.usage
          ? {
              ...(thinkingBlocks.length ? { thinkingBlocks } : {}),
              ...(toolCalls.length ? { toolCalls } : {}),
              ...(message.usage ? { usage: message.usage } : {}),
            }
          : undefined;

      rows.push({
        entryId: entry.id,
        timestamp: entry.timestamp,
        role: 'assistant',
        content: text,
        metadata,
      });
      while (i + 1 < entries.length && isToolResultEntry(entries[i + 1])) {
        i++;
      }
    }
  }
  return rows;
}

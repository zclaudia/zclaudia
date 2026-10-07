import type { Entry, MessageEntry } from '@earendil-works/pi-agent-core';

export interface ProjectedMessageRow {
  /** Source tree entry id (the assistant/user message entry). Stored on the messages row for the two-way link. */
  entryId: string;
  /** Source entry timestamp (ms epoch) — carried so the projection preserves per-message times (and ordering). */
  timestamp: number;
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

function isMessageEntry(e: Entry): e is MessageEntry {
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

function isToolResultEntry(entry: Entry | undefined): entry is MessageEntry & {
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
export function projectEntriesToMessageRows(entries: Entry[]): ProjectedMessageRow[] {
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
      // One UI row per turn: a pi run stores one assistant entry per LLM call
      // (interleaved with tool results), the live stream shows them as one.
      const group: MessageEntry[] = [entry];
      let j = i + 1;
      while (j < entries.length && continuesTurn(group, entries[j])) {
        const next = entries[j] as MessageEntry;
        group.push(next);
        j++;
      }
      i = j - 1;
      rows.push(projectAssistantTurn(group));
    }
  }
  return rows;
}

function isAssistantEntry(entry: Entry | undefined): entry is MessageEntry {
  return !!entry && isMessageEntry(entry) && (entry.message as MessageLike).role === 'assistant';
}

/**
 * Whether `next` belongs to the turn in `group`: tool results always do; a
 * following assistant does only when the turn's last call asked for tools and
 * came from the provider (`model` set). Flattened turns written before
 * per-call persistence carry no model, so a later run's assistant (e.g. a
 * background follow-up) never merges into them.
 */
function continuesTurn(group: MessageEntry[], next: Entry): boolean {
  if (isToolResultEntry(next)) return true;
  if (!isAssistantEntry(next)) return false;
  const last = [...group].reverse().find(isAssistantEntry);
  const message = last?.message as (MessageLike & { model?: unknown }) | undefined;
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return typeof message?.model === 'string' && blocks.some(isToolCallBlock);
}

function sumUsage(usages: unknown[]): unknown {
  const known = usages.filter(isRecord);
  if (known.length <= 1) return known[0];
  const add = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) {
      const current = out[key];
      if (typeof value === 'number') {
        out[key] = (typeof current === 'number' ? current : 0) + value;
      } else if (isRecord(value)) {
        out[key] = add(isRecord(current) ? current : {}, value);
      }
    }
    return out;
  };
  return known.reduce((acc, usage) => add(acc, usage), {} as Record<string, unknown>);
}

function projectAssistantTurn(group: MessageEntry[]): ProjectedMessageRow {
  const assistants = group.filter(isAssistantEntry);
  const results = group.filter(isToolResultEntry).map(e => e.message);
  const blocks = assistants.flatMap(e => {
    const content = (e.message as MessageLike).content;
    return Array.isArray(content) ? content : [];
  });
  const thinkingBlocks = blocks.filter(isThinkingBlock).map(block => ({
    text: block.thinking,
    signature: block.thinkingSignature,
    redacted: block.redacted,
  }));
  const toolCalls = blocks.filter(isToolCallBlock).map(tc => {
    const matched = results.find(tr => tr.toolCallId === tc.id);
    return {
      toolUseId: tc.id,
      name: tc.name,
      input: tc.arguments,
      output: matched ? joinedTextFromContent(matched.content) : undefined,
      isError: matched?.isError ?? false,
    };
  });
  const usage = sumUsage(assistants.map(e => (e.message as MessageLike).usage));
  const metadata =
    thinkingBlocks.length || toolCalls.length || usage
      ? {
          ...(thinkingBlocks.length ? { thinkingBlocks } : {}),
          ...(toolCalls.length ? { toolCalls } : {}),
          ...(usage ? { usage } : {}),
        }
      : undefined;
  return {
    entryId: assistants[assistants.length - 1].id,
    timestamp: assistants[0].timestamp,
    role: 'assistant',
    content: assistants
      .map(e => joinedTextFromContent((e.message as MessageLike).content))
      .join(''),
    metadata,
  };
}

import type { Database } from 'better-sqlite3';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { MessageAttachment } from '@zclaudia/shared/core/message';
import { newId } from '../../../../utils/uuid.js';

export interface AssistantTurnData {
  fullContent: string;
  thinkingBlocks?: Array<{ text: string; signature?: string; redacted?: boolean }>;
  collectedToolCalls?: Array<{ toolUseId: string; name: string; input?: unknown; output?: unknown; isError?: boolean }>;
  /** Provider usage for this turn. Stored on the assistant entry so the
   *  compaction threshold (lastAssistantPromptTokens) can anchor on the real
   *  prompt-token count instead of degrading to a chars/4 estimate. */
  usage?: unknown;
}

/** Build a pi user AgentMessage. Image attachments become ref-carrying image
 *  blocks (no bytes in the tree); the read-time Route A postprocessor fills `data`. */
export function buildUserMessage(text: string, attachments: MessageAttachment[]): AgentMessage {
  const images = (attachments ?? []).filter((a) => a.type === 'image');
  if (images.length === 0) {
    return { role: 'user', content: text } as AgentMessage;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [{ type: 'text', text }];
  for (const att of images) content.push({ type: 'image', attachmentRef: att });
  return { role: 'user', content } as AgentMessage;
}

function serializeToolOutput(output: unknown): Array<{ type: 'text'; text: string }> {
  if (output == null) return [{ type: 'text', text: '' }];
  if (typeof output === 'string') return [{ type: 'text', text: output }];
  return [{ type: 'text', text: JSON.stringify(output) }];
}

/** Build the assistant message + one toolResult message per tool call from run data. */
export function buildAssistantTurnMessages(turn: AssistantTurnData): AgentMessage[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [];
  for (const tb of turn.thinkingBlocks ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = { type: 'thinking', thinking: tb.text };
    if (tb.signature) b.thinkingSignature = tb.signature;
    if (tb.redacted) b.redacted = tb.redacted;
    content.push(b);
  }
  if (turn.fullContent) content.push({ type: 'text', text: turn.fullContent });
  for (const tc of turn.collectedToolCalls ?? []) {
    content.push({ type: 'toolCall', id: tc.toolUseId, name: tc.name, arguments: (tc.input as Record<string, unknown> | undefined) ?? {} });
  }
  const messages: AgentMessage[] = [{
    role: 'assistant',
    content,
    stopReason: (turn.collectedToolCalls?.length ? 'toolUse' : 'stop'),
    ...(turn.usage ? { usage: turn.usage } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any];
  for (const tc of turn.collectedToolCalls ?? []) {
    messages.push({
      role: 'toolResult',
      toolCallId: tc.toolUseId,
      toolName: tc.name,
      content: serializeToolOutput(tc.output),
      isError: tc.isError ?? false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }
  return messages;
}

/**
 * Synchronously append message entries to the session tree, chaining each at the
 * current leaf and advancing the leaf — mirroring SqliteSessionStorage.appendEntry's
 * serialization (`payload = JSON.stringify({ message })`) and leaf-advance, but
 * synchronous so the sync run-lifecycle write path can call it. Returns the new
 * entry ids in order.
 */
export function appendMessagesToTree(db: Database, sessionId: string, messages: AgentMessage[]): string[] {
  const ids: string[] = [];
  const insert = db.prepare(
    `INSERT INTO session_entries (id, session_id, parent_id, type, payload, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const setLeaf = db.prepare(
    `INSERT INTO session_leaf (session_id, leaf_id) VALUES (?, ?)
     ON CONFLICT(session_id) DO UPDATE SET leaf_id = excluded.leaf_id`,
  );
  const getLeaf = db.prepare(`SELECT leaf_id AS leafId FROM session_leaf WHERE session_id = ?`);
  for (const message of messages) {
    const id = newId();
    const parentRow = getLeaf.get(sessionId) as { leafId: string | null } | undefined;
    const parentId = parentRow?.leafId ?? null;
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({ message });
    insert.run(id, sessionId, parentId, 'message', payload, timestamp);
    setLeaf.run(sessionId, id);
    ids.push(id);
  }
  return ids;
}

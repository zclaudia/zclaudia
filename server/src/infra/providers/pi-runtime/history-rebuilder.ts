import type Database from 'better-sqlite3';
import type { Message, Usage } from '@earendil-works/pi-ai';
import { SessionCompactionRepository } from '../../../domains/sessions/compaction-repository.js';

export const HISTORY_LIMIT = 50;

// Inlined from pi harness/messages — main barrel does not re-export these.
const COMPACTION_SUMMARY_PREFIX = 'The conversation history before this point was compacted into the following summary:\n\n<summary>\n';
const COMPACTION_SUMMARY_SUFFIX = '\n</summary>';

interface StoredRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: string | null;
  createdAt: number;
}

interface ParsedToolCall {
  toolUseId: string;
  name: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

interface ParsedThinkingBlock {
  text: string;
  signature?: string;
  redacted?: boolean;
}

interface ParsedMetadata {
  toolCalls?: ParsedToolCall[];
  thinkingBlocks?: ParsedThinkingBlock[];
  usage?: Usage;
}

export interface RebuiltHistory {
  messages: Message[];
  /** Parallel array: dbIds[i] = DB messages.id for messages[i], or null for synthesized (summary). */
  dbIds: (string | null)[];
}

function parseMetadata(metadata: string | null): ParsedMetadata | null {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as ParsedMetadata;
  } catch (err) {
    console.warn('[rebuildHistory] metadata JSON parse failed:', err);
    return null;
  }
}

function defaultZeroUsage(): Usage {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function serializeToolOutput(output: unknown): Array<{ type: 'text'; text: string }> {
  if (output == null) return [{ type: 'text', text: '' }];
  if (typeof output === 'string') return [{ type: 'text', text: output }];
  return [{ type: 'text', text: JSON.stringify(output) }];
}

/**
 * Rebuild pi `Message[]` history from ZClaudia's `messages` table.
 *
 * Returns `RebuiltHistory { messages, dbIds }` — parallel arrays so callers can
 * map rebuilt messages back to their DB row ids.
 *
 * - User messages: role='user', content=string
 * - System messages: skipped (they live in pi systemPrompt, not in messages array)
 * - Assistant messages: content is an array of pi content blocks — thinking, text, toolCall — reconstructed from metadata
 * - Tool calls: each toolCall in metadata produces a following pi 'toolResult' Message
 * - Trailing user message popped (it's the current input being passed via `agent.prompt(input)` separately)
 * - If a compaction exists, messages before the boundary are filtered out and a synthesized
 *   summary user message is prepended (dbId = null).
 */
export function rebuildHistory(
  db: Database.Database | undefined,
  sessionId: string | undefined,
): RebuiltHistory {
  if (!db || !sessionId) return { messages: [], dbIds: [] };

  // Resolve compaction boundary if one exists
  const compactionRepo = new SessionCompactionRepository(db);
  const compaction = compactionRepo.getLatest(sessionId);

  let boundaryOffset: number | null = null;
  if (compaction) {
    const boundaryRow = db.prepare<[string], { offset: number }>(
      'SELECT offset FROM messages WHERE id = ?',
    ).get(compaction.firstKeptMessageId);
    if (!boundaryRow) {
      console.warn(
        `[rebuildHistory] compaction '${compaction.id}' boundary message '${compaction.firstKeptMessageId}' not found — treating as no compaction`,
      );
    } else {
      boundaryOffset = boundaryRow.offset;
    }
  }

  // Build query — apply boundary filter if compaction is in effect
  let rows: StoredRow[];
  if (boundaryOffset !== null) {
    rows = db.prepare<[string, number, number], StoredRow>(
      `SELECT id, role, content, metadata, created_at AS createdAt
       FROM messages
       WHERE session_id = ? AND offset >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(sessionId, boundaryOffset, HISTORY_LIMIT);
  } else {
    rows = db.prepare<[string, number], StoredRow>(
      `SELECT id, role, content, metadata, created_at AS createdAt
       FROM messages
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(sessionId, HISTORY_LIMIT);
  }

  const chronological = rows.reverse();
  if (chronological.length > 0 && chronological[chronological.length - 1].role === 'user') {
    chronological.pop();
  }

  const messages: Message[] = [];
  const dbIds: (string | null)[] = [];

  // Prepend synthesized summary if compaction is in effect (and boundary resolved)
  if (compaction && boundaryOffset !== null) {
    messages.push({
      role: 'user',
      content: COMPACTION_SUMMARY_PREFIX + compaction.summary + COMPACTION_SUMMARY_SUFFIX,
      timestamp: compaction.createdAt,
    });
    dbIds.push(null);
  }

  for (const row of chronological) {
    if (row.role === 'system') continue;

    if (row.role === 'user') {
      messages.push({
        role: 'user',
        content: row.content,
        timestamp: row.createdAt,
      });
      dbIds.push(row.id);
      continue;
    }

    // assistant
    const meta = parseMetadata(row.metadata);
    const thinkingBlocks = meta?.thinkingBlocks ?? [];
    const toolCalls = meta?.toolCalls ?? [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentBlocks: any[] = [];

    for (const tb of thinkingBlocks) {
      const block: Record<string, unknown> = { type: 'thinking', thinking: tb.text };
      if (tb.signature) block.thinkingSignature = tb.signature;
      if (tb.redacted) block.redacted = tb.redacted;
      contentBlocks.push(block);
    }

    if (row.content) {
      contentBlocks.push({ type: 'text', text: row.content });
    }

    for (const tc of toolCalls) {
      contentBlocks.push({
        type: 'toolCall',
        id: tc.toolUseId,
        name: tc.name,
        arguments: (tc.input as Record<string, unknown> | undefined) ?? {},
      });
    }

    messages.push({
      role: 'assistant',
      content: contentBlocks,
      // Required AssistantMessage fields. Rebuilt history doesn't have these,
      // so use neutral defaults — pi tolerates them on history because they're
      // only emitted on newly-streamed messages.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api: 'unknown' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: 'unknown' as any,
      model: 'unknown',
      usage: meta?.usage ?? defaultZeroUsage(),
      stopReason: toolCalls.length > 0 ? 'toolUse' : 'stop',
      timestamp: row.createdAt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    dbIds.push(row.id);

    // Emit toolResult messages following the assistant (share the assistant row's id)
    for (const tc of toolCalls) {
      messages.push({
        role: 'toolResult',
        toolCallId: tc.toolUseId,
        toolName: tc.name,
        content: serializeToolOutput(tc.output),
        isError: tc.isError ?? false,
        timestamp: row.createdAt,
      });
      dbIds.push(row.id);
    }
  }

  return { messages, dbIds };
}

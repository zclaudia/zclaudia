import type { Database } from 'better-sqlite3';
import type { AgentMessage, MessageEntry } from '@earendil-works/pi-agent-core';
import { SqliteSessionStorage } from './sqlite-session-storage.js';

/**
 * Read up to `messageLimit` most-recent message entries from the active branch,
 * newest last (root→leaf order). Unlike a full context build, this caps the walk
 * so a long session doesn't reconstruct the whole branch for a throwaway recent
 * window — e.g. session-title generation. Compaction boundaries are NOT applied;
 * callers that only need recent raw text (titles) don't care.
 */
export async function readRecentMessages(
  db: Database,
  sessionId: string,
  messageLimit: number
): Promise<AgentMessage[]> {
  const storage = new SqliteSessionStorage(db, sessionId);
  const leafId = await storage.getLeafId();
  if (!leafId) return [];

  // Generous over-read so tool-heavy turns (assistant + many toolResults) still
  // yield `messageLimit` message entries, while staying bounded for long
  // sessions. `newestFirst` walks leaf→root, so reverse for reading order.
  const entries = await storage.findEntriesOnBranch({
    start: leafId,
    type: 'message',
    limit: Math.max(messageLimit * 6, 64),
  });
  return entries
    .reverse()
    .map(entry => (entry as MessageEntry).message)
    .slice(-messageLimit);
}

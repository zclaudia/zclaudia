import type { Database } from 'better-sqlite3';
import { SqliteSessionStorage } from './sqlite-session-storage.js';

/**
 * Fork "at": copy the source session's root→entryId branch (inclusive) into a
 * NEW session and point that session's lane at the fork point. The source is
 * untouched.
 *
 * The copying itself belongs to the storage — a session is a mutation stream
 * now, and re-issuing that stream under a new session id is a storage concern,
 * not something to assemble from SQL out here. See `forkBranchInto` for why
 * entry ids are reused and sequence numbers are not.
 *
 * Wrapped in a transaction so a partial copy can never leave a dangling tree.
 */
export function forkSessionAt(
  db: Database,
  sourceSessionId: string,
  entryId: string,
  newSessionId: string
): void {
  db.transaction(() => {
    new SqliteSessionStorage(db, sourceSessionId).forkBranchInto(newSessionId, entryId);
  })();
}

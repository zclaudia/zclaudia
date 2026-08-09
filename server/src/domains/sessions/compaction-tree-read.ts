import type { Database } from 'better-sqlite3';
import type { CompactionEntry } from '@earendil-works/pi-agent-core';
import { SqliteSessionStorage } from '../../infra/providers/pi-runtime/session-tree/sqlite-session-storage.js';

/**
 * Read compaction records from the session tree. Compactions are native pi
 * `CompactionEntry` nodes, not rows in the long-dropped `session_compactions`
 * table. These helpers project an entry back into the shape the routes and the
 * timeline consume, so the read sites stay unchanged.
 *
 * Entries live inside the session's mutation log now, so the reads go through
 * the storage rather than addressing a table.
 */
export interface SessionCompaction {
  id: string;
  sessionId: string;
  summary: string;
  tokensBefore: number;
  details: { readFiles: string[]; modifiedFiles: string[] } | null;
  source: 'auto' | 'manual' | 'overflow' | 'preflight';
  customInstructions: string | null;
  createdAt: number;
}

/** Shape of the JSON we persist in `details` when appending the compaction entry. */
interface StoredCompactionDetails {
  source?: 'auto' | 'manual' | 'overflow' | 'preflight';
  customInstructions?: string | null;
  readFiles?: string[];
  modifiedFiles?: string[];
}

function toCompaction(entry: CompactionEntry, sessionId: string): SessionCompaction {
  const d = (entry.details ?? {}) as StoredCompactionDetails;
  return {
    id: entry.id,
    sessionId,
    summary: entry.summary ?? '',
    tokensBefore: entry.tokensBefore ?? 0,
    details: { readFiles: d.readFiles ?? [], modifiedFiles: d.modifiedFiles ?? [] },
    source: d.source ?? 'auto',
    customInstructions: d.customInstructions ?? null,
    createdAt: entry.timestamp,
  };
}

/** All compaction entries for a session, oldest first (chronological for the timeline). */
export async function listCompactions(
  db: Database,
  sessionId: string
): Promise<SessionCompaction[]> {
  const entries = await new SqliteSessionStorage(db, sessionId).findEntries({
    type: 'compaction',
    order: 'oldestFirst',
  });
  return entries.map(entry => toCompaction(entry as CompactionEntry, sessionId));
}

/** Single compaction entry by id, or null when it doesn't exist / isn't a compaction. */
export async function getCompactionById(
  db: Database,
  sessionId: string,
  compactionId: string
): Promise<SessionCompaction | null> {
  const entry = await new SqliteSessionStorage(db, sessionId).getEntry(compactionId);
  if (!entry || entry.type !== 'compaction') return null;
  return toCompaction(entry, sessionId);
}

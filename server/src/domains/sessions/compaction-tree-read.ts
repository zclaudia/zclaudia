import type { Database } from 'better-sqlite3';

/**
 * Read compaction records from the session tree (Route C). Compactions are now
 * native pi `CompactionEntry` nodes in `session_entries` (type='compaction'),
 * not rows in the dropped `session_compactions` table. These synchronous helpers
 * project an entry back into the `SessionCompaction` shape the routes/timeline
 * already consume, so the read sites stay unchanged.
 *
 * Entry storage layout (see SqliteSessionStorage.toRow): `id`, `type`,
 * `timestamp`, `parent_id` live in their own columns; everything else —
 * `summary`, `firstKeptEntryId`, `tokensBefore`, `details`, `fromHook` — is in
 * the JSON `payload`. We store our rich UI metadata under `details`.
 */
export interface SessionCompaction {
  id: string;
  sessionId: string;
  summary: string;
  /** Tree entry id where retained history starts (was the messages-table boundary id). */
  firstKeptMessageId: string;
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

interface CompactionEntryRow {
  id: string;
  payload: string;
  timestamp: string;
}

function mapRow(row: CompactionEntryRow, sessionId: string): SessionCompaction {
  const payload = JSON.parse(row.payload) as {
    summary?: string;
    firstKeptEntryId?: string;
    tokensBefore?: number;
    details?: StoredCompactionDetails;
  };
  const d = payload.details ?? {};
  return {
    id: row.id,
    sessionId,
    summary: payload.summary ?? '',
    firstKeptMessageId: payload.firstKeptEntryId ?? '',
    tokensBefore: payload.tokensBefore ?? 0,
    details: { readFiles: d.readFiles ?? [], modifiedFiles: d.modifiedFiles ?? [] },
    source: d.source ?? 'auto',
    customInstructions: d.customInstructions ?? null,
    // Tree timestamps are ISO strings; the UI marker carries ms-since-epoch.
    createdAt: Date.parse(row.timestamp),
  };
}

/** All compaction entries for a session, oldest first (chronological for the timeline). */
export function listCompactions(db: Database, sessionId: string): SessionCompaction[] {
  const rows = db.prepare(
    `SELECT id, payload, timestamp FROM session_entries
     WHERE session_id = ? AND type = 'compaction'
     ORDER BY timestamp ASC, id ASC`,
  ).all(sessionId) as CompactionEntryRow[];
  return rows.map((r) => mapRow(r, sessionId));
}

/** Single compaction entry by id, or null when it doesn't exist / isn't in this session. */
export function getCompactionById(db: Database, sessionId: string, compactionId: string): SessionCompaction | null {
  const row = db.prepare(
    `SELECT id, payload, timestamp FROM session_entries
     WHERE session_id = ? AND id = ? AND type = 'compaction'`,
  ).get(sessionId, compactionId) as CompactionEntryRow | undefined;
  return row ? mapRow(row, sessionId) : null;
}

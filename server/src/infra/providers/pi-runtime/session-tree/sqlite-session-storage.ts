import type { Database } from 'better-sqlite3';
import type {
  SessionStorage, SessionTreeEntry, SessionMetadata, LabelEntry, LeafEntry,
} from '@earendil-works/pi-agent-core';
import { SessionError } from '@earendil-works/pi-agent-core';
import { newId } from '../../../../utils/uuid.js';

interface EntryRow {
  id: string;
  parent_id: string | null;
  type: string;
  payload: string;
  timestamp: string;
}

/**
 * The four base fields (id, parentId, type, timestamp) are split into their own columns and
 * intentionally excluded from `payload`; `fromRow` re-merges them so payload never contains them.
 */
function toRow(entry: SessionTreeEntry): EntryRow {
  const { id, parentId, type, timestamp, ...rest } = entry as SessionTreeEntry & Record<string, unknown>;
  return {
    id, parent_id: parentId ?? null, type, timestamp,
    payload: JSON.stringify(rest),
  } as EntryRow;
}

function fromRow(row: EntryRow): SessionTreeEntry {
  const rest = JSON.parse(row.payload) as Record<string, unknown>;
  return {
    id: row.id, parentId: row.parent_id, type: row.type, timestamp: row.timestamp, ...rest,
  } as SessionTreeEntry;
}

/**
 * pi `SessionStorage` over SQLite (sibling to pi's JsonlSessionStorage). The
 * storage-agnostic `Session` logic (buildContext / getBranch / moveTo) is
 * reused unchanged on top of this.
 */
export class SqliteSessionStorage implements SessionStorage {
  constructor(private db: Database, private sessionId: string) {}

  async getMetadata(): Promise<SessionMetadata> {
    const row = this.db.prepare('SELECT id, created_at AS createdAt FROM sessions WHERE id = ?')
      .get(this.sessionId) as { id: string; createdAt: number } | undefined;
    if (!row) throw new Error(`session not found: ${this.sessionId}`);
    return { id: row.id, createdAt: new Date(row.createdAt).toISOString() };
  }

  async getLeafId(): Promise<string | null> {
    const row = this.db.prepare('SELECT leaf_id AS leafId FROM session_leaf WHERE session_id = ?')
      .get(this.sessionId) as { leafId: string | null } | undefined;
    return row?.leafId ?? null;
  }

  private writeLeaf(leafId: string | null): void {
    this.db.prepare(
      `INSERT INTO session_leaf (session_id, leaf_id) VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET leaf_id = excluded.leaf_id`,
    ).run(this.sessionId, leafId);
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null) {
      const exists = this.db.prepare(
        `SELECT 1 FROM session_entries WHERE id = ? AND session_id = ?`,
      ).get(leafId, this.sessionId);
      if (!exists) throw new SessionError('not_found', `Entry ${leafId} not found`);
    }
    this.writeLeaf(leafId);
  }

  async createEntryId(): Promise<string> {
    return newId();
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    const row = toRow(entry);
    this.db.prepare(
      `INSERT INTO session_entries (id, session_id, parent_id, type, payload, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(row.id, this.sessionId, row.parent_id, row.type, row.payload, row.timestamp);
    const newLeaf = entry.type === 'leaf' ? (entry as LeafEntry).targetId : entry.id;
    this.writeLeaf(newLeaf);
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    const row = this.db.prepare(
      `SELECT id, parent_id, type, payload, timestamp FROM session_entries WHERE id = ? AND session_id = ?`,
    ).get(id, this.sessionId) as EntryRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  async findEntries<TType extends SessionTreeEntry['type']>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    const rows = this.db.prepare(
      `SELECT id, parent_id, type, payload, timestamp FROM session_entries
       WHERE session_id = ? AND type = ? ORDER BY timestamp ASC, id ASC`,
    ).all(this.sessionId, type) as EntryRow[];
    return rows.map(fromRow) as Array<Extract<SessionTreeEntry, { type: TType }>>;
  }

  async getLabel(id: string): Promise<string | undefined> {
    // Scans label entries for the session and returns the latest matching targetId (latest-wins,
    // matching pi). O(number of label entries) — acceptable: labels are not on any hot path (no
    // label/moveTo UI this period) and findEntries already restricts to label-type rows.
    const labels = (await this.findEntries('label')) as LabelEntry[];
    const matching = labels.filter((l) => l.targetId === id);
    return matching.length ? matching[matching.length - 1].label : undefined;
  }

  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (!leafId) return [];
    const rows = this.db.prepare(
      `WITH RECURSIVE path(id, parent_id, type, payload, timestamp, depth) AS (
         SELECT id, parent_id, type, payload, timestamp, 0
           FROM session_entries WHERE id = ? AND session_id = ?
         UNION ALL
         SELECT e.id, e.parent_id, e.type, e.payload, e.timestamp, p.depth + 1
           FROM session_entries e JOIN path p ON e.id = p.parent_id
           WHERE e.session_id = ?
       )
       SELECT id, parent_id, type, payload, timestamp FROM path ORDER BY depth DESC`,
    ).all(leafId, this.sessionId, this.sessionId) as EntryRow[];
    if (rows.length === 0) {
      throw new SessionError('not_found', `Entry ${leafId} not found`);
    }
    return rows.map(fromRow);
  }

  async getEntries(): Promise<SessionTreeEntry[]> {
    const rows = this.db.prepare(
      `SELECT id, parent_id, type, payload, timestamp FROM session_entries
       WHERE session_id = ? ORDER BY timestamp ASC, id ASC`,
    ).all(this.sessionId) as EntryRow[];
    return rows.map(fromRow);
  }
}

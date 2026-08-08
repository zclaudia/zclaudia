import type { Database } from 'better-sqlite3';
import {
  SessionError,
  type BranchBounds,
  type Entry,
  type EntryQuery,
  type LaneRecord,
  type LanePointer,
  type LogItem,
  type NewRecord,
  type OperationStartedRecord,
  type ProvisionedEntry,
  type RecordQuery,
  type SessionMetadata,
  type SessionStats,
  type SessionStorage,
} from '@earendil-works/pi-agent-core';
import { MAIN_LANE, SessionState, mutationSeq, type SessionMutation } from './session-state.js';

interface LogRow {
  seq: number;
  payload: string;
}

/**
 * pi `SessionStorage` over SQLite (sibling to pi's JsonlSessionStorage).
 *
 * pi 0.84 replaced the entry-tree-plus-leaf-pointer model with one ordered
 * mutation stream: entries, lane moves, lane records and facts all draw from a
 * single sequence, and `getLog` hands that stream back for replay. Storing the
 * stream itself — one row per mutation — rather than a table per kind is both
 * closer to the model and what makes `getLog` a plain range scan.
 *
 * Reads are served from a `SessionState` projection built by replaying the
 * stream on first use, the same way pi's own JSONL backend reads its file. A
 * session therefore costs memory proportional to its length once touched; that
 * is already true of the context-tree UI, which loads whole sessions anyway.
 */
export class SqliteSessionStorage implements SessionStorage {
  private state: SessionState | undefined;

  constructor(
    private db: Database,
    private sessionId: string
  ) {}

  /**
   * Replays the persisted stream. Lazy rather than in the constructor because
   * `SessionStorage` is constructed synchronously, and better-sqlite3 reads are
   * synchronous, so the first call pays for it and nothing else notices.
   */
  private get projection(): SessionState {
    if (!this.state) {
      const state = new SessionState();
      const rows = this.db
        .prepare('SELECT seq, payload FROM session_log WHERE session_id = ? ORDER BY seq ASC')
        .all(this.sessionId) as LogRow[];
      for (const row of rows) {
        // A stored mutation that no longer applies means the stream is
        // corrupt; failing here beats serving a silently truncated session.
        state.applyMutation(JSON.parse(row.payload) as SessionMutation, message => {
          throw new SessionError(
            'storage',
            `Session ${this.sessionId} log is corrupt at seq ${row.seq}: ${message}`
          );
        });
      }
      this.state = state;
    }
    return this.state;
  }

  /** Persists a mutation and applies it, so memory and disk cannot diverge. */
  private commit(mutation: SessionMutation): void {
    const state = this.projection;
    this.db
      .prepare('INSERT INTO session_log (session_id, seq, kind, payload) VALUES (?, ?, ?, ?)')
      .run(this.sessionId, mutationSeq(mutation), mutation.kind, JSON.stringify(mutation));
    state.applyMutation(mutation);
  }

  async getMetadata(): Promise<SessionMetadata> {
    const row = this.db
      .prepare(
        'SELECT id, created_at AS createdAt, parent_session_id AS parentSessionId FROM sessions WHERE id = ?'
      )
      .get(this.sessionId) as
      | { id: string; createdAt: number; parentSessionId: string | null }
      | undefined;
    if (!row) throw new SessionError('not_found', `Session not found: ${this.sessionId}`);
    return {
      id: row.id,
      createdAt: row.createdAt,
      ...(row.parentSessionId ? { parentSessionId: row.parentSessionId } : {}),
    };
  }

  async getLanes(): Promise<LanePointer[]> {
    return this.projection.getLanes();
  }

  /**
   * The main lane's leaf — what `getLeafId()` meant before 0.84 moved the
   * pointer into lanes. Not part of `SessionStorage`; kept for the callers that
   * only ever work with the one lane.
   */
  async getLeafId(): Promise<string | null> {
    return this.projection.requireLane(MAIN_LANE);
  }

  /** Root → leaf, the path `getPathToRoot()` used to return reversed. */
  async getActivePath(): Promise<Entry[]> {
    const leafId = await this.getLeafId();
    if (!leafId) return [];
    return this.findEntriesOnBranch({ start: leafId, order: 'oldestFirst' });
  }

  async createLane(lane: string, at: string | null): Promise<void> {
    const state = this.projection;
    state.validateNewLane(lane);
    state.validateTarget(at);
    this.commit({ kind: 'lane', seq: state.nextSequence, lane, leafId: at });
  }

  async moveLane(lane: string, to: string | null): Promise<void> {
    const state = this.projection;
    state.requireLane(lane);
    state.validateTarget(to);
    this.commit({ kind: 'lane', seq: state.nextSequence, lane, leafId: to });
  }

  async appendEntry<TEntry extends Entry>(
    newEntry: ProvisionedEntry<TEntry>,
    lane: string
  ): Promise<TEntry> {
    const state = this.projection;
    const parentId = state.requireLane(lane);
    state.validateUnusedId(newEntry.id);
    const entry = {
      ...structuredClone(newEntry),
      parentId,
      seq: state.nextSequence,
      timestamp: Date.now(),
      // The provisioned shape plus the fields we just supplied is exactly
      // TEntry, but TypeScript cannot see that through the distributive
      // Omit that defines ProvisionedEntry.
    } as unknown as TEntry;
    this.commit({ kind: 'entry', lane, entry });
    return structuredClone(entry);
  }

  async appendRecord<TRecord extends LaneRecord>(newRecord: NewRecord<TRecord>): Promise<TRecord> {
    const state = this.projection;
    state.requireLane(newRecord.lane);
    state.validateUnusedId(newRecord.id);
    const openId = state.findOpenOperations(newRecord.lane, { limit: 1 })[0]?.id;
    if (newRecord.type === 'operation_started' && openId !== undefined) {
      throw new SessionError(
        'storage',
        `Lane ${newRecord.lane} already has an open operation ${openId}`
      );
    }
    const record = {
      ...structuredClone(newRecord),
      seq: state.nextSequence,
      timestamp: Date.now(),
    } as unknown as TRecord;
    this.commit({ kind: 'record', record });
    return structuredClone(record);
  }

  async getEntry(id: string): Promise<Entry | undefined> {
    const entry = this.projection.getEntry(id);
    return entry === undefined ? undefined : structuredClone(entry);
  }

  async findEntries(query: EntryQuery = {}): Promise<Entry[]> {
    return structuredClone(this.projection.findEntries(query));
  }

  async findEntriesOnBranch(
    query: EntryQuery & BranchBounds & { start: string }
  ): Promise<Entry[]> {
    return structuredClone(this.projection.findEntriesOnBranch(query));
  }

  async findRecords(query: RecordQuery = {}): Promise<LaneRecord[]> {
    return structuredClone(this.projection.findRecords(query));
  }

  async findOpenOperations(
    lane: string,
    options?: { limit?: number }
  ): Promise<OperationStartedRecord[]> {
    return structuredClone(this.projection.findOpenOperations(lane, options));
  }

  async getLog(options: { afterSeq?: number; limit?: number } = {}): Promise<LogItem[]> {
    return structuredClone(this.projection.getLog(options));
  }

  async getName(): Promise<string | undefined> {
    return this.projection.getName();
  }

  async setName(name: string): Promise<void> {
    this.commit({ kind: 'fact', seq: this.projection.nextSequence, fact: 'name', name });
  }

  async getLabel(id: string): Promise<string | undefined> {
    return this.projection.getLabel(id);
  }

  async setLabel(id: string, label: string | undefined): Promise<void> {
    const state = this.projection;
    state.validateTarget(id);
    this.commit({ kind: 'fact', seq: state.nextSequence, fact: 'label', targetId: id, label });
  }

  async getStats(): Promise<SessionStats> {
    return structuredClone(this.projection.getStats());
  }
}

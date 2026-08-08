import {
  SessionError,
  type BranchBounds,
  type Entry,
  type EntryOrder,
  type EntryQuery,
  type LaneRecord,
  type LanePointer,
  type LogItem,
  type LogOptions,
  type OperationStartedRecord,
  type RecordQuery,
  type SessionStats,
} from '@earendil-works/pi-agent-core';

/**
 * A single durable change to a session, and the unit `SqliteSessionStorage`
 * persists. pi models a session as one ordered mutation stream — entries,
 * lane moves, records and facts share a single sequence — so replaying the
 * stream in order reconstructs the session exactly.
 *
 * pi has this type internally (`SessionState`, not exported from
 * `@earendil-works/pi-agent-core`). We keep our own copy rather than
 * reimplement its query semantics in SQL: `findEntriesOnBranch` bounds,
 * cursor direction, open-operation bookkeeping and the stats accumulators are
 * fiddly enough that a second interpretation would drift from pi's, and pi
 * ships a conformance suite that would catch the drift only after we shipped
 * it. Keeping the semantics in one ported file makes the diff against a future
 * pi version reviewable.
 */
export type SessionMutation =
  | { kind: 'entry'; lane?: string; entry: Entry }
  | { kind: 'record'; record: LaneRecord }
  | { kind: 'lane'; seq: number; lane: string; leafId: string | null }
  | { kind: 'fact'; seq: number; fact: 'name'; name: string }
  | { kind: 'fact'; seq: number; fact: 'label'; targetId: string; label: string | undefined };

/**
 * The lane every session starts with and the only one we author against. pi
 * supports several (a lane is one independent cursor into the entry tree), but
 * nothing in zclaudia creates a second one yet.
 */
export const MAIN_LANE = 'main';

type InvalidMutation = (message: string) => never;

function invalidMutation(message: string): never {
  throw new SessionError('invalid_entry', `Invalid session mutation: ${message}`);
}

function assertValidLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new SessionError('invalid_query', 'limit must be a positive integer');
  }
}

function assertValidCursor(afterSeq: number | undefined): void {
  if (afterSeq !== undefined && (!Number.isInteger(afterSeq) || afterSeq < 0)) {
    throw new SessionError('invalid_query', 'cursor sequence must be a non-negative integer');
  }
}

function* ordered<T>(items: readonly T[], order: EntryOrder | undefined): Generator<T> {
  if (order === 'oldestFirst') {
    yield* items;
    return;
  }
  for (let index = items.length - 1; index >= 0; index--) yield items[index];
}

/** The seq a mutation claims, whichever kind it is. */
export function mutationSeq(mutation: SessionMutation): number {
  if (mutation.kind === 'entry') return mutation.entry.seq;
  if (mutation.kind === 'record') return mutation.record.seq;
  return mutation.seq;
}

/**
 * In-memory projection of a session's mutation stream. A faithful port of pi's
 * internal `SessionState`; see `SessionMutation` for why we carry a copy.
 */
export class SessionState {
  private sequence = 0;
  private usedIds = new Set<string>();
  private entries: Entry[] = [];
  private entriesById = new Map<string, Entry>();
  private records: LaneRecord[] = [];
  private openOperationsByLane = new Map<string, Map<string, OperationStartedRecord>>();
  /** Every session starts with a `main` lane pointing at nothing. */
  private lanes = new Map<string, string | null>([['main', null]]);
  private log: LogItem[] = [];
  private stats: SessionStats = {
    messageCount: 0,
    cachedTokens: 0,
    uncachedTokens: 0,
    totalTokens: 0,
    costTotal: 0,
  };
  private name: string | undefined;
  private labels = new Map<string, string>();

  get nextSequence(): number {
    return this.sequence + 1;
  }

  getLanes(): LanePointer[] {
    return [...this.lanes].map(([lane, leafId]) => ({ lane, leafId }));
  }

  requireLane(lane: string): string | null {
    const leafId = this.lanes.get(lane);
    if (leafId === undefined) throw new SessionError('invalid_lane', `Lane not found: ${lane}`);
    return leafId;
  }

  validateNewLane(lane: string): void {
    if (this.lanes.has(lane)) throw new SessionError('already_exists', `Lane already exists: ${lane}`);
  }

  validateTarget(targetId: string | null): void {
    if (targetId !== null && !this.entriesById.has(targetId)) {
      throw new SessionError('not_found', `Entry not found: ${targetId}`);
    }
  }

  validateUnusedId(id: string): void {
    if (this.usedIds.has(id)) {
      throw new SessionError('already_exists', `Session id already exists: ${id}`);
    }
  }

  applyMutation(mutation: SessionMutation, invalid: InvalidMutation = invalidMutation): void {
    const seq = mutationSeq(mutation);
    if (seq !== this.sequence + 1) invalid(`has non-consecutive seq ${seq}`);

    switch (mutation.kind) {
      case 'entry': {
        const { entry } = mutation;
        if (this.usedIds.has(entry.id)) invalid(`contains duplicate id ${entry.id}`);
        if (mutation.lane !== undefined) {
          const leafId = this.lanes.get(mutation.lane);
          if (leafId === undefined) invalid(`references missing lane ${mutation.lane}`);
          if (entry.parentId !== leafId) invalid('does not chain to the lane leaf');
        }
        if (entry.parentId !== null && !this.entriesById.has(entry.parentId)) {
          invalid(`references missing parent ${entry.parentId}`);
        }
        this.sequence = seq;
        this.usedIds.add(entry.id);
        this.entries.push(entry);
        this.entriesById.set(entry.id, entry);
        if (mutation.lane !== undefined) this.lanes.set(mutation.lane, entry.id);
        this.log.push({ kind: 'entry', seq, entry });
        if (entry.type === 'message') this.stats.messageCount += 1;
        break;
      }
      case 'record': {
        const { record } = mutation;
        if (!this.lanes.has(record.lane)) invalid(`references missing lane ${record.lane}`);
        if (this.usedIds.has(record.id)) invalid(`contains duplicate id ${record.id}`);
        this.sequence = seq;
        this.usedIds.add(record.id);
        this.records.push(record);
        if (record.type === 'operation_started') {
          let open = this.openOperationsByLane.get(record.lane);
          if (!open) {
            open = new Map();
            this.openOperationsByLane.set(record.lane, open);
          }
          open.set(record.id, record);
        } else if (record.type === 'operation_finished') {
          // Keyed by the started record's id, which is what a finished record
          // carries as its runId.
          this.openOperationsByLane.get(record.lane)?.delete(record.runId);
        }
        this.log.push({ kind: 'record', seq, record });
        if (record.type === 'usage') {
          this.stats.cachedTokens += record.usage.cacheRead;
          this.stats.uncachedTokens += record.usage.input + record.usage.cacheWrite;
          this.stats.totalTokens += record.usage.totalTokens;
          this.stats.costTotal += record.usage.cost.total;
        }
        break;
      }
      case 'lane': {
        if (mutation.leafId !== null && !this.entriesById.has(mutation.leafId)) {
          invalid(`references missing lane target ${mutation.leafId}`);
        }
        this.sequence = seq;
        this.lanes.set(mutation.lane, mutation.leafId);
        this.log.push({ kind: 'lane', seq, lane: mutation.lane, leafId: mutation.leafId });
        break;
      }
      case 'fact': {
        if (mutation.fact === 'label' && !this.entriesById.has(mutation.targetId)) {
          invalid(`references missing label target ${mutation.targetId}`);
        }
        this.sequence = seq;
        if (mutation.fact === 'name') {
          this.name = mutation.name;
          this.log.push({ kind: 'fact', seq, fact: 'name', name: mutation.name });
        } else {
          if (mutation.label === undefined) this.labels.delete(mutation.targetId);
          else this.labels.set(mutation.targetId, mutation.label);
          this.log.push({
            kind: 'fact',
            seq,
            fact: 'label',
            targetId: mutation.targetId,
            label: mutation.label,
          });
        }
        break;
      }
    }
  }

  getEntry(id: string): Entry | undefined {
    return this.entriesById.get(id);
  }

  findEntries(query: EntryQuery = {}): Entry[] {
    assertValidLimit(query.limit);
    assertValidCursor(query.cursor?.afterSeq);
    const results: Entry[] = [];
    for (const entry of ordered(this.entries, query.order)) {
      if (!this.matchesEntryQuery(entry, query)) continue;
      results.push(entry);
      if (results.length === query.limit) break;
    }
    return results;
  }

  findEntriesOnBranch(query: EntryQuery & BranchBounds & { start: string }): Entry[] {
    assertValidLimit(query.limit);
    assertValidCursor(query.cursor?.afterSeq);
    const results: Entry[] = [];
    if (query.order === 'oldestFirst') {
      for (const entry of [...this.walkToRoot(query.start)].reverse()) {
        const reachedBound = entry.id === query.stopAtId || entry.type === query.stopAtType;
        if (this.matchesEntryQuery(entry, query)) results.push(entry);
        if (reachedBound || results.length === query.limit) break;
      }
    } else {
      for (const entry of this.walkToRoot(query.start, query)) {
        if (this.matchesEntryQuery(entry, query)) results.push(entry);
        if (results.length === query.limit) break;
      }
    }
    return results;
  }

  findRecords(query: RecordQuery = {}): LaneRecord[] {
    assertValidLimit(query.limit);
    assertValidCursor(query.afterSeq);
    const results: LaneRecord[] = [];
    for (const record of ordered(this.records, query.order)) {
      if (!this.matchesRecordQuery(record, query)) continue;
      results.push(record);
      if (results.length === query.limit) break;
    }
    return results;
  }

  findOpenOperations(lane: string, options?: { limit?: number }): OperationStartedRecord[] {
    assertValidLimit(options?.limit);
    const byId = this.openOperationsByLane.get(lane);
    const open = byId ? [...byId.values()].reverse() : [];
    return options?.limit === undefined ? open : open.slice(0, options.limit);
  }

  getLog(options: LogOptions = {}): LogItem[] {
    assertValidLimit(options.limit);
    assertValidCursor(options.afterSeq);
    const results: LogItem[] = [];
    for (const item of this.log) {
      if (options.afterSeq !== undefined && item.seq <= options.afterSeq) continue;
      results.push(item);
      if (results.length === options.limit) break;
    }
    return results;
  }

  getName(): string | undefined {
    return this.name;
  }

  getLabel(id: string): string | undefined {
    return this.labels.get(id);
  }

  getStats(): SessionStats {
    return this.stats;
  }

  private *walkToRoot(start: string | null, bounds?: BranchBounds): Generator<Entry> {
    if (start === null) return;
    const visited = new Set<string>();
    let current = this.entriesById.get(start);
    if (!current) throw new SessionError('not_found', `Entry not found: ${start}`);
    while (current) {
      if (visited.has(current.id)) {
        throw new SessionError('invalid_entry', `Session branch contains a cycle at ${current.id}`);
      }
      visited.add(current.id);
      yield current;
      if (
        current.id === bounds?.stopAtId ||
        current.type === bounds?.stopAtType ||
        current.parentId === null
      ) {
        break;
      }
      const parentId: string = current.parentId;
      current = this.entriesById.get(parentId);
      if (!current) throw new SessionError('invalid_entry', `Entry not found: ${parentId}`);
    }
  }

  private matchesEntryQuery(entry: Entry, query: EntryQuery): boolean {
    return (
      (query.type === undefined || entry.type === query.type) &&
      (query.customType === undefined ||
        (entry.type === 'custom' && entry.customType === query.customType)) &&
      (query.cursor === undefined ||
        (query.order === 'oldestFirst'
          ? entry.seq > query.cursor.afterSeq
          : entry.seq < query.cursor.afterSeq))
    );
  }

  private matchesRecordQuery(record: LaneRecord, query: RecordQuery): boolean {
    return (
      (query.lane === undefined || record.lane === query.lane) &&
      (query.type === undefined || record.type === query.type) &&
      (query.runId === undefined ||
        (record.type === 'operation_started'
          ? record.id === query.runId
          : 'runId' in record && record.runId === query.runId)) &&
      (query.operationKind === undefined ||
        (record.type === 'operation_started' && record.intent.kind === query.operationKind)) &&
      (query.afterSeq === undefined || record.seq > query.afterSeq)
    );
  }
}

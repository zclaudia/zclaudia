import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import type { MessageEntry, ProvisionedEntry } from '@earendil-works/pi-agent-core';
import { SqliteSessionStorage } from '../sqlite-session-storage.js';
import { MAIN_LANE } from '../session-state.js';
import { makeSessionDb } from './fixture.js';

/**
 * 0.84 provisions entries: the caller supplies the id and payload, storage
 * supplies parentId / seq / timestamp.
 */
function userEntry(id: string, text: string): ProvisionedEntry<MessageEntry> {
  return {
    type: 'message',
    id,
    message: { role: 'user', content: text } as MessageEntry['message'],
  };
}

describe('SqliteSessionStorage', () => {
  let db: Database.Database;
  let storage: SqliteSessionStorage;
  beforeEach(() => {
    db = makeSessionDb();
    storage = new SqliteSessionStorage(db, 's1');
  });

  it('appendEntry + getEntry round-trips a typed entry', async () => {
    const appended = await storage.appendEntry(userEntry('e1', 'hello'), MAIN_LANE);
    expect(appended).toMatchObject({ id: 'e1', type: 'message', parentId: null, seq: 1 });
    expect(await storage.getEntry('e1')).toMatchObject({ id: 'e1', type: 'message' });
  });

  it('stamps parentId from the lane leaf and a monotonic seq', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    const second = await storage.appendEntry(userEntry('e2', 'b'), MAIN_LANE);
    expect(second.parentId).toBe('e1');
    expect(second.seq).toBe(2);
  });

  it('starts with a main lane pointing at nothing and advances it on append', async () => {
    expect(await storage.getLanes()).toEqual([{ lane: MAIN_LANE, leafId: null }]);
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    expect(await storage.getLanes()).toEqual([{ lane: MAIN_LANE, leafId: 'e1' }]);
  });

  it('moveLane repoints the lane and rejects an unknown target', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.appendEntry(userEntry('e2', 'b'), MAIN_LANE);
    await storage.moveLane(MAIN_LANE, 'e1');
    expect(await storage.getLeafId()).toBe('e1');
    await expect(storage.moveLane(MAIN_LANE, 'nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('moveLane(null) resets the lane to empty', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.moveLane(MAIN_LANE, null);
    expect(await storage.getLeafId()).toBeNull();
  });

  it('appending after a move branches from the new leaf', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.appendEntry(userEntry('e2', 'b'), MAIN_LANE);
    await storage.moveLane(MAIN_LANE, 'e1');
    const branched = await storage.appendEntry(userEntry('e3', 'c'), MAIN_LANE);
    expect(branched.parentId).toBe('e1');
    // e2 is still there — branching does not delete the abandoned path.
    expect(await storage.getEntry('e2')).toBeDefined();
  });

  it('rejects a duplicate entry id', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await expect(storage.appendEntry(userEntry('e1', 'again'), MAIN_LANE)).rejects.toMatchObject({
      code: 'already_exists',
    });
  });

  it('rejects an append to an unknown lane', async () => {
    await expect(storage.appendEntry(userEntry('e1', 'a'), 'nope')).rejects.toMatchObject({
      code: 'invalid_lane',
    });
  });

  it('getActivePath returns root→leaf', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.appendEntry(userEntry('e2', 'b'), MAIN_LANE);
    await storage.appendEntry(userEntry('e3', 'c'), MAIN_LANE);
    expect((await storage.getActivePath()).map(e => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('getActivePath is empty while the lane points at nothing', async () => {
    expect(await storage.getActivePath()).toEqual([]);
  });

  it('findEntriesOnBranch stops at a bound and excludes the abandoned branch', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.appendEntry(userEntry('e2', 'b'), MAIN_LANE);
    await storage.moveLane(MAIN_LANE, 'e1');
    await storage.appendEntry(userEntry('e3', 'c'), MAIN_LANE);

    const branch = await storage.findEntriesOnBranch({ start: 'e3', order: 'oldestFirst' });
    expect(branch.map(e => e.id)).toEqual(['e1', 'e3']);

    const bounded = await storage.findEntriesOnBranch({ start: 'e3', stopAtId: 'e3' });
    expect(bounded.map(e => e.id)).toEqual(['e3']);
  });

  it('findEntries filters by type', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.appendEntry(
      { type: 'custom', id: 'c1', customType: 'note' },
      MAIN_LANE
    );
    expect((await storage.findEntries({ type: 'message' })).map(e => e.id)).toEqual(['e1']);
    expect((await storage.findEntries({ customType: 'note' })).map(e => e.id)).toEqual(['c1']);
  });

  it('setLabel / getLabel keeps the latest label and rejects an unknown target', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.setLabel('e1', 'first');
    await storage.setLabel('e1', 'second');
    expect(await storage.getLabel('e1')).toBe('second');
    await storage.setLabel('e1', undefined);
    expect(await storage.getLabel('e1')).toBeUndefined();
    await expect(storage.setLabel('nope', 'x')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('setName / getName round-trips', async () => {
    expect(await storage.getName()).toBeUndefined();
    await storage.setName('triage');
    expect(await storage.getName()).toBe('triage');
  });

  it('records share the entries sequence and report open operations', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    const started = await storage.appendRecord({
      type: 'operation_started',
      id: 'r1',
      lane: MAIN_LANE,
      sourceLeafId: 'e1',
      intent: { kind: 'run', originalPrompt: [], initialMessages: [] },
    });
    expect(started.seq).toBe(2);
    expect((await storage.findOpenOperations(MAIN_LANE)).map(r => r.id)).toEqual(['r1']);

    await storage.appendRecord({
      type: 'operation_finished',
      id: 'r2',
      lane: MAIN_LANE,
      runId: 'r1',
      outcome: 'completed',
    });
    expect(await storage.findOpenOperations(MAIN_LANE)).toEqual([]);
  });

  it('refuses a second open operation on the same lane', async () => {
    const open = {
      type: 'operation_started' as const,
      lane: MAIN_LANE,
      sourceLeafId: null,
      intent: { kind: 'run' as const, originalPrompt: [], initialMessages: [] },
    };
    await storage.appendRecord({ ...open, id: 'r1' });
    await expect(storage.appendRecord({ ...open, id: 'r2' })).rejects.toMatchObject({
      code: 'storage',
    });
  });

  it('getLog replays entries, lane moves and facts in one sequence', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.setName('triage');
    await storage.moveLane(MAIN_LANE, null);

    const log = await storage.getLog();
    expect(log.map(item => item.kind)).toEqual(['entry', 'fact', 'lane']);
    expect(log.map(item => item.seq)).toEqual([1, 2, 3]);
    expect(await storage.getLog({ afterSeq: 2 })).toHaveLength(1);
  });

  it('survives a reopen — state is rebuilt from the persisted log', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.appendEntry(userEntry('e2', 'b'), MAIN_LANE);
    await storage.setLabel('e1', 'start');
    await storage.setName('triage');

    const reopened = new SqliteSessionStorage(db, 's1');
    expect(await reopened.getLeafId()).toBe('e2');
    expect(await reopened.getLabel('e1')).toBe('start');
    expect(await reopened.getName()).toBe('triage');
    expect((await reopened.getActivePath()).map(e => e.id)).toEqual(['e1', 'e2']);
  });

  it('counts messages and accumulates usage into stats', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.appendRecord({
      type: 'usage',
      id: 'u1',
      lane: MAIN_LANE,
      cause: 'adjustment',
      usage: {
        input: 10,
        output: 5,
        cacheRead: 3,
        cacheWrite: 2,
        totalTokens: 20,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 },
      },
    });
    expect(await storage.getStats()).toMatchObject({
      messageCount: 1,
      cachedTokens: 3,
      uncachedTokens: 12,
      totalTokens: 20,
      costTotal: 0.5,
    });
  });

  it('getMetadata returns an epoch createdAt and throws when the session is missing', async () => {
    expect(await storage.getMetadata()).toEqual({ id: 's1', createdAt: 1000 });
    await expect(new SqliteSessionStorage(db, 'missing').getMetadata()).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('getEntry returns undefined for a missing id', async () => {
    expect(await storage.getEntry('nope')).toBeUndefined();
  });

  it('fails loudly when a stored row disagrees with the mutation it holds', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    // Replay reads the sequence off the mutation but orders by the column, so
    // the two disagreeing would apply rows in an order the sequence does not
    // describe.
    db.prepare('UPDATE session_log SET seq = 5 WHERE seq = 1').run();
    await expect(new SqliteSessionStorage(db, 's1').getLanes()).rejects.toThrow(/corrupt/);
  });

  it('fails loudly when a mutation is missing from the log', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    await storage.appendEntry(userEntry('e2', 'b'), MAIN_LANE);
    db.prepare('DELETE FROM session_log WHERE seq = 1').run();
    // A gap would otherwise replay as a session that silently lost its head.
    await expect(new SqliteSessionStorage(db, 's1').getLanes()).rejects.toThrow(/corrupt/);
  });

  it('round-trips a compaction entry with its retained tail', async () => {
    await storage.appendEntry(userEntry('e1', 'a'), MAIN_LANE);
    const retainedTail = [{ role: 'user', content: 'kept' }] as MessageEntry['message'][];
    await storage.appendEntry(
      {
        type: 'compaction',
        id: 'k1',
        summary: 'summary text',
        retainedTail,
        tokensBefore: 1234,
        details: { source: 'manual' },
      },
      MAIN_LANE
    );
    expect(await storage.getEntry('k1')).toMatchObject({
      type: 'compaction',
      summary: 'summary text',
      tokensBefore: 1234,
      retainedTail,
      details: { source: 'manual' },
    });
  });
});

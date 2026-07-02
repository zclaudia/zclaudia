// server/src/application/conversation/handlers/__tests__/run.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleRunSteer } from '../run.js';
import type { ActiveRun } from '../../transport/types.js';

function makeClient() {
  const sent: unknown[] = [];
  return {
    sent,
    client: {
      ws: {
        readyState: 1,
        send: (msg: string) => {
          sent.push(JSON.parse(msg));
        },
      },
    } as never,
  };
}

describe('handleRunSteer', () => {
  let activeRuns: Map<string, ActiveRun>;
  let broadcastMock: ReturnType<typeof vi.fn>;
  let steerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    broadcastMock = vi.fn();
    steerSpy = vi.fn();
    activeRuns = new Map();
  });

  it('forwards content to steerHandle, pushes pendingSteers, broadcasts message_appended', async () => {
    const { client, sent } = makeClient();
    activeRuns.set('r1', {
      runId: 'r1',
      sessionId: 's1',
      completed: false,
      steerHandle: { steer: steerSpy },
      pendingSteers: [],
    } as never);
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: '  also fix typo  ' },
      activeRuns,
      broadcastMock
    );
    expect(steerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: 'also fix typo' }],
        timestamp: expect.any(Number),
      })
    );
    expect(activeRuns.get('r1')!.pendingSteers).toHaveLength(1);
    expect(broadcastMock).toHaveBeenCalledWith(
      activeRuns.get('r1'),
      expect.objectContaining({
        type: 'message_appended',
        sessionId: 's1',
        runId: 'r1',
        role: 'user',
        content: 'also fix typo',
        steered: true,
      })
    );
    expect(sent).toHaveLength(0);
  });

  it('rejects empty content', async () => {
    const { client, sent } = makeClient();
    activeRuns.set('r1', {
      runId: 'r1',
      sessionId: 's1',
      completed: false,
      steerHandle: { steer: steerSpy },
      pendingSteers: [],
    } as never);
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: '   ' },
      activeRuns,
      broadcastMock
    );
    expect(steerSpy).not.toHaveBeenCalled();
    expect(broadcastMock).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'error', code: 'STEER_EMPTY' });
  });

  it('rejects unknown runId', async () => {
    const { client, sent } = makeClient();
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r-nope', content: 'x' },
      activeRuns,
      broadcastMock
    );
    expect(steerSpy).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'error', code: 'STEER_NO_ACTIVE_RUN' });
  });

  it('rejects when steerHandle not yet registered', async () => {
    const { client, sent } = makeClient();
    activeRuns.set('r1', {
      runId: 'r1',
      sessionId: 's1',
      completed: false,
      pendingSteers: [],
    } as never);
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: 'x' },
      activeRuns,
      broadcastMock
    );
    expect(steerSpy).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'error', code: 'STEER_NOT_READY' });
  });

  it('rejects when run is already completed', async () => {
    const { client, sent } = makeClient();
    activeRuns.set('r1', {
      runId: 'r1',
      sessionId: 's1',
      phase: 'completed',
      steerHandle: { steer: steerSpy },
      pendingSteers: [],
    } as never);
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: 'x' },
      activeRuns,
      broadcastMock
    );
    expect(steerSpy).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'error', code: 'STEER_NO_ACTIVE_RUN' });
  });

  it('returns STEER_FAILED when steerHandle.steer throws', async () => {
    const { client, sent } = makeClient();
    const throwingSteer = vi.fn().mockImplementation(() => {
      throw new Error('queue closed');
    });
    activeRuns.set('r1', {
      runId: 'r1',
      sessionId: 's1',
      completed: false,
      steerHandle: { steer: throwingSteer },
      pendingSteers: [],
    } as never);
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: 'x' },
      activeRuns,
      broadcastMock
    );
    expect(throwingSteer).toHaveBeenCalled();
    expect(activeRuns.get('r1')!.pendingSteers).toHaveLength(0); // not pushed
    expect(broadcastMock).not.toHaveBeenCalled(); // not broadcast
    expect(sent[0]).toMatchObject({ type: 'error', code: 'STEER_FAILED' });
  });
});

describe('handleRunSteer — persistence', () => {
  /**
   * Mock DB (no native binding needed) that records every prepared statement
   * and its bound args. `transaction(fn)` runs `fn` immediately so the wrapped
   * persistence block executes synchronously during the test.
   */
  function makeMockDb() {
    const stmts: { sql: string; args: unknown[] }[] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        // Offset query for getNextOffset.
        get: vi.fn((...args: unknown[]) => {
          if (sql.includes('COALESCE(MAX(offset)')) {
            stmts.push({ sql, args });
            return { next: 5 };
          }
          // session_leaf leaf read inside appendMessagesToTree.
          if (sql.includes('FROM session_leaf')) {
            stmts.push({ sql, args });
            return undefined;
          }
          stmts.push({ sql, args });
          return undefined;
        }),
        run: vi.fn((...args: unknown[]) => {
          stmts.push({ sql, args });
          return { changes: 1 };
        }),
        all: vi.fn((...args: unknown[]) => {
          stmts.push({ sql, args });
          return [];
        }),
      })),
      transaction: vi.fn(
        <T>(fn: (...a: unknown[]) => T) =>
          (...args: unknown[]) =>
            fn(...args)
      ),
      __stmts: stmts,
    };
    return mockDb;
  }

  /** Builds an ActiveRun wired to the mock DB. */
  function makeRun(
    db: ReturnType<typeof makeMockDb>,
    overrides: Partial<ActiveRun> = {}
  ): ActiveRun {
    return {
      runId: 'r1',
      sessionId: 's1',
      phase: 'running',
      steerHandle: { steer: vi.fn() },
      pendingSteers: [],
      db: db as unknown as ActiveRun['db'],
      ...overrides,
    } as never as ActiveRun;
  }

  it('persists the steered user message row + tree turn, and broadcasts the message', async () => {
    const { client } = makeClient();
    const db = makeMockDb();
    const steerSpy = vi.fn();
    const broadcastMock = vi.fn();
    const activeRuns = new Map<string, ActiveRun>();
    activeRuns.set('r1', makeRun(db, { steerHandle: { steer: steerSpy } }));

    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: 'fix the typo too' },
      activeRuns,
      broadcastMock
    );

    // steer was accepted first (persistence only happens after a successful steer).
    expect(steerSpy).toHaveBeenCalledTimes(1);

    // messages-table INSERT for the user message. Note `'user'` is a SQL literal
    // (VALUES (?, ?, 'user', ...)), so only id/sessionId/content/metadata/time/offset
    // arrive as bound args.
    const insertCall = db.__stmts.find(s => s.sql.includes('INSERT INTO messages'));
    expect(insertCall).toBeTruthy();
    expect(insertCall!.sql).toContain("'user'");
    const [id, , content, metadataJson, createdAt] = insertCall!.args;
    expect(content).toBe('fix the typo too');
    expect(createdAt).toEqual(expect.any(Number));
    expect(JSON.parse(metadataJson as string)).toEqual({ steered: true });
    // Id is the client's optimistic stableId (steer-<runId>-<timestamp>) so the
    // later history-sync dedup lands on the same row instead of a duplicate.
    expect(id).toBe(`steer-r1-${createdAt}`);

    // session-tree was appended (session_entries write + leaf advance).
    const treeWrite = db.__stmts.find(s => s.sql.includes('INSERT INTO session_entries'));
    expect(treeWrite).toBeTruthy();

    // messages row back-linked to the tree entry.
    const treeLink = db.__stmts.find(s => s.sql.includes('UPDATE messages SET tree_entry_id'));
    expect(treeLink).toBeTruthy();

    // The steered message was broadcast so every client renders it immediately.
    expect(broadcastMock).toHaveBeenCalledWith(
      activeRuns.get('r1'),
      expect.objectContaining({
        type: 'message_appended',
        role: 'user',
        content: 'fix the typo too',
        steered: true,
      })
    );
  });

  it('does NOT persist when steer is rejected, even with a DB attached', async () => {
    const { client } = makeClient();
    const db = makeMockDb();
    const activeRuns = new Map<string, ActiveRun>();
    // terminal phase → STEER_NO_ACTIVE_RUN, before any DB write.
    activeRuns.set('r1', makeRun(db, { phase: 'completed' }));

    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: 'x' },
      activeRuns,
      vi.fn()
    );

    expect(db.__stmts.find(s => s.sql.includes('INSERT INTO messages'))).toBeUndefined();
    expect(db.__stmts.find(s => s.sql.includes('INSERT INTO session_entries'))).toBeUndefined();
  });

  it('keeps steer ids unique when two steers land in the same millisecond', async () => {
    const { client } = makeClient();
    const db = makeMockDb();
    const activeRuns = new Map<string, ActiveRun>();
    const run = makeRun(db);
    activeRuns.set('r1', run);

    // Freeze the wall clock so both steers would otherwise derive the same id.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      await handleRunSteer(
        client,
        { type: 'run_steer', runId: 'r1', content: 'first' },
        activeRuns,
        vi.fn()
      );
      await handleRunSteer(
        client,
        { type: 'run_steer', runId: 'r1', content: 'second' },
        activeRuns,
        vi.fn()
      );
    } finally {
      nowSpy.mockRestore();
    }

    const ids = db.__stmts.filter(s => s.sql.includes('INSERT INTO messages')).map(s => s.args[0]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    // Second id is bumped one ms past the first so the PRIMARY KEY can't collide.
    expect(ids[0]).toBe('steer-r1-1000');
    expect(ids[1]).toBe('steer-r1-1001');
  });
});

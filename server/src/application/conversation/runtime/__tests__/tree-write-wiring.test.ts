import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { Session, buildSessionContext } from '@earendil-works/pi-agent-core';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { SqliteSessionStorage } from '../../../../infra/providers/pi-runtime/session-tree/sqlite-session-storage.js';
import { upsertAssistantMessage } from '../run-lifecycle.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  applyMigrations(db);
  // Disable FK enforcement to insert a minimal session row without needing
  // real project/agent_profile rows (test-only shortcut, mirrors worktree-tools.test.ts).
  db.pragma('foreign_keys = OFF');
  db.prepare(
    `INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run('s1', 'p1', 'ap1', 1, 1);
  db.pragma('foreign_keys = ON');
  return db;
}

function fakeRun(db: Database.Database): any {
  return {
    db,
    sessionId: 's1',
    assistantMessageId: 'a1',
    fullContent: 'hello world',
    collectedToolCalls: [],
    contentBlocks: [],
    thinkingBlocks: [],
  };
}

describe('Route C tree write wiring (assistant final save)', () => {
  it('appends an assistant entry to the tree on the final save', async () => {
    const db = makeDb();
    const run = fakeRun(db);
    upsertAssistantMessage(run, { indexMetadata: true });
    const ctx = buildSessionContext(await new SqliteSessionStorage(db, 's1').getActivePath());
    expect(ctx.messages.map((m: any) => m.role)).toEqual(['assistant']);
    expect((ctx.messages[0] as any).content.find((b: any) => b.type === 'text').text).toBe(
      'hello world'
    );

    // The assistant messages row must be back-linked to its tree entry id.
    const msgRow = db.prepare('SELECT tree_entry_id FROM messages WHERE id = ?').get('a1') as {
      tree_entry_id: string | null;
    };
    const entryRow = db
      .prepare(
        "SELECT json_extract(payload, '$.entry.id') AS id FROM session_log WHERE session_id = ? AND json_extract(payload, '$.entry.type') = ?"
      )
      .get('s1', 'message') as { id: string } | undefined;
    expect(msgRow.tree_entry_id).toBeTruthy();
    expect(msgRow.tree_entry_id).toBe(entryRow?.id);
  });

  it('is idempotent across repeated final saves (treeTurnAppended guard)', async () => {
    const db = makeDb();
    const run = fakeRun(db);
    upsertAssistantMessage(run, { indexMetadata: true });
    upsertAssistantMessage(run, { indexMetadata: true });
    const entries = await new SqliteSessionStorage(db, 's1').findEntries({ order: 'oldestFirst' });
    const assistantEntries = entries.filter((e: any) => e.type === 'message');
    expect(assistantEntries).toHaveLength(1);
  });

  it("persists the provider's real per-call messages instead of a flattened turn", async () => {
    const db = makeDb();
    const run = fakeRun(db);
    const u1 = { input: 100, output: 5, cacheRead: 900, cacheWrite: 0, totalTokens: 1005 };
    const u2 = { input: 20, output: 7, cacheRead: 1000, cacheWrite: 0, totalTokens: 1027 };
    const call1 = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'look first', thinkingSignature: 'sig-1' },
        { type: 'toolCall', id: 'tc1', name: 'Read', arguments: { file_path: 'a.ts' } },
      ],
      usage: u1,
      stopReason: 'toolUse',
      model: 'm',
      timestamp: 1,
    };
    const call2 = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello world' }],
      usage: u2,
      stopReason: 'stop',
      model: 'm',
      timestamp: 3,
    };
    run.providerTurnMessages = [
      // The prompt (and any steer) is already in the tree — never re-appended.
      { role: 'user', content: 'go', timestamp: 0 },
      call1,
      {
        role: 'toolResult',
        toolCallId: 'tc1',
        toolName: 'Read',
        content: [{ type: 'text', text: 'file body' }],
        isError: false,
        details: { huge: 'ui-only payload' },
        timestamp: 2,
      },
      call2,
    ];
    upsertAssistantMessage(run, { indexMetadata: true });

    const path = await new SqliteSessionStorage(db, 's1').getActivePath();
    const ctx = buildSessionContext(path);
    expect(ctx.messages.map((m: any) => m.role)).toEqual(['assistant', 'toolResult', 'assistant']);
    // Byte-faithful: the rebuilt history is what the provider saw.
    expect(ctx.messages[0]).toEqual(call1);
    expect(ctx.messages[2]).toEqual(call2);
    // UI-only tool details never reach the provider and stay out of the tree.
    expect((ctx.messages[1] as any).details).toBeUndefined();
    expect((ctx.messages[1] as any).content).toEqual([{ type: 'text', text: 'file body' }]);

    // The UI row links to the turn's last assistant entry (fork/branch keep the whole turn).
    const msgRow = db.prepare('SELECT tree_entry_id FROM messages WHERE id = ?').get('a1') as {
      tree_entry_id: string;
    };
    expect(msgRow.tree_entry_id).toBe(path[path.length - 1].id);
  });

  it('falls back to the flattened turn when the runtime reported no assistant message', async () => {
    const db = makeDb();
    const run = fakeRun(db);
    run.providerTurnMessages = [{ role: 'user', content: 'go', timestamp: 0 }];
    upsertAssistantMessage(run, { indexMetadata: true });
    const ctx = buildSessionContext(await new SqliteSessionStorage(db, 's1').getActivePath());
    expect(ctx.messages.map((m: any) => m.role)).toEqual(['assistant']);
  });

  it('does not append on a non-final (periodic) save', async () => {
    const db = makeDb();
    const run = fakeRun(db);
    upsertAssistantMessage(run, {}); // no indexMetadata
    const entries = await new SqliteSessionStorage(db, 's1').findEntries({ order: 'oldestFirst' });
    expect(entries).toHaveLength(0);
  });
});

describe('upsertAssistantMessage — model in metadata', () => {
  function persistedMetadata(db: Database.Database): Record<string, unknown> {
    const row = db.prepare('SELECT metadata FROM messages WHERE id = ?').get('a1') as {
      metadata: string | null;
    };
    expect(row.metadata).toBeTruthy();
    return JSON.parse(row.metadata!);
  }

  it('records run.agentProfile.model on the persisted metadata', () => {
    const db = makeDb();
    const run = fakeRun(db);
    run.agentProfile = { model: 'claude-sonnet-4-5' };
    upsertAssistantMessage(run, { usage: { inputTokens: 1, outputTokens: 2 } as never });
    expect(persistedMetadata(db).model).toBe('claude-sonnet-4-5');
  });

  it('omits model when agentProfile is undefined', () => {
    const db = makeDb();
    const run = fakeRun(db); // no agentProfile
    upsertAssistantMessage(run, { usage: { inputTokens: 1, outputTokens: 2 } as never });
    expect('model' in persistedMetadata(db)).toBe(false);
  });
});

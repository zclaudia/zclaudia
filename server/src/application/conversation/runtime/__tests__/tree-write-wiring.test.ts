import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { Session } from '@earendil-works/pi-agent-core';
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
    const ctx = await new Session(new SqliteSessionStorage(db, 's1')).buildContext();
    expect(ctx.messages.map((m: any) => m.role)).toEqual(['assistant']);
    expect((ctx.messages[0] as any).content.find((b: any) => b.type === 'text').text).toBe(
      'hello world'
    );

    // The assistant messages row must be back-linked to its session_entries id.
    const msgRow = db.prepare('SELECT tree_entry_id FROM messages WHERE id = ?').get('a1') as {
      tree_entry_id: string | null;
    };
    const entryRow = db
      .prepare('SELECT id FROM session_entries WHERE session_id = ? AND type = ?')
      .get('s1', 'message') as { id: string } | undefined;
    expect(msgRow.tree_entry_id).toBeTruthy();
    expect(msgRow.tree_entry_id).toBe(entryRow?.id);
  });

  it('is idempotent across repeated final saves (treeTurnAppended guard)', async () => {
    const db = makeDb();
    const run = fakeRun(db);
    upsertAssistantMessage(run, { indexMetadata: true });
    upsertAssistantMessage(run, { indexMetadata: true });
    const entries = await new SqliteSessionStorage(db, 's1').getEntries();
    const assistantEntries = entries.filter((e: any) => e.type === 'message');
    expect(assistantEntries).toHaveLength(1);
  });

  it('does not append on a non-final (periodic) save', async () => {
    const db = makeDb();
    const run = fakeRun(db);
    upsertAssistantMessage(run, {}); // no indexMetadata
    const entries = await new SqliteSessionStorage(db, 's1').getEntries();
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

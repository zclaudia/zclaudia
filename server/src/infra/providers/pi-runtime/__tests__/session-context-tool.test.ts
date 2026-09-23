import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import {
  appendMessagesToTree,
  buildAssistantTurnMessages,
  buildUserMessage,
} from '../session-tree/write-path.js';
import { createReadSessionContextTool, renderTranscript } from '../session-context-tool.js';

function seed(db: Database.Database) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO agent_profiles (id, name, description, runtime_type, llm_profile_id, system_prompt, enabled_tools, is_default, status, source, created_at, updated_at)
     VALUES ('prof', 'Default', '', 'pi', NULL, '', '[]', 1, 'active', 'user', ?, ?)`
  ).run(now, now);
  for (const project of ['proj', 'other']) {
    db.prepare(
      `INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run(project, project, `/tmp/${project}`, now, now);
  }
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, project_id, agent_profile_id, name, type, created_at, updated_at)
     VALUES (?, ?, 'prof', ?, 'regular', ?, ?)`
  );
  insertSession.run('current', 'proj', 'Current', now, now);
  insertSession.run('sibling', 'proj', 'Sibling', now, now);
  insertSession.run('foreign', 'other', 'Foreign', now, now);
  insertSession.run('empty', 'proj', 'Empty', now, now);

  appendMessagesToTree(db, 'sibling', [buildUserMessage('Please fix the login bug', [])]);
  appendMessagesToTree(
    db,
    'sibling',
    buildAssistantTurnMessages({
      fullContent: 'The bug is in src/auth/login.ts line 42; token expiry is compared in seconds.',
      collectedToolCalls: [],
      thinkingBlocks: [],
    } as never)
  );
}

describe('ReadSessionContext', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    seed(db);
  });

  afterEach(() => db.close());

  it('renders transcripts as role-prefixed lines', () => {
    const rendered = renderTranscript([
      { role: 'user', content: 'hello' } as never,
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } as never,
      {
        role: 'assistant',
        content: [{ type: 'toolCall', name: 'Read', arguments: { path: 'a.ts' } }],
      } as never,
    ]);
    expect(rendered.text).toBe(
      'user: hello\n\nassistant: hi\n\nassistant: [tool Read] {"path":"a.ts"}'
    );
    expect(rendered.truncated).toBe(false);
  });

  it('extracts relevant context from a sibling session with the auxiliary model', async () => {
    const complete = vi.fn(
      async ({ userText, systemPrompt }: { userText: string; systemPrompt: string }) => {
        expect(systemPrompt).toContain('NO_RELEVANT_CONTEXT');
        expect(userText).toContain('QUERY:\nwhere is the login bug');
        expect(userText).toContain('src/auth/login.ts line 42');
        return '- Bug: src/auth/login.ts:42 compares expiry in seconds';
      }
    );
    const tool = createReadSessionContextTool({
      sessionId: 'current',
      db,
      auxiliaryModel: { complete },
    }) as any;
    const res = await tool.execute('r1', {
      session_id: 'sibling',
      query: 'where is the login bug',
    });
    expect(JSON.parse(res.content[0].text)).toMatchObject({
      status: 'ok',
      source: 'model',
      strategy: 'relevant',
      sessionId: 'sibling',
      sessionName: 'Sibling',
      messageCount: 2,
      content: '- Bug: src/auth/login.ts:42 compares expiry in seconds',
    });
  });

  it('reports no_relevant_context and uses the handoff prompt on request', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce('NO_RELEVANT_CONTEXT')
      .mockImplementationOnce(async ({ systemPrompt }: { systemPrompt: string }) => {
        expect(systemPrompt).toContain('handoff capsule');
        return '## Goal\nfix login';
      });
    const tool = createReadSessionContextTool({
      sessionId: 'current',
      db,
      auxiliaryModel: { complete },
    }) as any;
    const none = await tool.execute('r2', { session_id: 'sibling', query: 'unrelated' });
    expect(JSON.parse(none.content[0].text)).toMatchObject({
      status: 'no_relevant_context',
      content: '',
    });
    const handoff = await tool.execute('r3', {
      session_id: 'sibling',
      query: 'continue',
      strategy: 'handoff',
    });
    expect(JSON.parse(handoff.content[0].text)).toMatchObject({
      status: 'ok',
      strategy: 'handoff',
      content: '## Goal\nfix login',
    });
  });

  it('falls back to the raw transcript tail without an auxiliary model', async () => {
    const tool = createReadSessionContextTool({ sessionId: 'current', db }) as any;
    const res = await tool.execute('r4', { session_id: 'sibling', query: 'anything' });
    const body = JSON.parse(res.content[0].text);
    expect(body).toMatchObject({ status: 'ok', source: 'local', messageCount: 2 });
    expect(body.content).toContain('user: Please fix the login bug');
    expect(body.content).toContain('src/auth/login.ts line 42');
  });

  it('enforces the project boundary and validates input', async () => {
    const tool = createReadSessionContextTool({
      sessionId: 'current',
      db,
      auxiliaryModel: { complete: vi.fn() },
    }) as any;
    expect((await tool.execute('r5', { session_id: 'foreign', query: 'q' })).details).toMatchObject(
      {
        ok: false,
        error: 'session_not_accessible',
      }
    );
    expect((await tool.execute('r6', { session_id: 'missing', query: 'q' })).details).toMatchObject(
      {
        ok: false,
        error: 'session_not_found',
      }
    );
    expect((await tool.execute('r7', { session_id: 'sibling', query: '' })).details).toMatchObject({
      ok: false,
      error: 'missing_query',
    });
    const empty = await tool.execute('r8', { session_id: 'empty', query: 'q' });
    expect(JSON.parse(empty.content[0].text)).toMatchObject({ status: 'empty', messageCount: 0 });
  });
});

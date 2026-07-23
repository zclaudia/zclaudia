import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { AgentProfileRepository } from '../../../../domains/agent-profiles/repository.js';
import { LlmProfileRepository } from '../../../../domains/llm-profiles/repository.js';
import { ProjectRepository } from '../../../../domains/projects/repository.js';
import { SessionMessageRepository } from '../../../../domains/sessions/message-repository.js';
import { requestSessionTitleGeneration } from '../request-session-title.js';

// requestSessionTitleGeneration delegates to the fire-and-forget title service;
// flush microtasks before asserting on its async effects.
const flush = () => new Promise(r => setImmediate(r));

describe('requestSessionTitleGeneration', () => {
  let db: Database.Database;
  let sessionId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);

    const llm = new LlmProfileRepository(db).create({
      name: 'test-llm',
      providerType: 'anthropic',
      apiKey: 'sk-test',
    });
    const agentId = new AgentProfileRepository(db).create({
      name: 'Global Default',
      llmProfileId: llm.id,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
      isDefault: true,
    }).id;
    const projectId = new ProjectRepository(db).create({
      name: 'p1',
      type: 'code',
      sortOrder: 0,
    }).id;

    sessionId = 's1';
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at)
       VALUES (?, ?, ?, 'regular', 100, 100)`
    ).run(sessionId, projectId, agentId);
    new SessionMessageRepository(db).create({
      id: 'm1',
      sessionId,
      role: 'user',
      content: 'what does this project do',
      createdAt: 1,
    });
  });

  it('resolves the session agent/llm, generates a title, and broadcasts the update', async () => {
    const broadcast = vi.fn();
    const generate = vi.fn().mockResolvedValue('Project Overview');
    requestSessionTitleGeneration({ db, sessionId, broadcast, generate });
    await flush();

    const row = db.prepare('SELECT auto_title FROM sessions WHERE id = ?').get(sessionId) as {
      auto_title: string;
    };
    expect(row.auto_title).toBe('Project Overview');
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sessions_updated',
        session: expect.objectContaining({ id: sessionId, autoTitle: 'Project Overview' }),
      })
    );
  });

  it('is a no-op for an unknown session', async () => {
    const broadcast = vi.fn();
    const generate = vi.fn();
    requestSessionTitleGeneration({ db, sessionId: 'nope', broadcast, generate });
    await flush();
    expect(generate).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('no-ops without throwing when the session has no resolvable LLM profile', async () => {
    const broadcast = vi.fn();
    const generate = vi.fn();
    expect(() =>
      requestSessionTitleGeneration({
        db,
        sessionId,
        broadcast,
        generate,
        resolve: () => ({ agent: { model: 'm' } as never, llm: undefined }),
      })
    ).not.toThrow();
    await flush();
    expect(generate).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});

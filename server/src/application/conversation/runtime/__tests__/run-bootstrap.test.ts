import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeRunBootstrap } from '../run-bootstrap.js';

interface CreateDbOptions {
  insertProfile?: boolean;
  profileIsDefault?: boolean;
  apiKey?: string | null;
  baseUrl?: string | null;
  env?: string | null;
  sessionProfileId?: string | null;
}

function createDb(providerType: string, options: CreateDbOptions = {}): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE llm_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'anthropic',
      base_url TEXT,
      api_key TEXT,
      compat TEXT,
      env TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      llm_profile_id TEXT,
      root_path TEXT,
      system_prompt TEXT
    );

    CREATE TABLE agent_profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      llm_profile_id TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      sdk_session_id TEXT,
      type TEXT,
      working_directory TEXT,
      project_role TEXT,
      plan_status TEXT,
      task_id TEXT,
      agent_profile_id TEXT,
      last_run_status TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      offset INTEGER
    );

    CREATE TABLE permission_memories (
      session_id TEXT,
      remember_key TEXT,
      decision TEXT
    );

    CREATE TABLE permission_outside_workspace_roots (
      project_id TEXT,
      allowed_root TEXT
    );
  `);

  const now = Date.now();
  const insertProfile = options.insertProfile !== false;
  const sessionProfileId = options.sessionProfileId === null
    ? null
    : options.sessionProfileId ?? (insertProfile ? 'provider-1' : null);

  if (insertProfile) {
    db.prepare(`
      INSERT INTO llm_profiles (id, name, provider_type, base_url, api_key, env, is_default, created_at, updated_at)
      VALUES ('provider-1', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      providerType,
      providerType,
      options.baseUrl ?? null,
      options.apiKey ?? null,
      options.env ?? null,
      options.profileIsDefault ? 1 : 0,
      now,
      now,
    );
  }

  db.prepare(`
    INSERT INTO projects (id, llm_profile_id, root_path, system_prompt)
    VALUES ('project-1', NULL, '/tmp/project', NULL)
  `).run();

  // Seed an agent_profile that points at sessionProfileId (the llm_profile under test)
  // so the session → agent_profile → llm_profile lookup chain works in run-bootstrap.
  if (sessionProfileId) {
    db.prepare(`
      INSERT INTO agent_profiles (id, name, llm_profile_id, is_default, created_at, updated_at)
      VALUES ('agent-1', 'Test Agent', ?, 1, ?, ?)
    `).run(sessionProfileId, now, now);
  }
  const sessionAgentId = sessionProfileId ? 'agent-1' : null;

  db.prepare(`
    INSERT INTO sessions (
      id, project_id, name, sdk_session_id, type, working_directory,
      project_role, plan_status, task_id, agent_profile_id, created_at, updated_at
    )
    VALUES (
      'session-1', 'project-1', 'Test Session', 'sdk-existing', 'regular', '/tmp/project',
      NULL, NULL, NULL, ?, ?, ?
    )
  `).run(sessionAgentId, now, now);

  return db;
}

function bootstrap(providerType: string, mode: string, dbOptions: CreateDbOptions = {}) {
  const activeRuns = new Map();
  return initializeRunBootstrap({
    activeRuns,
    client: {
      id: 'client-1',
      ws: {} as any,
      isAlive: true,
      isLocal: true,
      authenticated: true,
    },
    db: createDb(providerType, dbOptions) as any,
    message: {
      type: 'run_start',
      clientRequestId: 'req-1',
      sessionId: 'session-1',
      input: 'hello',
      mode,
    },
    runId: 'run-1',
    trace: {
      log: vi.fn(),
      setMeta: vi.fn(),
    } as any,
  });
}

describe('initializeRunBootstrap mode/session policy', () => {
  it('preserves zclaudia sdk_session_id across mode switches (preserve policy)', () => {
    const result = bootstrap('zclaudia', 'plan');

    expect(result?.providerConfig?.providerType).toBe('zclaudia');
    expect(result?.providerEventState.sdkSessionId).toBe('sdk-existing');
  });

  it('preserves sdk_session_id when staying in the default mode', () => {
    const result = bootstrap('zclaudia', 'default');

    expect(result?.providerConfig?.providerType).toBe('zclaudia');
    expect(result?.providerEventState.sdkSessionId).toBe('sdk-existing');
  });
});

describe('initializeRunBootstrap LLM profile resolution', () => {
  it('resolves session.llm_profile_id into a full LlmProfileConfig (id, providerType, baseUrl, apiKey)', () => {
    const result = bootstrap('anthropic', 'default', {
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
    });

    expect(result?.llmProfileId).toBe('provider-1');
    expect(result?.providerConfig).toBeDefined();
    expect(result?.providerConfig?.id).toBe('provider-1');
    expect(result?.providerConfig?.providerType).toBe('anthropic');
    expect(result?.providerConfig?.apiKey).toBe('sk-test');
    expect(result?.providerConfig?.baseUrl).toBe('https://example.com/v1');
  });

  it('falls back to the default profile when session.llm_profile_id is NULL', () => {
    const result = bootstrap('anthropic', 'default', {
      sessionProfileId: null,
      profileIsDefault: true,
      apiKey: 'sk-default',
    });

    expect(result?.llmProfileId).toBe('provider-1');
    expect(result?.providerConfig?.id).toBe('provider-1');
    expect(result?.providerConfig?.isDefault).toBe(true);
    expect(result?.providerConfig?.apiKey).toBe('sk-default');
  });

  it('leaves providerConfig undefined when no default and session has no profile', () => {
    const result = bootstrap('anthropic', 'default', {
      insertProfile: false,
      sessionProfileId: null,
    });

    expect(result?.llmProfileId).toBeNull();
    expect(result?.providerConfig).toBeUndefined();
  });

  it('falls back to default profile when session.llm_profile_id references a deleted/stale id', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = bootstrap('anthropic', 'default', {
      sessionProfileId: 'nonexistent-profile-id',
      profileIsDefault: true,
      apiKey: 'sk-default',
    });

    expect(result?.providerConfig).toBeDefined();
    expect(result?.providerConfig?.id).toBe('provider-1');
    expect(result?.providerConfig?.isDefault).toBe(true);
    expect(result?.providerConfig?.apiKey).toBe('sk-default');
    expect(result?.llmProfileId).toBe('provider-1');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent-profile-id'));

    warnSpy.mockRestore();
  });
});

import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { buildSkillRuntimeState, initializeRunBootstrap } from '../run-bootstrap.js';
import { createAgentProfilesTable } from '../../../../test-helpers/seed-default-agent.js';

interface CreateDbOptions {
  insertProfile?: boolean;
  profileIsDefault?: boolean;
  apiKey?: string | null;
  baseUrl?: string | null;
  env?: string | null;
  /** llm_profile_id stored on the agent profile. `null` ⇒ agent has no llm_profile_id (forces default fallback). */
  agentLlmProfileId?: string | null;
  /** Override fields on the seeded agent profile. */
  agentSystemPrompt?: string;
  agentEnabledTools?: string[];
  agentToolSelection?: Record<string, unknown>;
  agentSkillSelection?: Record<string, unknown>;
  agentThinkingLevel?: string | null;
  agentModel?: string;
  /** Override the agent.id assigned to the session (default 'agent-1'); use to test stale agent_profile_id. */
  sessionAgentProfileId?: string | null;
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
      metadata TEXT,
      created_at INTEGER NOT NULL,
      offset INTEGER,
      tree_entry_id TEXT
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

    CREATE TABLE session_entries (
      id          TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      parent_id   TEXT,
      type        TEXT NOT NULL,
      payload     TEXT NOT NULL,
      timestamp   TEXT NOT NULL,
      PRIMARY KEY (session_id, id)
    );

    CREATE TABLE session_leaf (
      session_id  TEXT PRIMARY KEY,
      leaf_id     TEXT
    );
  `);
  createAgentProfilesTable(db);

  const now = Date.now();
  const insertProfile = options.insertProfile !== false;
  // Default: agent's llm_profile_id points at the seeded profile (if any). Pass
  // `agentLlmProfileId: null` to force the agent → no llm_profile_id path.
  const agentLlmProfileId =
    options.agentLlmProfileId === null
      ? null
      : (options.agentLlmProfileId ?? (insertProfile ? 'provider-1' : null));

  if (insertProfile) {
    db.prepare(
      `
      INSERT INTO llm_profiles (id, name, provider_type, base_url, api_key, env, is_default, created_at, updated_at)
      VALUES ('provider-1', ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      providerType,
      providerType,
      options.baseUrl ?? null,
      options.apiKey ?? null,
      options.env ?? null,
      options.profileIsDefault ? 1 : 0,
      now,
      now
    );
  }

  db.prepare(
    `
    INSERT INTO projects (id, llm_profile_id, root_path, system_prompt)
    VALUES ('project-1', NULL, '/tmp/project', NULL)
  `
  ).run();

  // T2 schema: sessions.agent_profile_id is NOT NULL with FK RESTRICT. The runtime
  // always resolves session → agent_profile → llm_profile (no per-session llm fallback).
  // Always seed a default agent so the bootstrap chain works.
  db.prepare(
    `
    INSERT INTO agent_profiles (
      id, name, llm_profile_id, model, system_prompt, enabled_tools, tool_selection, skill_selection, thinking_level,
      is_default, created_at, updated_at
    )
    VALUES ('agent-1', 'Test Agent', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `
  ).run(
    agentLlmProfileId,
    options.agentModel ?? 'claude-sonnet-4-6',
    options.agentSystemPrompt ?? '',
    JSON.stringify(
      options.agentEnabledTools ?? ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls']
    ),
    options.agentToolSelection ? JSON.stringify(options.agentToolSelection) : null,
    options.agentSkillSelection ? JSON.stringify(options.agentSkillSelection) : null,
    options.agentThinkingLevel ?? null,
    now,
    now
  );
  // `sessionAgentProfileId` lets a test reference a stale agent id (no row exists
  // for that id) — required for the "stale agent_profile_id fallback" path. Default
  // is the seeded 'agent-1'. Pass `null` to insert a NULL FK (T2 forbids this at
  // schema level, but the in-memory test schema is permissive).
  const sessionAgentId =
    options.sessionAgentProfileId === null ? null : (options.sessionAgentProfileId ?? 'agent-1');

  db.prepare(
    `
    INSERT INTO sessions (
      id, project_id, name, sdk_session_id, type, working_directory,
      project_role, plan_status, task_id, agent_profile_id, created_at, updated_at
    )
    VALUES (
      'session-1', 'project-1', 'Test Session', 'sdk-existing', 'regular', '/tmp/project',
      NULL, NULL, NULL, ?, ?, ?
    )
  `
  ).run(sessionAgentId, now, now);

  return db;
}

function bootstrap(
  providerType: string,
  mode: string,
  dbOptions: CreateDbOptions = {},
  input: string = 'hello'
) {
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
      input,
      mode,
    },
    runId: 'run-1',
    trace: {
      log: vi.fn(),
      setMeta: vi.fn(),
    } as any,
  });
}

function bootstrapWithDb(
  providerType: string,
  mode: string,
  input: string,
  dbOptions: CreateDbOptions = {}
) {
  const db = createDb(providerType, dbOptions);
  const activeRuns = new Map();
  const result = initializeRunBootstrap({
    activeRuns,
    client: {
      id: 'client-1',
      ws: {} as any,
      isAlive: true,
      isLocal: true,
      authenticated: true,
    },
    db: db as any,
    message: {
      type: 'run_start',
      clientRequestId: 'req-1',
      sessionId: 'session-1',
      input,
      mode,
    },
    runId: 'run-1',
    trace: {
      log: vi.fn(),
      setMeta: vi.fn(),
    } as any,
  });
  return { result, db };
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
  it('resolves agent.llm_profile_id into a full LlmProfileConfig (id, providerType, baseUrl, apiKey)', () => {
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

  it('falls back to the default profile when agent.llm_profile_id is NULL', () => {
    const result = bootstrap('anthropic', 'default', {
      agentLlmProfileId: null,
      profileIsDefault: true,
      apiKey: 'sk-default',
    });

    expect(result?.llmProfileId).toBe('provider-1');
    expect(result?.providerConfig?.id).toBe('provider-1');
    expect(result?.providerConfig?.isDefault).toBe(true);
    expect(result?.providerConfig?.apiKey).toBe('sk-default');
  });

  it('leaves providerConfig undefined when no default and agent has no llm_profile_id', () => {
    const result = bootstrap('anthropic', 'default', {
      insertProfile: false,
      agentLlmProfileId: null,
    });

    expect(result?.llmProfileId).toBeNull();
    expect(result?.providerConfig).toBeUndefined();
  });
});

describe('initializeRunBootstrap Agent profile resolution', () => {
  it('resolves session.agent_profile_id and expands fields into bootstrap result', () => {
    const result = bootstrap('anthropic', 'default', {
      apiKey: 'sk-test',
      agentSystemPrompt: 'You are a coder.',
      agentEnabledTools: ['read', 'bash'],
      agentThinkingLevel: 'medium',
      agentModel: 'claude-opus-4-7',
    });

    expect(result?.agentProfile).toBeDefined();
    expect(result?.agentProfile?.id).toBe('agent-1');
    expect(result?.agentProfile?.systemPrompt).toBe('You are a coder.');
    expect(result?.agentProfile?.enabledTools).toEqual(['Read', 'Bash']);
    expect(result?.agentProfile?.thinkingLevel).toBe('medium');
    expect(result?.agentProfile?.model).toBe('claude-opus-4-7');
    expect(result?.enabledTools).toEqual(['Read', 'Bash']);
    expect(result?.providerConfig).toBeDefined();
    expect(result?.providerConfig?.id).toBe('provider-1');
  });

  it('resolves enabled tools from toolSelection when present', () => {
    const result = bootstrap('anthropic', 'default', {
      apiKey: 'sk-test',
      agentEnabledTools: ['read'],
      agentToolSelection: {
        sets: [{ source: 'builtin', id: 'core-coding' }],
        providers: [],
        include: [{ source: 'plugin', pluginId: 'jira', toolId: 'search' }],
        exclude: [{ source: 'builtin', name: 'Bash' }],
      },
    });

    expect(result?.enabledTools).toEqual([
      'Read',
      'Write',
      'Edit',
      'MultiEdit',
      'ReadSymbol',
      'EditSymbol',
      'Eval',
      'Grep',
      'Glob',
      'LS',
      'EnterPlanMode',
      'ExitPlanMode',
      'Memory',
    ]);
    expect(result?.agentProfile.resolvedTools).toContainEqual({
      source: 'plugin',
      pluginId: 'jira',
      toolId: 'search',
    });
  });

  it('hydrates session-scoped external tool state from agent toolSelection', () => {
    const result = bootstrap('anthropic', 'default', {
      apiKey: 'sk-test',
      agentToolSelection: {
        sets: [{ source: 'builtin', id: 'core-coding' }],
        providers: [{ source: 'mcp', serverId: 'github' }],
        include: [{ source: 'mcp', server: 'github', tool: 'search_repositories' }],
        exclude: [],
      },
    });

    expect(result?.activeRun.externalToolState).toEqual({
      discoverableProviders: [{ source: 'mcp', serverId: 'github' }],
      pinnedExternalTools: [{ source: 'mcp', server: 'github', tool: 'search_repositories' }],
      loadedExternalTools: [{ source: 'mcp', server: 'github', tool: 'search_repositories' }],
    });
  });

  it('initializes session-scoped skill runtime state', () => {
    const result = bootstrap('anthropic', 'default', {
      apiKey: 'sk-test',
    });

    expect(result?.activeRun.skillState).toEqual(
      expect.objectContaining({
        discoverableSkills: expect.any(Array),
        pinnedSkills: [],
        loadedSkills: [],
        loadedSkillContents: {},
      })
    );
  });

  it('builds skill runtime state from profile skillSelection', () => {
    const skills = [
      {
        source: 'workspace' as const,
        id: 'guidelines',
        name: 'guidelines',
        description: 'Follow rules',
        filePath: '/skills/guidelines/SKILL.md',
        dirPath: '/skills/guidelines',
      },
      {
        source: 'external' as const,
        id: 'audit',
        name: 'audit',
        description: 'Audit code',
        filePath: '/skills/audit/SKILL.md',
        dirPath: '/skills/audit',
      },
      {
        source: 'plugin' as const,
        id: 'plugin-reviewer',
        name: 'plugin-reviewer',
        description: 'Review code',
        filePath: '/skills/plugin-reviewer/SKILL.md',
        dirPath: '/skills/plugin-reviewer',
      },
    ];

    const state = buildSkillRuntimeState(
      {
        id: 'agent-1',
        name: 'agent',
        llmProfileId: 'llm-1',
        model: 'm',
        systemPrompt: '',
        enabledTools: [],
        skillSelection: {
          providers: [{ source: 'workspace' }],
          include: [{ source: 'external', id: 'audit' }],
          exclude: [{ source: 'workspace', id: 'guidelines' }],
          pinned: [{ source: 'external', id: 'audit' }],
        },
        createdAt: 0,
        updatedAt: 0,
      },
      skills,
      ref => (ref.id === 'audit' ? '# Audit\nReview carefully.' : null)
    );

    expect(state.discoverableSkills.map(skill => `${skill.source}:${skill.id}`)).toEqual([
      'external:audit',
    ]);
    expect(state.pinnedSkills).toEqual([{ source: 'external', id: 'audit' }]);
    expect(state.loadedSkills).toEqual([{ source: 'external', id: 'audit' }]);
    expect(state.loadedSkillContents['external:audit']).toContain('# Audit');
  });

  it('skips missing or hidden pinned skills without failing bootstrap state creation', () => {
    const skills = [
      {
        source: 'workspace' as const,
        id: 'guidelines',
        name: 'guidelines',
        description: 'Follow rules',
        filePath: '/skills/guidelines/SKILL.md',
        dirPath: '/skills/guidelines',
      },
    ];

    const state = buildSkillRuntimeState(
      {
        id: 'agent-1',
        name: 'agent',
        llmProfileId: 'llm-1',
        model: 'm',
        systemPrompt: '',
        enabledTools: [],
        skillSelection: {
          providers: [{ source: 'workspace' }],
          exclude: [{ source: 'workspace', id: 'guidelines' }],
          pinned: [
            { source: 'workspace', id: 'guidelines' },
            { source: 'external', id: 'missing' },
          ],
        },
        createdAt: 0,
        updatedAt: 0,
      },
      skills,
      () => '# unused'
    );

    expect(state.discoverableSkills).toEqual([]);
    expect(state.pinnedSkills).toEqual([]);
    expect(state.loadedSkills).toEqual([]);
    expect(state.loadedSkillContents).toEqual({});
  });

  it('falls back to default agent when session.agent_profile_id is stale (warn log)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = bootstrap('anthropic', 'default', {
      sessionAgentProfileId: 'nonexistent-agent-id',
      apiKey: 'sk-test',
    });

    expect(result?.agentProfile?.id).toBe('agent-1');
    expect(result?.providerConfig?.id).toBe('provider-1');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent-agent-id'));

    warnSpy.mockRestore();
  });

  it('falls back to default llm when agent.llm_profile_id is stale (warn log)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = bootstrap('anthropic', 'default', {
      agentLlmProfileId: 'nonexistent-llm-id',
      profileIsDefault: true,
      apiKey: 'sk-default',
    });

    expect(result?.agentProfile?.id).toBe('agent-1');
    expect(result?.providerConfig?.id).toBe('provider-1');
    expect(result?.providerConfig?.isDefault).toBe(true);
    expect(result?.providerConfig?.apiKey).toBe('sk-default');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent-llm-id'));

    warnSpy.mockRestore();
  });
});

describe('initializeRunBootstrap message INSERT — parsed text + metadata', () => {
  it('stores plain text in content and null metadata for plain-text input', () => {
    const { result, db } = bootstrapWithDb('zclaudia', 'default', 'just a plain message');
    expect(result?.userMessageId).toBeDefined();

    const row = db
      .prepare('SELECT content, metadata FROM messages WHERE id = ?')
      .get(result!.userMessageId!) as { content: string; metadata: string | null };

    expect(row.content).toBe('just a plain message');
    expect(row.metadata).toBeNull();
  });

  it('stores extracted text in content and attachments JSON in metadata for envelope input', () => {
    const attachments = [
      { fileId: 'file-1', name: 'photo.png', mimeType: 'image/png', type: 'image' as const },
    ];
    const envelopeInput = JSON.stringify({ text: 'look at this', attachments });

    const { result, db } = bootstrapWithDb('zclaudia', 'default', envelopeInput);
    expect(result?.userMessageId).toBeDefined();

    const row = db
      .prepare('SELECT content, metadata FROM messages WHERE id = ?')
      .get(result!.userMessageId!) as { content: string; metadata: string | null };

    expect(row.content).toBe('look at this');
    expect(row.metadata).not.toBeNull();

    const meta = JSON.parse(row.metadata!) as { attachments: unknown[] };
    expect(meta.attachments).toEqual(attachments);
  });

  it('stores null metadata for envelope input with empty attachments', () => {
    const envelopeInput = JSON.stringify({ text: 'no files', attachments: [] });

    const { result, db } = bootstrapWithDb('zclaudia', 'default', envelopeInput);
    expect(result?.userMessageId).toBeDefined();

    const row = db
      .prepare('SELECT content, metadata FROM messages WHERE id = ?')
      .get(result!.userMessageId!) as { content: string; metadata: string | null };

    expect(row.content).toBe('no files');
    expect(row.metadata).toBeNull();
  });

  it('persists userMessageMetadata when no attachments', () => {
    const db = createDb('zclaudia');
    const activeRuns = new Map();
    const result = initializeRunBootstrap({
      activeRuns,
      client: {
        id: 'client-1',
        ws: {} as any,
        isAlive: true,
        isLocal: true,
        authenticated: true,
      },
      db: db as any,
      message: {
        type: 'run_start',
        clientRequestId: 'req-1',
        sessionId: 'session-1',
        input: 'hello',
        mode: 'default',
        userMessageMetadata: { source: 'goal-auto', goalId: 'g1' },
      },
      runId: 'run-1',
      trace: {
        log: vi.fn(),
        setMeta: vi.fn(),
      } as any,
    });
    expect(result?.userMessageId).toBeDefined();

    const row = db
      .prepare('SELECT content, metadata FROM messages WHERE id = ?')
      .get(result!.userMessageId!) as { content: string; metadata: string | null };

    expect(row.content).toBe('hello');
    expect(row.metadata).not.toBeNull();
    const meta = JSON.parse(row.metadata!) as Record<string, unknown>;
    expect(meta).toEqual({ source: 'goal-auto', goalId: 'g1' });
  });

  it('merges userMessageMetadata with attachments', () => {
    const attachments = [
      { fileId: 'file-1', name: 'photo.png', mimeType: 'image/png', type: 'image' as const },
    ];
    const envelopeInput = JSON.stringify({ text: 'check this', attachments });
    const db = createDb('zclaudia');
    const activeRuns = new Map();
    const result = initializeRunBootstrap({
      activeRuns,
      client: {
        id: 'client-1',
        ws: {} as any,
        isAlive: true,
        isLocal: true,
        authenticated: true,
      },
      db: db as any,
      message: {
        type: 'run_start',
        clientRequestId: 'req-1',
        sessionId: 'session-1',
        input: envelopeInput,
        mode: 'default',
        userMessageMetadata: { source: 'goal-auto', goalId: 'g2' },
      },
      runId: 'run-1',
      trace: {
        log: vi.fn(),
        setMeta: vi.fn(),
      } as any,
    });
    expect(result?.userMessageId).toBeDefined();

    const row = db
      .prepare('SELECT content, metadata FROM messages WHERE id = ?')
      .get(result!.userMessageId!) as { content: string; metadata: string | null };

    expect(row.content).toBe('check this');
    expect(row.metadata).not.toBeNull();
    const meta = JSON.parse(row.metadata!) as Record<string, unknown>;
    expect(meta).toHaveProperty('attachments');
    expect(meta.attachments).toEqual(attachments);
    expect(meta.source).toBe('goal-auto');
    expect(meta.goalId).toBe('g2');
  });
});

describe('initializeRunBootstrap dual-write — messages.tree_entry_id', () => {
  it('populates tree_entry_id on the user messages row to match the session_entries id', () => {
    const { result, db } = bootstrapWithDb('zclaudia', 'default', 'hello world');
    expect(result?.userMessageId).toBeDefined();

    const msgRow = db
      .prepare(`SELECT tree_entry_id AS t FROM messages WHERE id = ?`)
      .get(result!.userMessageId!) as { t: string | null };

    const entry = db
      .prepare(
        `SELECT id FROM session_entries WHERE session_id = ? AND type = 'message' ORDER BY rowid ASC LIMIT 1`
      )
      .get('session-1') as { id: string } | undefined;

    expect(entry).toBeDefined();
    expect(msgRow.t).not.toBeNull();
    expect(msgRow.t).toBe(entry!.id);
  });
});

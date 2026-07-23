import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

// Capture the options agent_shell passes to the shared sandbox wrapper so the
// session-granted network domains can be asserted without a real sandbox.
const { wrapCommandMock } = vi.hoisted(() => ({
  wrapCommandMock: vi.fn(async () => ({ sandboxed: false })),
}));

vi.mock('../../../../infra/providers/pi-runtime/sandbox.js', () => ({
  isSandboxAvailable: () => false,
  wrapCommand: wrapCommandMock,
}));

import { registerAgentTools } from '../index.js';
import { toolRegistry } from '../../../../application/plugins/index.js';

function createDb(projectRoot: string): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      working_directory TEXT
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      root_path TEXT
    );

    CREATE TABLE permission_memories (
      session_id TEXT NOT NULL,
      remember_key TEXT NOT NULL,
      decision TEXT CHECK(decision IN ('allow', 'deny')) NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, remember_key)
    );
  `);
  db.prepare(`INSERT INTO projects (id, root_path) VALUES ('project-1', ?)`).run(projectRoot);
  db.prepare(`INSERT INTO sessions (id, project_id) VALUES ('session-1', 'project-1')`).run();
  db.prepare(`INSERT INTO sessions (id, project_id) VALUES ('session-2', 'project-1')`).run();
  return db;
}

describe('agent-tools/agent_shell session-granted sandbox domains (P2)', () => {
  const tempDirs: string[] = [];
  let projectRoot: string;
  let db: Database.Database;

  beforeEach(async () => {
    toolRegistry.clear();
    wrapCommandMock.mockClear();
    projectRoot = await mkdtemp(path.join(tmpdir(), 'agent-shell-domains-'));
    tempDirs.push(projectRoot);
    db = createDb(projectRoot);
    registerAgentTools({ getDb: () => db });
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  function grant(sessionId: string, host: string, decision: 'allow' | 'deny' = 'allow') {
    db.prepare(
      `INSERT INTO permission_memories (session_id, remember_key, decision, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1)`
    ).run(sessionId, `sandbox:network:${host}`, decision);
  }

  it('threads the session’s granted domains into wrapCommand', async () => {
    grant('session-1', 'example.com');
    grant('session-1', 'api.github.com');
    grant('session-1', 'denied.example.com', 'deny'); // not an allow grant → excluded
    grant('session-2', 'other-session.example.com'); // different session → excluded

    const result = await toolRegistry.execute(
      'agent_shell',
      { command: 'echo ok' },
      { sessionId: 'session-1' },
      'agent-assistant'
    );

    expect(JSON.parse(result).exitCode).toBe(0);
    expect(wrapCommandMock).toHaveBeenCalledTimes(1);
    const [commandArg, optionsArg] = wrapCommandMock.mock.calls[0] as [
      string,
      { workspaceRoot: string; extraAllowedDomains: string[] },
    ];
    expect(commandArg).toBe('echo ok');
    expect(optionsArg.workspaceRoot).toBe(projectRoot);
    // loadSessionSandboxDomains has no ORDER BY — compare as sets.
    expect([...optionsArg.extraAllowedDomains].sort()).toEqual(['api.github.com', 'example.com']);
  });

  it('passes an empty domain list when the session has no grants', async () => {
    const result = await toolRegistry.execute(
      'agent_shell',
      { command: 'echo ok' },
      { sessionId: 'session-2' },
      'agent-assistant'
    );

    expect(JSON.parse(result).exitCode).toBe(0);
    expect(wrapCommandMock).toHaveBeenCalledWith('echo ok', {
      workspaceRoot: projectRoot,
      extraAllowedDomains: [],
    });
  });

  it('passes an empty domain list when no session id is available', async () => {
    const result = await toolRegistry.execute(
      'agent_shell',
      { command: `cd ${JSON.stringify(projectRoot)} && echo ok` },
      { sessionId: 'session-1' },
      'agent-assistant'
    );
    expect(JSON.parse(result).exitCode).toBe(0);

    toolRegistry.clear();
    registerAgentTools({ getDb: () => db });
    wrapCommandMock.mockClear();

    // Context without a sessionId: resolveProjectCwd fails → handler errors
    // out before wrapCommand; the grant lookup must not run.
    const noSession = await toolRegistry.execute(
      'agent_shell',
      { command: 'echo ok' },
      {},
      'agent-assistant'
    );
    expect(JSON.parse(noSession).error).toMatch(/project directory/);
    expect(wrapCommandMock).not.toHaveBeenCalled();
  });
});

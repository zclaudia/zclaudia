import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyPendingMigrations, migrations } from '../../../infra/storage/migrations/index.js';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  computeConnectionIdentityHash,
  getOrCreateRuntimeBindingKey,
  RuntimeBindingKeyUnavailableError,
} from '../../../infra/services/runtime-binding-key.js';
import { SessionRuntimeBindingRepository } from '../runtime-binding-repository.js';

let db: Database.Database;
let dataDir: string;

function seedSession(id: string, agentProfileId: string, runtimeType: string): void {
  // Pre-041 schema: no engine_mode column yet — that is what the migration adds.
  db.prepare(
    `INSERT INTO agent_profiles (id, name, runtime_type, llm_profile_id, model, system_prompt, enabled_tools, is_default, created_at, updated_at)
     VALUES (?, 'agent', ?, NULL, '', '', '[]', 0, 0, 0)`
  ).run(agentProfileId, runtimeType);
  db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, 0, 0)').run(
    `proj-${id}`,
    id
  );
  db.prepare(
    `INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at)
     VALUES (?, ?, ?, 'regular', 0, 0)`
  ).run(id, `proj-${id}`, agentProfileId);
}

function makeTempDir(prefix: string): string {
  const dir = path.join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  db = new Database(':memory:');
  // Apply everything up to 040, seed a claude session, then let migration 041
  // run its CLI backfill against the seeded row.
  applyPendingMigrations(db, migrations.slice(0, 40));
  db.pragma('foreign_keys = ON');
  seedSession('s-cli-1', 'ap-claude', 'claude');
  applyPendingMigrations(db);
  db.prepare(
    `INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at)
     VALUES ('prof-1', 'P', 'anthropic', 0, 0, 0)`
  ).run();
  dataDir = makeTempDir('session-bindings-key');
});

afterAll(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('session runtime bindings', () => {
  it('migration backfilled cli bindings for claude/codex sessions', () => {
    const repo = new SessionRuntimeBindingRepository(db);
    const binding = repo.findBySessionId('s-cli-1');
    expect(binding).toMatchObject({
      sessionId: 's-cli-1',
      runtimeType: 'claude',
      engineMode: 'cli',
      llmProfileId: null,
    });
  });

  it('does not overwrite an established binding on a conflicting insert', () => {
    const repo = new SessionRuntimeBindingRepository(db);
    const original = repo.findBySessionId('s-cli-1')!;
    expect(repo.upsert({ ...original, engineMode: 'sdk', model: 'replacement' })).toEqual(original);
  });

  it('upserts and reads back a binding with runtime details', () => {
    const repo = new SessionRuntimeBindingRepository(db);
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at)
       VALUES ('s-sdk-1', 'proj-s-cli-1', 'ap-claude', 'regular', 0, 0)`
    ).run();
    const stored = repo.upsert({
      sessionId: 's-sdk-1',
      runtimeType: 'codex',
      engineMode: 'sdk',
      model: 'gpt-5-codex',
      llmProfileId: 'prof-1',
      connectionIdentityHash: 'abc123',
      configuredCliPath: null,
      configNamespace: 'agent-runtime-state/codex/sdk/s-sdk-1',
      runtimeDetails: { schemaVersion: 1, providerId: 'zclaudia_profile', cwd: '/tmp/project' },
    });
    expect(stored.engineMode).toBe('sdk');
    expect(stored.runtimeDetails?.providerId).toBe('zclaudia_profile');
    expect(repo.countWithConnectionIdentity()).toBe(1);
    expect(repo.countByLlmProfileId('prof-1')).toBe(1);
    expect(repo.sessionIdsByLlmProfileId('prof-1')).toEqual(['s-sdk-1']);
  });

  it('rejects an unknown llm profile (FK RESTRICT)', () => {
    const repo = new SessionRuntimeBindingRepository(db);
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at)
       VALUES ('s-sdk-2', 'proj-s-cli-1', 'ap-claude', 'regular', 0, 0)`
    ).run();
    expect(() =>
      repo.upsert({
        sessionId: 's-sdk-2',
        runtimeType: 'codex',
        engineMode: 'sdk',
        model: 'm',
        llmProfileId: 'missing-profile',
        connectionIdentityHash: null,
        configuredCliPath: null,
        configNamespace: null,
        runtimeDetails: null,
      })
    ).toThrow();
  });

  it('deleting a referenced llm profile violates the FK', () => {
    expect(() => db.prepare('DELETE FROM llm_profiles WHERE id = ?').run('prof-1')).toThrow();
  });

  it('binding key refuses creation once connection identities exist', () => {
    const key = getOrCreateRuntimeBindingKey({ dataDir, allowCreate: true });
    const repo = new SessionRuntimeBindingRepository(db);
    const hash = computeConnectionIdentityHash(key, {
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      authMethod: 'api-key',
    });
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at)
       VALUES ('s-sdk-3', 'proj-s-cli-1', 'ap-claude', 'regular', 0, 0)`
    ).run();
    repo.upsert({
      sessionId: 's-sdk-3',
      runtimeType: 'codex',
      engineMode: 'sdk',
      model: 'm',
      llmProfileId: 'prof-1',
      connectionIdentityHash: hash,
      configuredCliPath: null,
      configNamespace: null,
      runtimeDetails: null,
    });
    // Simulate the lost-key scenario on a fresh data dir with existing bindings.
    const emptyDir = makeTempDir('session-bindings-lost-key');
    try {
      expect(() => getOrCreateRuntimeBindingKey({ dataDir: emptyDir, allowCreate: false })).toThrow(
        RuntimeBindingKeyUnavailableError
      );
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

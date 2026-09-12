import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyPendingMigrations, migrations } from '../index.js';
import { migration } from '../042_pi_runtime_identity.js';
import { AgentProfileRepository } from '../../../../domains/agent-profiles/repository.js';
import { SessionRuntimeBindingRepository } from '../../../../domains/sessions/runtime-binding-repository.js';
import { loadMcpServersFromDb } from '../../../../utils/mcp-config.js';

function oldDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyPendingMigrations(
    db,
    migrations.filter(m => m.name < migration.name)
  );
  db.exec(`
    INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at)
      VALUES ('llm', 'ZClaudia LLM', 'anthropic', 1, 1);
    INSERT INTO agent_profiles (id, name, llm_profile_id, runtime_type, status, cli_path, engine_mode, created_at, updated_at)
      VALUES ('old', 'ZClaudia personal agent', 'llm', 'zclaudia', 'readonly', NULL, NULL, 1, 2),
             ('plugin', 'Claude', NULL, 'claude', 'active', '/bin/claude', 'cli', 1, 2),
             ('future', 'Future', NULL, 'future-runtime', 'active', NULL, NULL, 1, 2);
    INSERT INTO projects (id, name, default_agent_profile_id, created_at, updated_at)
      VALUES ('project', 'zclaudia', 'old', 1, 1);
    INSERT INTO sessions (id, project_id, agent_profile_id, sdk_session_id, created_at, updated_at)
      VALUES ('session', 'project', 'old', 'zclaudia-session-original', 1, 1);
    INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES ('message', 'session', 'user', 'keep zclaudia in user content', 1);
    INSERT INTO session_runtime_bindings
      (session_id, llm_profile_id, runtime_type, engine_mode, model, config_namespace, created_at, updated_at)
      VALUES ('session', 'llm', 'zclaudia', '', 'model', 'zclaudia/original', 1, 2);
  `);
  const insert = db.prepare(
    `INSERT INTO mcp_servers (id, name, command, provider_scope, created_at, updated_at) VALUES (?, ?, 'node', ?, 1, 1)`
  );
  for (const [id, scope] of [
    ['old', '["zclaudia","claude"]'],
    ['pi', '["pi"]'],
    ['all', null],
    ['none', '[]'],
    ['invalid', 'not-json'],
    ['object', '{"zclaudia":"keep"}'],
  ])
    insert.run(id, id, scope);
  return db;
}

describe('Pi runtime identity migration', () => {
  it('preserves history, bindings, foreign keys, indexes and plugin runtimes on upgrade', () => {
    const db = oldDatabase();
    try {
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_profiles' ORDER BY name"
        )
        .all();
      applyPendingMigrations(db);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_profiles' ORDER BY name"
          )
          .all()
      ).toEqual(indexes);
      const repo = new AgentProfileRepository(db);
      expect(repo.findById('old')).toMatchObject({
        runtimeType: 'pi',
        name: 'ZClaudia personal agent',
        status: 'readonly',
        llmProfileId: 'llm',
        updatedAt: 2,
      });
      expect(repo.findById('plugin')).toMatchObject({
        runtimeType: 'claude',
        engineMode: 'cli',
        cliPath: '/bin/claude',
      });
      expect(repo.findById('future')?.runtimeType).toBe('future-runtime');
      expect(new SessionRuntimeBindingRepository(db).findBySessionId('session')).toMatchObject({
        runtimeType: 'pi',
        engineMode: '',
        configNamespace: 'zclaudia/original',
        updatedAt: 2,
      });
      expect(db.prepare('SELECT sdk_session_id FROM sessions').get()).toEqual({
        sdk_session_id: 'zclaudia-session-original',
      });
      expect(db.prepare('SELECT content FROM messages').get()).toEqual({
        content: 'keep zclaudia in user content',
      });
      expect(() => db.prepare("DELETE FROM agent_profiles WHERE id = 'old'").run()).toThrow(
        /FOREIGN KEY/
      );
      expect(() => db.prepare("DELETE FROM llm_profiles WHERE id = 'llm'").run()).toThrow(
        /FOREIGN KEY/
      );
      expect(() =>
        db.prepare("UPDATE agent_profiles SET status = 'invalid' WHERE id = 'old'").run()
      ).toThrow(/CHECK/);
      db.exec(
        "INSERT INTO agent_profiles (id, name, created_at, updated_at) VALUES ('new', 'New', 1, 1)"
      );
      expect(db.prepare("SELECT runtime_type FROM agent_profiles WHERE id = 'new'").get()).toEqual({
        runtime_type: 'pi',
      });
      applyPendingMigrations(db); // Normal startup is idempotent.
    } finally {
      db.close();
    }
  });

  it('migrates only exact identities in MCP scopes and retains legacy import compatibility', () => {
    const db = oldDatabase();
    try {
      expect(loadMcpServersFromDb(db, 'pi')).toHaveProperty('old');
      applyPendingMigrations(db);
      const scope = (id: string) =>
        (
          db.prepare('SELECT provider_scope FROM mcp_servers WHERE id = ?').get(id) as {
            provider_scope: string | null;
          }
        ).provider_scope;
      expect(JSON.parse(scope('old')!)).toEqual(['pi', 'claude']);
      expect(scope('pi')).toBe('["pi"]');
      expect(scope('all')).toBeNull();
      expect(scope('none')).toBe('[]');
      expect(scope('invalid')).toBe('not-json');
      expect(scope('object')).toBe('{"zclaudia":"keep"}');
      expect(loadMcpServersFromDb(db, 'zclaudia')).toHaveProperty('pi');
      expect(loadMcpServersFromDb(db, 'pi')).not.toHaveProperty('none');
    } finally {
      db.close();
    }
  });

  it('rolls back the column replacement if migration fails', () => {
    const db = oldDatabase();
    try {
      const broken = {
        ...migration,
        sql: migration.sql + '\nSELECT missing_column FROM agent_profiles;',
      };
      expect(() => applyPendingMigrations(db, [broken])).toThrow();
      expect(db.prepare("SELECT runtime_type FROM agent_profiles WHERE id = 'old'").get()).toEqual({
        runtime_type: 'zclaudia',
      });
      expect(
        db.prepare('SELECT name FROM migrations WHERE name = ?').get(migration.name)
      ).toBeUndefined();
      expect(db.pragma('foreign_key_check')).toEqual([]);
      applyPendingMigrations(db);
    } finally {
      db.close();
    }
  });
});

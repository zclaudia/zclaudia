import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { newId } from '../utils/uuid.js';

// Create in-memory database for testing
function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_profiles (
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

    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      llm_profile_id TEXT NOT NULL,
      model TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      enabled_tools TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('chat_only', 'code')) DEFAULT 'code',
      default_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
      root_path TEXT,
      system_prompt TEXT,
      permission_policy TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      llm_profile_id TEXT,
      sdk_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (llm_profile_id) REFERENCES llm_profiles(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      offset INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_offset ON messages(session_id, offset);
  `);

  return db;
}

describe('Database Operations', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    // Clear all data before each test
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
    db.exec('DELETE FROM llm_profiles');
  });

  describe('Providers', () => {
    it('creates a provider', () => {
      const id = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(id, 'Test Provider', 'anthropic', 1, now, now);

      const provider = db.prepare('SELECT * FROM llm_profiles WHERE id = ?').get(id) as {
        id: string;
        name: string;
        provider_type: string;
        is_default: number;
      };

      expect(provider).toBeDefined();
      expect(provider.name).toBe('Test Provider');
      expect(provider.provider_type).toBe('anthropic');
      expect(provider.is_default).toBe(1);
    });

    it('stores and retrieves env as JSON string', () => {
      const id = newId();
      const now = Date.now();
      const env = { ANTHROPIC_API_KEY: 'test-key', HOME: '/custom/home' };

      db.prepare(
        `
        INSERT INTO llm_profiles (id, name, provider_type, env, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(id, 'Custom Provider', 'anthropic', JSON.stringify(env), now, now);

      const provider = db.prepare('SELECT * FROM llm_profiles WHERE id = ?').get(id) as {
        env: string;
      };

      expect(provider.env).toBe(JSON.stringify(env));
      expect(JSON.parse(provider.env)).toEqual(env);
    });
  });

  describe('Projects', () => {
    it('creates a project', () => {
      const id = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, root_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(id, 'Test Project', 'code', '/path/to/project', now, now);

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as {
        id: string;
        name: string;
        type: string;
        root_path: string;
      };

      expect(project).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.type).toBe('code');
      expect(project.root_path).toBe('/path/to/project');
    });

    it('updates a project', () => {
      const id = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(id, 'Original', 'code', now, now);

      db.prepare(
        `
        UPDATE projects SET name = ?, root_path = ?, updated_at = ? WHERE id = ?
      `
      ).run('Updated', '/new/path', Date.now(), id);

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as {
        name: string;
        root_path: string;
      };

      expect(project.name).toBe('Updated');
      expect(project.root_path).toBe('/new/path');
    });

    it('deletes a project', () => {
      const id = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(id, 'To Delete', 'code', now, now);

      db.prepare('DELETE FROM projects WHERE id = ?').run(id);

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      expect(project).toBeUndefined();
    });

    it('links project to default agent profile', () => {
      const llmProfileId = newId();
      const agentProfileId = newId();
      const projectId = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(llmProfileId, 'Provider', 'anthropic', now, now);

      db.prepare(
        `
        INSERT INTO agent_profiles (id, name, llm_profile_id, model, system_prompt, enabled_tools, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(agentProfileId, 'Agent', llmProfileId, 'm', '', '["read"]', now, now);

      db.prepare(
        `
        INSERT INTO projects (id, name, type, default_agent_profile_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(projectId, 'Project', 'code', agentProfileId, now, now);

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as {
        default_agent_profile_id: string;
      };

      expect(project.default_agent_profile_id).toBe(agentProfileId);
    });
  });

  describe('Sessions', () => {
    it('creates a session linked to project', () => {
      const projectId = newId();
      const sessionId = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(projectId, 'Project', 'code', now, now);

      db.prepare(
        `
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(sessionId, projectId, 'Test Session', now, now);

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as {
        id: string;
        project_id: string;
        name: string;
      };

      expect(session).toBeDefined();
      expect(session.project_id).toBe(projectId);
      expect(session.name).toBe('Test Session');
    });

    it('cascades delete when project is deleted', () => {
      const projectId = newId();
      const sessionId = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(projectId, 'Project', 'code', now, now);

      db.prepare(
        `
        INSERT INTO sessions (id, project_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(sessionId, projectId, 'Session', now, now);

      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      expect(session).toBeUndefined();
    });

    it('stores sdk_session_id for resume', () => {
      const projectId = newId();
      const sessionId = newId();
      const sdkSessionId = 'sdk-session-123';
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(projectId, 'Project', 'code', now, now);

      db.prepare(
        `
        INSERT INTO sessions (id, project_id, sdk_session_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(sessionId, projectId, sdkSessionId, now, now);

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as {
        sdk_session_id: string;
      };

      expect(session.sdk_session_id).toBe(sdkSessionId);
    });
  });

  describe('Messages', () => {
    it('creates a message linked to session', () => {
      const projectId = newId();
      const sessionId = newId();
      const messageId = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(projectId, 'Project', 'code', now, now);

      db.prepare(
        `
        INSERT INTO sessions (id, project_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `
      ).run(sessionId, projectId, now, now);

      db.prepare(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(messageId, sessionId, 'user', 'Hello world', now);

      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as {
        id: string;
        session_id: string;
        role: string;
        content: string;
      };

      expect(message).toBeDefined();
      expect(message.session_id).toBe(sessionId);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello world');
    });

    it('retrieves messages in chronological order', () => {
      const projectId = newId();
      const sessionId = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(projectId, 'Project', 'code', now, now);

      db.prepare(
        `
        INSERT INTO sessions (id, project_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `
      ).run(sessionId, projectId, now, now);

      // Insert messages in order
      db.prepare(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run('m1', sessionId, 'user', 'First', now);

      db.prepare(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run('m2', sessionId, 'assistant', 'Second', now + 1);

      db.prepare(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run('m3', sessionId, 'user', 'Third', now + 2);

      const messages = db
        .prepare(
          `
        SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC
      `
        )
        .all(sessionId) as Array<{ content: string }>;

      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('cascades delete when session is deleted', () => {
      const projectId = newId();
      const sessionId = newId();
      const messageId = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(projectId, 'Project', 'code', now, now);

      db.prepare(
        `
        INSERT INTO sessions (id, project_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `
      ).run(sessionId, projectId, now, now);

      db.prepare(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(messageId, sessionId, 'user', 'Test', now);

      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
      expect(message).toBeUndefined();
    });
  });

  describe('Role constraints', () => {
    it('allows valid roles: user, assistant, system', () => {
      const projectId = newId();
      const sessionId = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(projectId, 'Project', 'code', now, now);

      db.prepare(
        `
        INSERT INTO sessions (id, project_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `
      ).run(sessionId, projectId, now, now);

      // These should all succeed
      db.prepare(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run('m1', sessionId, 'user', 'User message', now);

      db.prepare(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run('m2', sessionId, 'assistant', 'Assistant message', now);

      db.prepare(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run('m3', sessionId, 'system', 'System message', now);

      const count = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
      expect(count.count).toBe(3);
    });

    it('rejects invalid roles', () => {
      const projectId = newId();
      const sessionId = newId();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(projectId, 'Project', 'code', now, now);

      db.prepare(
        `
        INSERT INTO sessions (id, project_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `
      ).run(sessionId, projectId, now, now);

      expect(() => {
        db.prepare(
          `
          INSERT INTO messages (id, session_id, role, content, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run('m1', sessionId, 'invalid_role', 'Test', now);
      }).toThrow();
    });
  });

  describe('Project type constraints', () => {
    it('allows valid types: code, chat_only', () => {
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run('p1', 'Code Project', 'code', now, now);

      db.prepare(
        `
        INSERT INTO projects (id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run('p2', 'Chat Project', 'chat_only', now, now);

      const count = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
      expect(count.count).toBe(2);
    });

    it('rejects invalid project types', () => {
      const now = Date.now();

      expect(() => {
        db.prepare(
          `
          INSERT INTO projects (id, name, type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run('p1', 'Invalid', 'invalid_type', now, now);
      }).toThrow();
    });
  });
});

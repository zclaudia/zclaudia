import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock better-sqlite3
const mockDb = {
  pragma: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn((fn: () => void) => () => fn()),
  prepare: vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(() => []),
  })),
  close: vi.fn(),
};

vi.mock('better-sqlite3', () => {
  const MockDatabase = vi.fn(function (this: typeof mockDb) {
    Object.assign(this, mockDb);
    return this;
  });
  return {
    default: MockDatabase,
  };
});

// Mock fs
const mockFsMethods = {
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
};

vi.mock('fs', () => ({
  default: mockFsMethods,
  ...mockFsMethods,
}));

// Mock os
vi.mock('os', () => ({
  default: { homedir: vi.fn(() => '/home/testuser') },
  homedir: vi.fn(() => '/home/testuser'),
}));

describe('storage/db', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalDataDir: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset fs mock implementations
    mockFsMethods.existsSync.mockReturnValue(true);
    mockFsMethods.mkdirSync.mockImplementation(() => undefined);

    // Reset db mock implementations - use mockReset to clear all implementations
    mockDb.pragma.mockReset();
    mockDb.exec.mockReset();
    mockDb.transaction.mockReset();
    mockDb.transaction.mockImplementation((fn: () => void) => () => fn());
    mockDb.prepare.mockReset();
    mockDb.prepare.mockImplementation(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    }));

    // Save and clear ZCLAUDIA_DATA_DIR to ensure consistent test behavior
    originalDataDir = process.env.ZCLAUDIA_DATA_DIR;
    delete process.env.ZCLAUDIA_DATA_DIR;

    // Reset modules to avoid singleton state leaking across tests
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original ZCLAUDIA_DATA_DIR
    if (originalDataDir !== undefined) {
      process.env.ZCLAUDIA_DATA_DIR = originalDataDir;
    } else {
      delete process.env.ZCLAUDIA_DATA_DIR;
    }
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('initDatabase', () => {
    it('creates database with WAL mode', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    });

    it('ensures data directory exists', async () => {
      mockFsMethods.existsSync.mockReturnValue(false);

      const { initDatabase } = await import('../db.js');

      initDatabase();

      expect(mockFsMethods.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.zclaudia'), {
        recursive: true,
      });
    });

    it('uses ZCLAUDIA_DATA_DIR environment variable', async () => {
      const originalEnv = process.env.ZCLAUDIA_DATA_DIR;
      process.env.ZCLAUDIA_DATA_DIR = '/custom/data/dir';

      mockFsMethods.existsSync.mockReturnValue(false);

      // Reset modules to pick up new env var
      vi.resetModules();
      const { initDatabase } = await import('../db.js');

      initDatabase();

      expect(mockFsMethods.mkdirSync).toHaveBeenCalledWith('/custom/data/dir', { recursive: true });

      if (originalEnv === undefined) {
        delete process.env.ZCLAUDIA_DATA_DIR;
      } else {
        process.env.ZCLAUDIA_DATA_DIR = originalEnv;
      }
    });

    it('runs migrations on initialization', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      // Should have called exec for migrations table and at least one migration
      expect(mockDb.exec).toHaveBeenCalled();
    });

    it('returns database instance', async () => {
      const { initDatabase } = await import('../db.js');

      const db = initDatabase();

      expect(db).toEqual(
        expect.objectContaining({
          pragma: expect.any(Function),
          exec: expect.any(Function),
          prepare: expect.any(Function),
          close: expect.any(Function),
        })
      );
    });
  });

  describe('migrations', () => {
    it('creates migrations table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      // First exec call should be for migrations table
      const firstExecCall = mockDb.exec.mock.calls[0];
      expect(firstExecCall[0]).toContain('CREATE TABLE IF NOT EXISTS migrations');
    });

    it('creates providers table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      // Find the call that creates providers table
      const providersCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS llm_profiles')
      );
      expect(providersCall).toBeDefined();
    });

    it('creates projects table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const projectsCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS projects')
      );
      expect(projectsCall).toBeDefined();
    });

    it('creates sessions table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const sessionsCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS sessions')
      );
      expect(sessionsCall).toBeDefined();
    });

    it('creates messages table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const messagesCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS messages')
      );
      expect(messagesCall).toBeDefined();
    });

    it('creates servers table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const serversCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS servers')
      );
      expect(serversCall).toBeDefined();
    });

    it('creates gateway_config table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const gatewayCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS gateway_config')
      );
      expect(gatewayCall).toBeDefined();
    });

    it('creates search_history table', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const searchCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('CREATE TABLE IF NOT EXISTS search_history')
      );
      expect(searchCall).toBeDefined();
    });

    it('creates FTS tables for messages', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const ftsCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('messages_fts USING fts5')
      );
      expect(ftsCall).toBeDefined();
    });

    it('creates FTS tables for files', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const filesFtsCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('files_fts USING fts5')
      );
      expect(filesFtsCall).toBeDefined();
    });

    it('creates FTS tables for tool calls', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const toolCallsFtsCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('tool_calls_fts USING fts5')
      );
      expect(toolCallsFtsCall).toBeDefined();
    });

    it('creates triggers for FTS sync', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const triggerCalls = mockDb.exec.mock.calls.filter(call =>
        call[0].includes('CREATE TRIGGER')
      );
      expect(triggerCalls.length).toBeGreaterThan(0);
    });

    it('creates indexes for performance', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const indexCalls = mockDb.exec.mock.calls.filter(call => call[0].includes('CREATE INDEX'));
      expect(indexCalls.length).toBeGreaterThan(0);
    });
  });

  describe('default data', () => {
    it('inserts default local server', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const localServerCall = mockDb.exec.mock.calls.find(
        call => call[0].includes('INSERT OR IGNORE INTO servers') && call[0].includes("'local'")
      );
      expect(localServerCall).toBeDefined();
      expect(localServerCall?.[0]).toContain("'This Device'");
    });

    it('inserts default gateway config', async () => {
      const { initDatabase } = await import('../db.js');

      initDatabase();

      const gatewayConfigCall = mockDb.exec.mock.calls.find(call =>
        call[0].includes('INSERT OR IGNORE INTO gateway_config')
      );
      expect(gatewayConfigCall).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('handles database errors gracefully', async () => {
      mockDb.exec.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const { initDatabase } = await import('../db.js');

      expect(() => initDatabase()).toThrow('Database error');
    });

    it('handles file system errors', async () => {
      mockFsMethods.existsSync.mockReturnValue(false);
      mockFsMethods.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const { initDatabase } = await import('../db.js');

      expect(() => initDatabase()).toThrow('Permission denied');
    });
  });

  describe('database path', () => {
    it('uses default path in home directory', async () => {
      mockFsMethods.existsSync.mockReturnValue(false);

      const { initDatabase } = await import('../db.js');

      initDatabase();

      const mkdirCall = mockFsMethods.mkdirSync.mock.calls[0];
      expect(mkdirCall[0]).toContain('.zclaudia');
    });

    it('uses custom path from environment', async () => {
      const originalEnv = process.env.ZCLAUDIA_DATA_DIR;
      process.env.ZCLAUDIA_DATA_DIR = '/tmp/test-claudia';

      mockFsMethods.existsSync.mockReturnValue(false);

      // Re-import to pick up new env var (module is cached, so we need to clear cache)
      vi.resetModules();
      // Need to re-mock after reset
      vi.doMock('os', () => ({
        default: { homedir: vi.fn(() => '/home/testuser') },
        homedir: vi.fn(() => '/home/testuser'),
      }));
      vi.doMock('fs', () => ({
        default: mockFsMethods,
        ...mockFsMethods,
      }));
      vi.doMock('better-sqlite3', () => ({
        default: vi.fn(function (this: typeof mockDb) {
          Object.assign(this, mockDb);
          return this;
        }),
      }));

      const { initDatabase } = await import('../db.js');

      initDatabase();

      const mkdirCall = mockFsMethods.mkdirSync.mock.calls[0];
      expect(mkdirCall[0]).toBe('/tmp/test-claudia');

      if (originalEnv === undefined) {
        delete process.env.ZCLAUDIA_DATA_DIR;
      } else {
        process.env.ZCLAUDIA_DATA_DIR = originalEnv;
      }
    });
  });
});

describe('migration 025: messages tree_entry_id', () => {
  it('025: messages has tree_entry_id column and index', async () => {
    const { default: Database } =
      await vi.importActual<typeof import('better-sqlite3')>('better-sqlite3');
    const { applyMigrations } =
      await vi.importActual<typeof import('../migrations/index.js')>('../migrations/index.js');

    const db = new Database(':memory:');
    applyMigrations(db);

    const cols = (db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>).map(
      c => c.name
    );
    expect(cols).toContain('tree_entry_id');

    const idx = (db.prepare(`PRAGMA index_list(messages)`).all() as Array<{ name: string }>).map(
      i => i.name
    );
    expect(idx).toContain('idx_messages_tree_entry');
    db.close();
  });
});

describe('migration 024: session fork lineage', () => {
  it('024: sessions has fork lineage columns with ON DELETE SET NULL', async () => {
    const { default: Database } =
      await vi.importActual<typeof import('better-sqlite3')>('better-sqlite3');
    const { applyMigrations } =
      await vi.importActual<typeof import('../migrations/index.js')>('../migrations/index.js');

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);

    const cols = (db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>).map(
      c => c.name
    );
    expect(cols).toContain('forked_from_session_id');
    expect(cols).toContain('fork_entry_id');

    db.prepare(
      `INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES ('l1','default','anthropic',1,1)`
    ).run();
    db.prepare(
      `INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1','p',1,1)`
    ).run();
    db.prepare(
      `INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at) VALUES ('a1','a','l1',1,1)`
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at) VALUES ('parent','p1','a1','regular',1,1)`
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, type, forked_from_session_id, fork_entry_id, created_at, updated_at) VALUES ('child','p1','a1','regular','parent','e1',1,1)`
    ).run();

    db.prepare(`DELETE FROM sessions WHERE id = 'parent'`).run();
    const child = db
      .prepare(`SELECT forked_from_session_id AS f FROM sessions WHERE id = 'child'`)
      .get() as { f: string | null };
    expect(child).toBeTruthy();
    expect(child.f).toBeNull();
    db.close();
  });
});

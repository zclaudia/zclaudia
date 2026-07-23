import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { ProcessSupervisor } from '../process-supervisor.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE managed_processes (
      process_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      pid INTEGER,
      ppid INTEGER,
      root_pid INTEGER,
      pgid INTEGER,
      command TEXT NOT NULL,
      args_json TEXT NOT NULL,
      cwd TEXT,
      owner_session_id TEXT,
      owner_task_id TEXT,
      owner_backend_id TEXT,
      owner_run_id TEXT,
      owner_request_id TEXT,
      parent_process_id TEXT,
      started_at INTEGER NOT NULL,
      exited_at INTEGER,
      exit_code INTEGER,
      signal TEXT,
      protected INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL,
      adopted INTEGER NOT NULL DEFAULT 0,
      orphaned_at INTEGER,
      metadata_json TEXT
    );
  `);
  return db;
}

async function readStdout(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return '';
  let out = '';
  for await (const chunk of stream) out += chunk.toString();
  return out;
}

describe('ProcessSupervisor env scrubbing (P2)', () => {
  // Must NOT start with ZCLAUDIA_/LC_/XDG_ (allowlisted prefixes in env-scrub).
  const SECRET_NAME = 'SUPERVISOR_TEST_SECRET_TOKEN';
  let db: Database.Database;
  let supervisor: ProcessSupervisor;
  let savedSecret: string | undefined;

  beforeEach(() => {
    db = createDb();
    supervisor = new ProcessSupervisor(db);
    savedSecret = process.env[SECRET_NAME];
    process.env[SECRET_NAME] = 'super-secret-value';
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env[SECRET_NAME];
    else process.env[SECRET_NAME] = savedSecret;
  });

  it('strips secret-looking inherited vars but keeps PATH when no env is given', async () => {
    const result = await supervisor.trackCommand({ command: 'env', args: [] });
    const [stdout] = await Promise.all([
      readStdout(result.handle.stdout),
      result.handle.exitPromise,
    ]);

    expect(stdout).not.toContain('super-secret-value');
    expect(stdout).not.toContain(SECRET_NAME);
    expect(stdout).toMatch(/^PATH=/m);
    // Supervisor marker vars are still injected.
    expect(stdout).toContain(`_MC_PROCESS_ID=${result.processId}`);
  });

  it('lets an explicit spec.env value win over the scrubbed base', async () => {
    const result = await supervisor.trackCommand({
      command: 'env',
      args: [],
      env: { [SECRET_NAME]: 'explicitly-passed' },
    });
    const [stdout] = await Promise.all([
      readStdout(result.handle.stdout),
      result.handle.exitPromise,
    ]);

    expect(stdout).toContain(`${SECRET_NAME}=explicitly-passed`);
  });

  it('does not leak other host secrets alongside an explicit env', async () => {
    const OTHER_SECRET = 'SUPERVISOR_TEST_OTHER_API_KEY';
    const savedOther = process.env[OTHER_SECRET];
    process.env[OTHER_SECRET] = 'other-secret-value';
    try {
      const result = await supervisor.trackCommand({
        command: 'env',
        args: [],
        env: { EXPLICIT_MARKER: 'yes' },
      });
      const [stdout] = await Promise.all([
        readStdout(result.handle.stdout),
        result.handle.exitPromise,
      ]);

      expect(stdout).toContain('EXPLICIT_MARKER=yes');
      expect(stdout).not.toContain('other-secret-value');
      expect(stdout).not.toContain(OTHER_SECRET);
    } finally {
      if (savedOther === undefined) delete process.env[OTHER_SECRET];
      else process.env[OTHER_SECRET] = savedOther;
    }
  });
});

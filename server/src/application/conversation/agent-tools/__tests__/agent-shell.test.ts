import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { registerAgentTools } from '../index.js';
import { toolRegistry } from '../../../../application/plugins/index.js';

// Force the unsandboxed fallback path: sandbox availability is platform- and
// dependency-dependent, and these tests assert the raw-spawn behavior.
process.env.ZCLAUDIA_SANDBOX = 'off';

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
  `);
  db.prepare(`INSERT INTO projects (id, root_path) VALUES ('project-1', ?)`).run(projectRoot);
  db.prepare(`INSERT INTO sessions (id, project_id) VALUES ('session-1', 'project-1')`).run();
  return db;
}

describe('agent-tools/agent_shell', () => {
  const tempDirs: string[] = [];
  let projectRoot: string;
  let db: Database.Database;

  beforeEach(async () => {
    toolRegistry.clear();
    projectRoot = await mkdtemp(path.join(tmpdir(), 'agent-shell-project-'));
    tempDirs.push(projectRoot);
    db = createDb(projectRoot);
    registerAgentTools({ getDb: () => db });
  });

  afterEach(async () => {
    delete process.env.ZCLAUDIA_AGENT_SHELL_TIMEOUT_MS;
    delete process.env.ZCLAUDIA_AGENT_SHELL_KILL_GRACE_MS;
    delete process.env.ANTHROPIC_API_KEY;
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  function execute(args: Record<string, unknown>) {
    return toolRegistry.execute('agent_shell', args, { sessionId: 'session-1' }, 'agent-assistant');
  }

  it('runs a command in the project directory and returns its output', async () => {
    const result = await execute({ command: 'pwd && echo hello' });
    const parsed = JSON.parse(result);

    expect(parsed.exitCode).toBe(0);
    expect(parsed.stdout).toContain('hello');
    expect(parsed.stderr).toBe('');
  });

  it('scrubs secret-looking environment variables from the child (P1-16)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-secret';

    const result = await execute({ command: 'echo "key=[$ANTHROPIC_API_KEY] path_set=$([ -n "$PATH" ] && echo yes)"' });
    const parsed = JSON.parse(result);

    expect(parsed.exitCode).toBe(0);
    expect(parsed.stdout).toContain('key=[]');
    expect(parsed.stdout).toContain('path_set=yes');
    expect(parsed.stdout).not.toContain('sk-test-secret');
  });

  it('escalates SIGTERM to SIGKILL when a stubborn process ignores the timeout (P1-16)', async () => {
    process.env.ZCLAUDIA_AGENT_SHELL_TIMEOUT_MS = '200';
    process.env.ZCLAUDIA_AGENT_SHELL_KILL_GRACE_MS = '150';

    const startedAt = Date.now();
    // Busy loop inside the shell itself (no children): ignores SIGTERM, so only
    // the SIGKILL escalation can stop it.
    const result = await execute({ command: "trap '' TERM; while true; do :; done" });
    const elapsed = Date.now() - startedAt;
    const parsed = JSON.parse(result);

    expect(parsed.timedOut).toBe(true);
    expect(parsed.exitCode).toBe(124);
    // 200ms timeout + 150ms grace + SIGKILL reap; far below the 30s default.
    expect(elapsed).toBeLessThan(10_000);
  }, 15_000);

  it('truncates runaway output head+tail instead of buffering it all (P1-16)', async () => {
    const result = await execute({
      command: 'i=0; while [ $i -lt 4000 ]; do echo "line-$i-padding-padding-padding"; i=$((i+1)); done',
    });
    const parsed = JSON.parse(result);

    expect(parsed.exitCode).toBe(0);
    expect(parsed.truncated).toBe(true);
    expect(parsed.stdout).toContain('chars omitted');
    expect(parsed.stdout.startsWith('line-0-padding')).toBe(true);
    expect(parsed.stdout).toContain('line-3999-padding');
    // head 8KB + marker + tail 8KB, bounded well below the full ~140KB output.
    expect(parsed.stdout.length).toBeLessThan(20 * 1024);
  });

  it('passes the scrubbed env and /bin/sh argv through the process supervisor when present', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-secret';

    const trackCommand = vi.fn(async (spec: {
      command: string;
      args: string[];
      cwd?: string;
      env?: Record<string, string | undefined>;
    }) => {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return {
        processId: 'proc-1',
        pid: child.pid ?? null,
        pgid: null,
        handle: {
          stdout: child.stdout,
          stderr: child.stderr,
          stdin: child.stdin,
          exitPromise: new Promise<{ code: number | null; signal: string | null }>(resolve =>
            child.once('exit', (code, signal) => resolve({ code, signal }))
          ),
          kill: (signal?: NodeJS.Signals) => child.kill(signal),
        },
      };
    });

    toolRegistry.clear();
    registerAgentTools({
      getDb: () => db,
      getProcessSupervisor: () => ({ trackCommand }) as never,
    });

    const result = await execute({ command: 'echo supervised' });
    const parsed = JSON.parse(result);

    expect(parsed.exitCode).toBe(0);
    expect(parsed.stdout).toContain('supervised');
    expect(trackCommand).toHaveBeenCalledTimes(1);
    const spec = trackCommand.mock.calls[0][0] as {
      command: string;
      args: string[];
      env: Record<string, string | undefined>;
    };
    expect(spec.command).toBe('/bin/sh');
    expect(spec.args).toEqual(['-c', 'echo supervised']);
    expect(spec.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(spec.env.PATH).toBeDefined();
  });
});

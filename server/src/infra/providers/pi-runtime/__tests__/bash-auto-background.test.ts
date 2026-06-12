import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { runBash, killProcessTree } from '../bash-runner.js';
import { buildTools } from '../tool-bridge.js';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../../../domains/tasks/repository.js';
import { commandTaskLogPath, pidAlive } from '../../../../domains/tasks/executors/command-executor.js';

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
}

describe('runBash auto-background handoff', () => {
  it('hands off a still-running command at the threshold instead of waiting', async () => {
    const start = Date.now();
    const res = await runBash({
      command: 'echo early; sleep 5; echo late',
      cwd: tmpdir(),
      timeoutSec: 30,
      autoBackgroundMs: 300,
    });
    const elapsed = Date.now() - start;
    try {
      expect(res.handoff).toBeDefined();
      expect(elapsed).toBeLessThan(3000);
      expect(res.fullOutput).toContain('early');
      expect(res.timedOut).toBe(false);
      expect(res.aborted).toBe(false);
      expect(typeof res.handoff!.child.pid).toBe('number');
      expect(pidAlive(res.handoff!.child.pid!)).toBe(true);
    } finally {
      if (res.handoff?.child.pid) killProcessTree(res.handoff.child.pid);
    }
  });

  it('does not hand off when the command finishes before the threshold', async () => {
    const res = await runBash({
      command: 'echo done',
      cwd: tmpdir(),
      timeoutSec: 30,
      autoBackgroundMs: 5000,
    });
    expect(res.handoff).toBeUndefined();
    expect(res.exitCode).toBe(0);
    expect(res.fullOutput).toContain('done');
  });

  it('handoff cancels the kill timeout (child outlives timeoutSec)', async () => {
    const res = await runBash({
      command: 'sleep 2; echo survived',
      cwd: tmpdir(),
      timeoutSec: 1,
      autoBackgroundMs: 200,
    });
    try {
      expect(res.handoff).toBeDefined();
      await new Promise((r) => setTimeout(r, 1300));
      // 1s kill timer would have fired by now if it were still armed
      expect(pidAlive(res.handoff!.child.pid!)).toBe(true);
    } finally {
      if (res.handoff?.child.pid) killProcessTree(res.handoff.child.pid);
    }
  });
});

describe('Bash auto-background (tool integration)', () => {
  let db: Database.Database;
  let dataDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    dataDir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-data-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function bashTool(dir: string, options: Record<string, unknown> = {}): any {
    return buildTools(dir, { enabled: ['Bash'], ...options }).find((t: any) => t.name === 'Bash');
  }

  it('moves a long-running foreground command into a background task', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const res = await bashTool(dir, { db, bashAutoBackgroundMs: 300 })
      .execute('ab1', { command: 'echo early; sleep 1; echo late' });

    expect(res.details.background).toBe(true);
    expect(res.details.autoBackgrounded).toBe(true);
    expect(typeof res.details.taskId).toBe('string');
    // Inline output capture before the handoff is timing-dependent under load;
    // the task log below asserts the full output deterministically.
    expect(res.content[0].text).toContain('TaskOutput');

    const repo = new TaskRepository(db);
    const taskId = res.details.taskId as string;
    expect(repo.findById(taskId)?.status).toBe('running');

    const completed = await waitUntil(() => repo.findById(taskId)?.status === 'completed');
    expect(completed).toBe(true);
    const log = readFileSync(commandTaskLogPath(taskId), 'utf8');
    expect(log).toContain('early');
    expect(log).toContain('late');
    rmSync(dir, { recursive: true, force: true });
  });

  it('marks the adopted task failed when the command exits non-zero', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const res = await bashTool(dir, { db, bashAutoBackgroundMs: 200 })
      .execute('ab2', { command: 'sleep 1; exit 3' });
    expect(res.details.autoBackgrounded).toBe(true);
    const repo = new TaskRepository(db);
    const taskId = res.details.taskId as string;
    const failed = await waitUntil(() => repo.findById(taskId)?.status === 'failed');
    expect(failed).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not auto-background without db context (waits to completion)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const res = await bashTool(dir, { bashAutoBackgroundMs: 200 })
      .execute('ab3', { command: 'sleep 1; echo fin' });
    expect(res.details.background).toBeUndefined();
    expect(res.details.exitCode).toBe(0);
    expect(res.content[0].text).toContain('fin');
    rmSync(dir, { recursive: true, force: true });
  });

  it('an explicit timeout disables auto-background and is honored', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const res = await bashTool(dir, { db, bashAutoBackgroundMs: 200 })
      .execute('ab4', { command: 'sleep 3; echo fin', timeout: 1 });
    expect(res.details.background).toBeUndefined();
    expect(res.details.timedOut).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('short commands behave exactly as before', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const res = await bashTool(dir, { db, bashAutoBackgroundMs: 5000 })
      .execute('ab5', { command: 'echo quick' });
    expect(res.details.ok).toBe(true);
    expect(res.details.background).toBeUndefined();
    expect(res.content[0].text).toContain('quick');
    rmSync(dir, { recursive: true, force: true });
  });
});

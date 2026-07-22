import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { runBash, killProcessTree } from '../bash-runner.js';
import { buildTools } from '../tool-bridge.js';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../../../domains/tasks/repository.js';
import {
  commandTaskLogPath,
  pidAlive,
} from '../../../../domains/tasks/executors/command-executor.js';

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 50));
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
      await new Promise(r => setTimeout(r, 1300));
      // 1s kill timer would have fired by now if it were still armed
      expect(pidAlive(res.handoff!.child.pid!)).toBe(true);
    } finally {
      if (res.handoff?.child.pid) killProcessTree(res.handoff.child.pid);
    }
  });

  it('handoff keeps stdio open for output a detached descendant writes after the main child exits (P1-4)', async () => {
    // The main shell lives past the handoff threshold, then backgrounds a
    // subshell (which inherits the stdout pipe) and exits. The descendant
    // writes 500ms later — long after the old waitForChild finalize would
    // have destroyed the streams at main-exit + STDIO_GRACE_MS (100ms),
    // silently discarding the descendant's output before the adopter saw it.
    const res = await runBash({
      command: 'sleep 0.3; ( sleep 0.5; echo DESCENDANT_LATE ) & exit 0',
      cwd: tmpdir(),
      timeoutSec: 30,
      autoBackgroundMs: 200,
    });
    expect(res.handoff).toBeDefined();
    const { child, detach } = res.handoff!;
    detach();
    let received = '';
    child.stdout!.on('data', (c: Buffer) => {
      received += c.toString('utf8');
    });
    try {
      const deadline = Date.now() + 5000;
      while (!received.includes('DESCENDANT_LATE') && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 50));
      }
      expect(received).toContain('DESCENDANT_LATE');
    } finally {
      if (child.pid) killProcessTree(child.pid);
    }
  });

  it('handoff keeps the spill fd sealed: pre-handoff spill stays readable for the adopter', async () => {
    // Output spills (>1KB with the small maxBytes) before the handoff; the
    // adopter path relies on the file being complete and closed at handoff.
    const dataDir = mkdtempSync(path.join(tmpdir(), 'zc-handoff-spill-'));
    const prev = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
    try {
      const res = await runBash({
        command: 'python3 -c "print(\'x\' * 5000)"; sleep 5',
        cwd: tmpdir(),
        timeoutSec: 30,
        maxBytes: 1024,
        autoBackgroundMs: 300,
      });
      try {
        expect(res.handoff).toBeDefined();
        expect(res.fullOutputPath).toBeDefined();
        const spilled = readFileSync(res.fullOutputPath!, 'utf8');
        expect(spilled.length).toBeGreaterThan(4900);
      } finally {
        if (res.handoff?.child.pid) killProcessTree(res.handoff.child.pid);
      }
    } finally {
      if (prev === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
      else process.env.ZCLAUDIA_DATA_DIR = prev;
      rmSync(dataDir, { recursive: true, force: true });
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

  function bashTool(dir: string, options: Record<string, unknown> = {}): any {
    return buildTools(dir, { enabled: ['Bash'], ...options }).find((t: any) => t.name === 'Bash');
  }

  it('moves a long-running foreground command into a background task', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const res = await bashTool(dir, { db, bashAutoBackgroundMs: 300 }).execute('ab1', {
      command: 'echo early; sleep 1; echo late',
    });

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

  it('keeps spilled pre-handoff output in the adopted task log', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const script = [
      'process.stdout.write("EARLY_MARKER\\n");',
      'process.stdout.write("x".repeat(70_000));',
      'process.stdout.write("\\nEARLY_END\\n");',
      'setTimeout(() => console.log("LATE_MARKER"), 500);',
    ].join('');
    const res = await bashTool(dir, { db, bashAutoBackgroundMs: 200 }).execute('ab-spilled', {
      command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
    });

    expect(res.details.background).toBe(true);
    expect(res.details.autoBackgrounded).toBe(true);

    const repo = new TaskRepository(db);
    const taskId = res.details.taskId as string;
    const completed = await waitUntil(() => repo.findById(taskId)?.status === 'completed');
    expect(completed).toBe(true);
    const log = readFileSync(commandTaskLogPath(taskId), 'utf8');
    expect(log).toContain('EARLY_MARKER');
    expect(log).toContain('EARLY_END');
    expect(log).toContain('LATE_MARKER');
    expect(log.length).toBeGreaterThan(70_000);
    rmSync(dir, { recursive: true, force: true });
  });

  it('adopted task log includes a large tail emitted right at handoff when the child exits immediately (P1-4)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const script = [
      'const fs = require("fs");',
      'setTimeout(() => {',
      '  fs.writeSync(1, Buffer.alloc(61440, 84));', // "T" * 60KB, fits the pipe
      '  fs.writeSync(1, Buffer.from("TAIL_BURST_END"));',
      '  process.exit(0);',
      '}, 400);',
    ].join('');
    const res = await bashTool(dir, { db, bashAutoBackgroundMs: 200 }).execute('ab-tail', {
      command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
    });

    expect(res.details.background).toBe(true);
    const repo = new TaskRepository(db);
    const taskId = res.details.taskId as string;
    const completed = await waitUntil(() => repo.findById(taskId)?.status === 'completed');
    expect(completed).toBe(true);
    const logReady = await waitUntil(() => {
      try {
        return readFileSync(commandTaskLogPath(taskId), 'utf8').includes('TAIL_BURST_END');
      } catch {
        return false;
      }
    });
    expect(logReady).toBe(true);
    const log = readFileSync(commandTaskLogPath(taskId), 'utf8');
    expect(log.length).toBeGreaterThanOrEqual(61440);
    rmSync(dir, { recursive: true, force: true });
  });

  it('marks the adopted task failed when the command exits non-zero', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const res = await bashTool(dir, { db, bashAutoBackgroundMs: 200 }).execute('ab2', {
      command: 'sleep 1; exit 3',
    });
    expect(res.details.autoBackgrounded).toBe(true);
    const repo = new TaskRepository(db);
    const taskId = res.details.taskId as string;
    const failed = await waitUntil(() => repo.findById(taskId)?.status === 'failed');
    expect(failed).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not auto-background without db context (waits to completion)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const res = await bashTool(dir, { bashAutoBackgroundMs: 200 }).execute('ab3', {
      command: 'sleep 1; echo fin',
    });
    expect(res.details.background).toBeUndefined();
    expect(res.details.exitCode).toBe(0);
    expect(res.content[0].text).toContain('fin');
    rmSync(dir, { recursive: true, force: true });
  });

  it('an explicit timeout disables auto-background and is honored', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const res = await bashTool(dir, { db, bashAutoBackgroundMs: 200 }).execute('ab4', {
      command: 'sleep 3; echo fin',
      timeout: 1,
    });
    expect(res.details.background).toBeUndefined();
    expect(res.details.timedOut).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('short commands behave exactly as before', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-autobg-'));
    const res = await bashTool(dir, { db, bashAutoBackgroundMs: 5000 }).execute('ab5', {
      command: 'echo quick',
    });
    expect(res.details.ok).toBe(true);
    expect(res.details.background).toBeUndefined();
    expect(res.content[0].text).toContain('quick');
    rmSync(dir, { recursive: true, force: true });
  });
});

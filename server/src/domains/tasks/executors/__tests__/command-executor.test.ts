import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
} from 'fs';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { PassThrough, Writable } from 'stream';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../repository.js';
import { TaskService } from '../../task-service.js';
import {
  CommandTaskExecutor,
  commandTaskLogPath,
  pidAlive,
  pumpStreamWithBackpressure,
} from '../command-executor.js';
import { runBash } from '../../../../infra/providers/pi-runtime/bash-runner.js';
import * as sandbox from '../../../../infra/providers/pi-runtime/sandbox.js';

// Node builtin namespaces are frozen in ESM (no vi.spyOn), so mock 'fs' at the
// module level: delegating wrappers keep real behavior, with a flag-driven
// rename failure to exercise adopt()'s streamed-copy fallback.
const fsMockState = vi.hoisted(() => ({ renameShouldThrow: false }));

vi.mock('fs', async importOriginal => {
  const actual = (await importOriginal()) as typeof fs;
  return {
    ...actual,
    renameSync: vi.fn((src: fs.PathLike, dest: fs.PathLike) => {
      if (fsMockState.renameShouldThrow) {
        throw new Error('EXDEV: cross-device link not permitted (test stub)');
      }
      return actual.renameSync(src, dest);
    }),
    readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) =>
      (actual.readFileSync as (...a: unknown[]) => unknown)(...args)
    ),
  };
});

let db: Database.Database;
let dataDir: string;
let prevDataDir: string | undefined;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);

  dataDir = mkdtempSync(join(tmpdir(), 'zc-cmdexec-'));
  prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
  process.env.ZCLAUDIA_DATA_DIR = dataDir;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (prevDataDir === undefined) {
    delete process.env.ZCLAUDIA_DATA_DIR;
  } else {
    process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

describe('CommandTaskExecutor', () => {
  it('start spawns detached, writes output to the log file, and exit 0 completes the task', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({
      type: 'command',
      metadata: { command: 'echo bg-hello', cwd: dataDir },
    });
    const started = await executor.start(task);
    expect(started.status).toBe('running');
    expect(typeof started.executorRef?.pid).toBe('number');
    service.startTask(task.id, { executorRef: started.executorRef });
    await wait(700);
    const after = repo.findById(task.id)!;
    expect(after.status).toBe('completed');
    expect(readFileSync(commandTaskLogPath(task.id), 'utf8')).toContain('bg-hello');
  });

  it('non-zero exit fails the task with the code in the result', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({
      type: 'command',
      metadata: { command: 'exit 4', cwd: dataDir },
    });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    await wait(700);
    const after = repo.findById(task.id)!;
    expect(after.status).toBe('failed');
    expect(after.result?.error).toContain('4');
  });

  it('stop kills the process tree and transitions to stopped', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({
      type: 'command',
      metadata: { command: 'sleep 30', cwd: dataDir },
    });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    const pid = started.executorRef!.pid!;
    expect(pidAlive(pid)).toBe(true);
    await executor.stop(task.id, 'test stop');
    await wait(300);
    expect(pidAlive(pid)).toBe(false);
    expect(repo.findById(task.id)!.status).toBe('stopped');
  });

  it('stop resolves only after the process is confirmed dead (P2)', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({
      type: 'command',
      metadata: { command: 'sleep 30', cwd: dataDir },
    });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    const pid = started.executorRef!.pid!;
    const update = await executor.stop(task.id);
    // No post-stop settling wait: the kill must be confirmed by stop() itself.
    expect(pidAlive(pid)).toBe(false);
    expect(update.status).toBe('stopped');
    expect(repo.findById(task.id)!.result?.error ?? '').not.toContain(
      'could not be confirmed dead'
    );
  });

  it('stores the structured exit code in task metadata at finalize (P2)', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const failed = service.createTask({
      type: 'command',
      metadata: { command: 'exit 4', cwd: dataDir },
    });
    const startedFailed = await executor.start(failed);
    service.startTask(failed.id, { executorRef: startedFailed.executorRef });
    const ok = service.createTask({
      type: 'command',
      metadata: { command: 'true', cwd: dataDir },
    });
    const startedOk = await executor.start(ok);
    service.startTask(ok.id, { executorRef: startedOk.executorRef });
    await wait(700);

    expect(repo.findById(failed.id)!.metadata?.exitCode).toBe(4);
    expect(repo.findById(ok.id)!.metadata?.exitCode).toBe(0);
  });

  it('sweeps task logs older than 24h when a new task starts, keeping recent ones (P2)', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const logsDir = join(dataDir, 'task-logs');
    mkdirSync(logsDir, { recursive: true });
    const stale = join(logsDir, 'stale-task.log');
    writeFileSync(stale, 'old');
    const backdated = Date.now() / 1000 - 25 * 60 * 60; // 25h ago, past the TTL
    utimesSync(stale, backdated, backdated);
    const fresh = join(logsDir, 'fresh-task.log');
    writeFileSync(fresh, 'new');

    const task = service.createTask({
      type: 'command',
      metadata: { command: 'echo sweep-trigger', cwd: dataDir },
    });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });

    expect(existsSync(stale)).toBe(false); // swept
    expect(existsSync(fresh)).toBe(true); // recent, kept
    expect(existsSync(commandTaskLogPath(task.id))).toBe(true); // own log untouched
    await executor.stop(task.id);
  });

  it('reconcile attaches an exit watcher that settles a live-pid task when the process exits (P2)', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    // Simulate a previous server life's task: a real live process started
    // OUTSIDE the executor — we hold no ChildProcess handle, so no 'exit'
    // event can ever reach the executor; only the reconcile-attached pid
    // watcher can settle the task.
    const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    child.unref();
    const pid = child.pid!;
    try {
      const task = service.createTask({
        type: 'command',
        metadata: { command: 'sleep 30', cwd: dataDir },
      });
      service.startTask(task.id, { executorRef: { pid, command: 'sleep 30' } });

      executor.reconcile();
      expect(repo.findById(task.id)!.status).toBe('running'); // still alive → left running

      process.kill(-pid, 'SIGKILL'); // process exits with nobody watching
      expect(await waitUntil(() => repo.findById(task.id)?.status === 'completed', 6000)).toBe(
        true
      );
      const settled = repo.findById(task.id)!;
      expect(settled.result?.text).toContain('exit code unknown');
      // ...and the settle went through the real lifecycle (settled event emitted)
      expect(repo.listEvents(task.id).map(e => e.type)).toContain('completed');
    } finally {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
  });

  it('stop on an already-completed task is a quiet no-op', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({
      type: 'command',
      metadata: { command: 'echo done', cwd: dataDir },
    });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    await wait(700); // let it complete
    expect(repo.findById(task.id)!.status).toBe('completed');
    await expect(executor.stop(task.id, 'late stop')).resolves.toMatchObject({
      status: 'completed',
    });
    expect(repo.findById(task.id)!.status).toBe('completed'); // unchanged
  });

  it('async spawn failure (nonexistent cwd) fails the task via the error watch', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({
      type: 'command',
      metadata: { command: 'echo hi', cwd: join(dataDir, 'no-such-dir') },
    });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    await wait(500);
    const after = repo.findById(task.id)!;
    expect(after.status).toBe('failed');
    expect(after.result?.error).toContain('spawn error');
  });

  it('start rejects a task without metadata.command', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({ type: 'command', metadata: {} });
    await expect(executor.start(task)).rejects.toThrow(/command/);
  });

  it('reconcile finalizes running tasks whose pid is dead and leaves live ones running', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const dead = service.createTask({ type: 'command', metadata: { command: 'noop' } });
    service.startTask(dead.id, { executorRef: { pid: 99999999, command: 'noop' } });
    const live = service.createTask({
      type: 'command',
      metadata: { command: 'sleep 30', cwd: dataDir },
    });
    const started = await executor.start(repo.findById(live.id)!);
    service.startTask(live.id, { executorRef: started.executorRef });

    executor.reconcile();

    expect(repo.findById(dead.id)!.status).toBe('stopped');
    expect(repo.findById(live.id)!.status).toBe('running');
    await executor.stop(live.id);
  });

  it('spawns the sandbox-wrapped argv when sandbox is available', async () => {
    const markerPath = join(dataDir, 'bgmarker.txt');
    vi.spyOn(sandbox, 'wrapCommand').mockResolvedValue({
      sandboxed: true,
      argv: ['sh', '-c', `echo BG_SANDBOXED > "${markerPath}"`],
      env: process.env,
    });
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({
      type: 'command',
      metadata: { command: 'echo original', cwd: dataDir },
    });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    await new Promise(r => setTimeout(r, 700));
    expect(readFileSync(markerPath, 'utf8')).toContain('BG_SANDBOXED');
  });

  it('rejects sandbox-required tasks when wrapping is unavailable', async () => {
    vi.spyOn(sandbox, 'wrapCommand').mockResolvedValue({ sandboxed: false });
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({
      type: 'command',
      metadata: {
        command: 'echo should-not-run',
        cwd: dataDir,
        workspaceRoot: dataDir,
        sandboxRequired: true,
      },
    });

    await expect(executor.start(task)).rejects.toThrow(/sandbox required/);
  });

  it('passes workspace root and allowed domains to sandbox wrapping', async () => {
    const wrap = vi.spyOn(sandbox, 'wrapCommand').mockResolvedValue({
      sandboxed: true,
      argv: ['sh', '-c', 'echo domain-test'],
      env: process.env,
    });
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({
      type: 'command',
      metadata: {
        command: 'echo original',
        cwd: dataDir,
        workspaceRoot: join(dataDir, 'workspace-root'),
        sandboxAllowedDomains: ['example.test'],
      },
    });

    await executor.start(task);

    expect(wrap).toHaveBeenCalledWith(
      'echo original',
      expect.objectContaining({
        workspaceRoot: join(dataDir, 'workspace-root'),
        extraAllowedDomains: ['example.test'],
      })
    );
  });
});

async function waitUntil(predicate: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return predicate();
}

describe('pumpStreamWithBackpressure', () => {
  it('pauses the source when the sink buffers and resumes it on drain', async () => {
    const source = new PassThrough();
    const flushes: Array<() => void> = [];
    const sink = new Writable({
      highWaterMark: 16,
      write(_chunk, _enc, cb) {
        flushes.push(() => cb()); // hold the callback: the sink stays "full"
      },
    });
    pumpStreamWithBackpressure(source, sink);

    source.write(Buffer.alloc(64)); // one chunk already exceeds the 16-byte hwm
    await new Promise(r => setImmediate(r));
    expect(source.isPaused()).toBe(true);

    flushes.splice(0).forEach(flush => flush()); // sink drains
    await new Promise(r => setImmediate(r));
    expect(source.isPaused()).toBe(false);
    sink.end();
  });

  it('delivers all data in order once the sink drains', async () => {
    const source = new PassThrough();
    const chunks: Buffer[] = [];
    const sink = new Writable({
      highWaterMark: 8,
      write(chunk, _enc, cb) {
        chunks.push(chunk);
        setImmediate(cb); // slow sink forces repeated backpressure
      },
    });
    pumpStreamWithBackpressure(source, sink);
    source.on('end', () => sink.end());
    const expected = Array.from({ length: 50 }, (_, i) => `chunk-${i}\n`).join('');
    source.end(expected);
    await new Promise<void>(resolve => sink.on('finish', resolve));
    expect(Buffer.concat(chunks).toString('utf8')).toBe(expected);
  });
});

describe('CommandTaskExecutor.adopt (P1-4/P1-5)', () => {
  function adoptableChildScript(postDelayMs: number, extra = ''): string {
    return [
      'const fs = require("fs");',
      'const block = Buffer.alloc(1024 * 1024, 120);', // 1MB of "x"
      'for (let i = 0; i < 3; i++) fs.writeSync(1, block);',
      'fs.writeSync(1, Buffer.from("PRE_HANDOFF_END"));',
      `setTimeout(() => { ${extra} fs.writeSync(1, Buffer.from("POST_ADOPT_TAIL")); process.exit(0); }, ${postDelayMs});`,
    ].join('');
  }

  it('moves a multi-MB pre-handoff spill into the task log via rename, not readFileSync', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const renameMock = vi.mocked(fs.renameSync);
    const readMock = vi.mocked(fs.readFileSync);
    renameMock.mockClear();
    readMock.mockClear();

    const res = await runBash({
      command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(adoptableChildScript(800))}`,
      cwd: dataDir,
      timeoutSec: 30,
      autoBackgroundMs: 300,
    });
    expect(res.handoff).toBeDefined();
    expect(res.fullOutputPath).toBeDefined(); // 3MB pre-handoff output spilled
    const spillPath = res.fullOutputPath!;
    expect(existsSync(spillPath)).toBe(true);

    const task = service.createTask({
      type: 'command',
      metadata: { command: 'adopted', cwd: dataDir },
    });
    res.handoff!.detach();
    executor.adopt(task, res.handoff!.child, res.fullOutput, res.fullOutputPath);
    service.startTask(task.id, { executorRef: { pid: res.handoff!.child.pid } });

    expect(await waitUntil(() => repo.findById(task.id)?.status === 'completed')).toBe(true);
    expect(
      await waitUntil(() => {
        try {
          return readFileSync(commandTaskLogPath(task.id), 'utf8').includes('POST_ADOPT_TAIL');
        } catch {
          return false;
        }
      })
    ).toBe(true);

    const logPath = commandTaskLogPath(task.id);
    const log = readFileSync(logPath, 'utf8');
    expect(log.length).toBeGreaterThan(3 * 1024 * 1024);
    expect(log).toContain('PRE_HANDOFF_END');
    // rename: the spill moved into the log path instead of being copied through memory
    expect(renameMock).toHaveBeenCalledWith(spillPath, logPath);
    expect(readMock).not.toHaveBeenCalledWith(spillPath);
    expect(existsSync(spillPath)).toBe(false);
  });

  it('falls back to a streamed copy when the spill rename fails', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    fsMockState.renameShouldThrow = true;

    try {
      const res = await runBash({
        command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(adoptableChildScript(800))}`,
        cwd: dataDir,
        timeoutSec: 30,
        autoBackgroundMs: 300,
      });
      expect(res.handoff).toBeDefined();
      const spillPath = res.fullOutputPath!;

      const task = service.createTask({
        type: 'command',
        metadata: { command: 'adopted', cwd: dataDir },
      });
      res.handoff!.detach();
      executor.adopt(task, res.handoff!.child, res.fullOutput, res.fullOutputPath);
      service.startTask(task.id, { executorRef: { pid: res.handoff!.child.pid } });

      expect(await waitUntil(() => repo.findById(task.id)?.status === 'completed')).toBe(true);
      expect(
        await waitUntil(() => {
          try {
            return readFileSync(commandTaskLogPath(task.id), 'utf8').includes('POST_ADOPT_TAIL');
          } catch {
            return false;
          }
        })
      ).toBe(true);

      const log = readFileSync(commandTaskLogPath(task.id), 'utf8');
      expect(log.length).toBeGreaterThan(3 * 1024 * 1024);
      expect(log).toContain('PRE_HANDOFF_END');
      expect(log).toContain('POST_ADOPT_TAIL');
      // copy fallback keeps the source spill in place
      expect(existsSync(spillPath)).toBe(true);
    } finally {
      fsMockState.renameShouldThrow = false;
    }
  });

  it('keeps the adopted log open for detached-descendant output after the main child exits (P1-4)', async () => {
    // The main shell backgrounds a subshell (inheriting the stdout pipe) and
    // exits; the descendant writes 500ms later. The task settles on the main
    // exit, but the log stream must stay open until the pipe actually drains
    // — closing at 'exit' (or destroying the streams, as the runner's old
    // grace finalize did) would silently drop the descendant's output.
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const res = await runBash({
      command: 'echo MAIN_LINE; sleep 0.3; ( sleep 0.5; echo DESCENDANT_LATE ) & exit 0',
      cwd: dataDir,
      timeoutSec: 30,
      autoBackgroundMs: 200,
    });
    expect(res.handoff).toBeDefined();
    const { child, detach } = res.handoff!;
    detach();

    const task = service.createTask({
      type: 'command',
      metadata: { command: 'adopted', cwd: dataDir },
    });
    executor.adopt(task, child, res.fullOutput, res.fullOutputPath);
    service.startTask(task.id, { executorRef: { pid: child.pid } });

    expect(await waitUntil(() => repo.findById(task.id)?.status === 'completed')).toBe(true);
    expect(
      await waitUntil(() => {
        try {
          return readFileSync(commandTaskLogPath(task.id), 'utf8').includes('DESCENDANT_LATE');
        } catch {
          return false;
        }
      })
    ).toBe(true);
    const log = readFileSync(commandTaskLogPath(task.id), 'utf8');
    expect(log).toContain('MAIN_LINE');
    expect(log).toContain('DESCENDANT_LATE');
  });

  it('settles immediately when the child exited between handoff and adoption', async () => {
    // The child exits (non-zero) right after the handoff threshold, before
    // adopt() runs. Note: output still sitting in the pipes at that point is
    // drained and discarded by Node's own exit-time flush (flushStdio resumes
    // listener-less stdio), so this path can only settle the task and keep
    // the pre-handoff capture — it cannot recover post-handoff pipe output.
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const res = await runBash({
      command: 'echo EARLY_ONLY; sleep 0.4; exit 3',
      cwd: dataDir,
      timeoutSec: 30,
      autoBackgroundMs: 200,
    });
    expect(res.handoff).toBeDefined();
    const { child, detach } = res.handoff!;
    detach();

    await new Promise(r => setTimeout(r, 800));
    expect(child.exitCode).toBe(3); // exited before adoption

    const task = service.createTask({
      type: 'command',
      metadata: { command: 'adopted', cwd: dataDir },
    });
    executor.adopt(task, child, res.fullOutput, res.fullOutputPath);
    // adopt() settles synchronously here (child already exited); bash-tool
    // mirrors this by only starting tasks that are not already terminal.
    const postAdopt = repo.findById(task.id);
    if (postAdopt && postAdopt.status === 'queued') {
      service.startTask(task.id, { executorRef: { pid: child.pid } });
    }

    const settled = await waitUntil(() => repo.findById(task.id)?.status === 'failed');
    expect(settled).toBe(true);
    expect(repo.findById(task.id)?.result?.error).toContain('3');
    const logReady = await waitUntil(() => {
      try {
        return readFileSync(commandTaskLogPath(task.id), 'utf8').includes('EARLY_ONLY');
      } catch {
        return false;
      }
    });
    expect(logReady).toBe(true);
  });
});

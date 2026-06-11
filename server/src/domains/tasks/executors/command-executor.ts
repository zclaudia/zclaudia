import { spawn } from 'child_process';
import { mkdirSync, openSync, closeSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TaskRecord, TaskStatus } from '@zclaudia/shared/core/task';
import { resolveShell, killProcessTree } from '../../../infra/providers/pi-runtime/bash-runner.js';
import * as sandbox from '../../../infra/providers/pi-runtime/sandbox.js';
import { TaskRepository } from '../repository.js';
import { TaskService } from '../task-service.js';
import type { TaskExecutor, TaskExecutorUpdate } from './types.js';

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'stopped']);

export function resolveDataDir(): string {
  return process.env.ZCLAUDIA_DATA_DIR
    ? path.resolve(process.env.ZCLAUDIA_DATA_DIR)
    : path.join(os.homedir(), '.zclaudia');
}

export function commandTaskLogPath(taskId: string): string {
  return path.join(resolveDataDir(), 'task-logs', `${taskId}.log`);
}

/** Probe whether a pid is alive. EPERM means alive-but-not-ours. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Executor for background shell commands. Children are detached with stdio
 * redirected to a per-task log file, so output survives server restarts and
 * no pipe is ever held open.
 */
export class CommandTaskExecutor implements TaskExecutor {
  readonly type = 'command' as const;
  private readonly service: TaskService;

  constructor(private readonly repo: TaskRepository) {
    this.service = new TaskService(repo);
  }

  async start(task: TaskRecord): Promise<TaskExecutorUpdate> {
    const meta = (task.metadata ?? {}) as { command?: unknown; cwd?: unknown };
    const command = typeof meta.command === 'string' ? meta.command.trim() : '';
    if (!command) throw new Error('command task requires metadata.command');
    const cwd = typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : process.cwd();

    const wrap = await sandbox.wrapCommand(command, { workspaceRoot: cwd });

    const logPath = commandTaskLogPath(task.id);
    mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = openSync(logPath, 'a');
    let child;
    try {
      const { shell, args } = resolveShell();
      const spawnFile = wrap.sandboxed ? wrap.argv![0] : shell;
      const spawnArgs = wrap.sandboxed ? wrap.argv!.slice(1) : [...args, command];
      const spawnEnv = wrap.sandboxed ? wrap.env! : process.env;
      child = spawn(spawnFile, spawnArgs, {
        cwd,
        env: spawnEnv,
        detached: process.platform !== 'win32',
        stdio: ['ignore', fd, fd],
        windowsHide: true,
      });
    } finally {
      closeSync(fd);
    }
    child.unref();
    child.on('error', (err) => this.finalize(task.id, null, `spawn error: ${err.message}`));
    child.on('exit', (code) => this.finalize(task.id, code));
    return { status: 'running', executorRef: { pid: child.pid, command } };
  }

  /** Finalize on observed exit. Skips quietly if the task is already terminal (e.g. stopped first). */
  private finalize(taskId: string, exitCode: number | null, errorNote?: string): void {
    try {
      const current = this.repo.findById(taskId);
      if (!current || TERMINAL.has(current.status)) return;
      if (errorNote) {
        this.service.failTask(taskId, { error: errorNote });
      } else if (exitCode === 0) {
        this.service.completeTask(taskId, { text: 'Command exited with code 0' });
      } else {
        this.service.failTask(taskId, {
          text: `Command exited with code ${exitCode}`,
          error: `exit code ${exitCode}`,
        });
      }
    } catch {
      // lifecycle race (stopped concurrently) — already terminal, nothing to do
    }
  }

  async stop(taskId: string, reason?: string): Promise<TaskExecutorUpdate> {
    const task = this.repo.findById(taskId);
    if (!task) return { status: 'stopped' };
    const pid = task.executorRef?.pid;
    if (typeof pid === 'number') killProcessTree(pid);
    if (!TERMINAL.has(task.status)) {
      try {
        this.service.stopTask(taskId, reason ? { error: reason } : undefined);
      } catch {
        // already transitioned by the exit watch — fine
      }
    }
    const after = this.repo.findById(taskId);
    return { status: after?.status ?? 'stopped', result: after?.result };
  }

  async wait(taskId: string, options?: { timeoutMs?: number }): Promise<TaskExecutorUpdate> {
    const deadline = Date.now() + (options?.timeoutMs ?? 24 * 60 * 60 * 1000);
    for (;;) {
      const task = this.repo.findById(taskId);
      if (!task) return { status: 'stopped' };
      if (TERMINAL.has(task.status)) return { status: task.status, result: task.result };
      if (Date.now() >= deadline) return { status: task.status };
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /**
   * Startup reconcile: command tasks recorded as queued/running from a previous
   * server life. queued → never actually started → stopped. running + dead pid →
   * stopped with a note. running + live pid → re-adopted (left as-is).
   */
  reconcile(): void {
    for (const task of this.repo.listByTypeAndStatuses('command', ['queued', 'running'])) {
      try {
        const pid = task.executorRef?.pid;
        if (task.status === 'queued' || typeof pid !== 'number' || !pidAlive(pid)) {
          this.service.stopTask(task.id, { error: 'process not found after server restart' });
        }
      } catch {
        // best-effort
      }
    }
  }
}

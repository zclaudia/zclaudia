import { spawn, type ChildProcess } from 'child_process';
import {
  mkdirSync,
  openSync,
  closeSync,
  createReadStream,
  createWriteStream,
  renameSync,
} from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Readable, Writable } from 'stream';
import type { TaskRecord, TaskStatus } from '@zclaudia/shared/core/task';
import { resolveShell, killProcessTree } from '../../../infra/providers/pi-runtime/bash-runner.js';
import { scrubEnv } from '../../../infra/providers/pi-runtime/env-scrub.js';
import * as sandbox from '../../../infra/providers/pi-runtime/sandbox.js';
import {
  networkGrantToAllowedDomain,
  type SandboxGrant,
} from '../../../infra/providers/pi-runtime/sandbox-execution/index.js';
import { type TaskRepository } from '../repository.js';
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

/**
 * Grace window after an adopted child's `exit` before its log stream is closed
 * even if stdio never signals `end` (a detached descendant holding the pipes
 * open). Normal drains close the stream far earlier via the `end` listeners.
 */
const ADOPT_DRAIN_GRACE_MS = 5000;

/**
 * Pump one child stdio stream into the task log with backpressure: when the
 * log writer's buffer fills (write() === false), pause the source and resume
 * it on 'drain', so an output-heavy adopted command cannot grow the writer's
 * in-memory queue without bound.
 */
export function pumpStreamWithBackpressure(source: Readable, sink: Writable): void {
  source.on('data', (chunk: Buffer) => {
    if (!sink.write(chunk)) {
      source.pause();
      sink.once('drain', () => source.resume());
    }
  });
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
    const meta = (task.metadata ?? {}) as {
      command?: unknown;
      cwd?: unknown;
      workspaceRoot?: unknown;
      sandboxAllowedDomains?: unknown;
      sandboxReadOnly?: unknown;
      sandboxRequired?: unknown;
      privilegePlan?: unknown;
    };
    const command = typeof meta.command === 'string' ? meta.command.trim() : '';
    if (!command) throw new Error('command task requires metadata.command');
    const cwd = typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : process.cwd();
    const workspaceRoot =
      typeof meta.workspaceRoot === 'string' && meta.workspaceRoot ? meta.workspaceRoot : cwd;
    const sandboxAllowedDomains = Array.isArray(meta.sandboxAllowedDomains)
      ? meta.sandboxAllowedDomains.filter(
          (domain): domain is string => typeof domain === 'string' && domain.trim().length > 0
        )
      : [];
    const privilegePlan =
      meta.privilegePlan && typeof meta.privilegePlan === 'object'
        ? (meta.privilegePlan as { mode?: unknown; grants?: unknown })
        : undefined;
    const privilegeGrants = Array.isArray(privilegePlan?.grants)
      ? (privilegePlan.grants.filter(
          (grant): grant is SandboxGrant =>
            !!grant && typeof grant === 'object' && (grant as { type?: unknown }).type === 'network'
        ) as SandboxGrant[])
      : [];
    const extraAllowedDomains = [
      ...sandboxAllowedDomains,
      ...privilegeGrants.map(networkGrantToAllowedDomain),
    ];

    const forceUnsandboxed = privilegePlan?.mode === 'unsandboxed';
    const wrap = forceUnsandboxed
      ? ({ sandboxed: false } as sandbox.WrapResult)
      : await sandbox.wrapCommand(command, {
          workspaceRoot,
          readOnly: meta.sandboxReadOnly === true,
          extraAllowedDomains,
        });
    if (!wrap.sandboxed && meta.sandboxRequired === true) {
      throw new Error('sandbox required for this command, but the sandbox is unavailable');
    }
    try {
      this.repo.update(task.id, { metadata: { sandboxed: wrap.sandboxed } });
    } catch {
      // Best-effort metadata for TaskOutput; failure should not block process start.
    }

    const logPath = commandTaskLogPath(task.id);
    mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = openSync(logPath, 'a');
    let child;
    try {
      const { shell, args } = resolveShell();
      const spawnFile = wrap.sandboxed ? wrap.argv![0] : shell;
      const spawnArgs = wrap.sandboxed ? wrap.argv!.slice(1) : [...args, command];
      // Sandbox env arrives already scrubbed by wrapCommand; the unsandboxed
      // path scrubs here (same policy as the foreground bash-runner).
      const spawnEnv = wrap.sandboxed ? wrap.env! : scrubEnv(process.env);
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
    child.on('error', err => this.finalize(task.id, null, `spawn error: ${err.message}`));
    child.on('exit', code => this.finalize(task.id, code));
    return { status: 'running', executorRef: { pid: child.pid, command } };
  }

  /**
   * Adopt an already-running child (auto-backgrounded foreground command).
   * Output captured so far plus all future stdio is appended to the task log,
   * and the task is finalized on exit, mirroring start(). Unlike start(), the
   * child's stdio is piped to this process, so output stops if the server dies;
   * reconcile() then settles the task by pid liveness as usual.
   *
   * Pre-handoff output moves into the log without a full in-memory copy: the
   * runner seals the spill file at handoff and both directories share the same
   * data dir, so an atomic rename is used when possible, with a streamed
   * backpressure-aware copy as fallback. A buffering consumer is attached
   * synchronously at entry because Node resumes (flushStdio) child stdio on
   * exit — a listener-less stream would be drained and discarded. The log
   * stream closes only once stdio has actually drained (or a grace expires),
   * so tail output still in the pipes at handoff/exit is not lost.
   */
  adopt(
    task: TaskRecord,
    child: ChildProcess,
    initialOutput: string,
    initialOutputPath?: string
  ): TaskExecutorUpdate {
    const meta = (task.metadata ?? {}) as { command?: unknown };
    const command = typeof meta.command === 'string' ? meta.command : '';
    const logPath = commandTaskLogPath(task.id);
    mkdirSync(path.dirname(logPath), { recursive: true });

    // Freeze live output while the pre-handoff capture is moved/copied into
    // the log so entries stay chronological; the pipes buffer in the meantime
    // (the child simply blocks on a full pipe — natural backpressure). The
    // buffering consumer must be registered *before* any await: when the child
    // exits, Node resumes its stdio (flushStdio), and a stream with no 'data'
    // listener is drained and discarded.
    const earlyChunks: Buffer[] = [];
    const collect = (chunk: Buffer) => earlyChunks.push(chunk);
    let stdoutEnded = !child.stdout || child.stdout.readableEnded;
    let stderrEnded = !child.stderr || child.stderr.readableEnded;
    let liveAttached = false;
    let streamClosed = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const stream = createWriteStream(logPath, { flags: 'a' });
    stream.on('error', err => {
      console.warn(`[CommandTaskExecutor] adopted task ${task.id} log stream error:`, err.message);
    });
    const closeStream = () => {
      if (streamClosed) return;
      streamClosed = true;
      if (graceTimer) clearTimeout(graceTimer);
      try {
        stream.end();
      } catch {
        /* already closed */
      }
    };
    const maybeCloseStream = () => {
      // Only after live output is attached: closing earlier would race the
      // earlyChunks flush and any copy still in progress.
      if (liveAttached && stdoutEnded && stderrEnded) closeStream();
    };
    const onStdoutEnd = () => {
      stdoutEnded = true;
      maybeCloseStream();
    };
    const onStderrEnd = () => {
      stderrEnded = true;
      maybeCloseStream();
    };
    if (child.stdout) {
      child.stdout.on('data', collect);
      child.stdout.on('end', onStdoutEnd);
      child.stdout.pause();
    }
    if (child.stderr) {
      child.stderr.on('data', collect);
      child.stderr.on('end', onStderrEnd);
      child.stderr.pause();
    }

    const attachLiveOutput = () => {
      if (liveAttached) return;
      liveAttached = true;
      if (child.stdout) child.stdout.off('data', collect);
      if (child.stderr) child.stderr.off('data', collect);
      for (const chunk of earlyChunks.splice(0)) stream.write(chunk);
      if (child.stdout) {
        pumpStreamWithBackpressure(child.stdout, stream);
        child.stdout.resume();
      }
      if (child.stderr) {
        pumpStreamWithBackpressure(child.stderr, stream);
        child.stderr.resume();
      }
      maybeCloseStream(); // both streams may already have ended before adoption
    };

    let spillMoved = false;
    if (initialOutputPath) {
      try {
        renameSync(initialOutputPath, logPath);
        spillMoved = true;
      } catch {
        spillMoved = false; // fall through to the streamed copy below
      }
    }

    if (spillMoved) {
      attachLiveOutput();
    } else if (initialOutputPath) {
      // Streamed fallback copy (rename failed): pipe the spill into the log
      // with backpressure, attach live output afterwards to preserve order.
      let copySettled = false;
      const finishCopy = (useTailFallback: boolean) => {
        if (copySettled) return;
        copySettled = true;
        if (useTailFallback && initialOutput) stream.write(initialOutput);
        attachLiveOutput();
      };
      const spillRead = createReadStream(initialOutputPath);
      spillRead.on('error', () => finishCopy(true));
      spillRead.on('end', () => finishCopy(false));
      spillRead.pipe(stream, { end: false });
    } else {
      if (initialOutput) stream.write(initialOutput);
      attachLiveOutput();
    }

    // The task settles on `exit`, but the log must stay open until stdio
    // actually drains ('end') so the tail still in the pipes is written; the
    // grace timer only covers a detached descendant holding the pipes open.
    const armDrainGrace = () => {
      if (graceTimer) return;
      graceTimer = setTimeout(closeStream, ADOPT_DRAIN_GRACE_MS);
      graceTimer.unref();
    };

    child.on('error', err => {
      closeStream();
      this.finalize(task.id, null, `adopted process error: ${err.message}`);
    });
    if (child.exitCode !== null || child.signalCode !== null) {
      // Exited between handoff and adoption — settle immediately; the drain
      // wiring above still captures whatever the pipes are holding.
      armDrainGrace();
      this.finalize(task.id, child.exitCode);
    } else {
      child.on('exit', code => {
        armDrainGrace();
        this.finalize(task.id, code);
      });
    }
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
      await new Promise(r => setTimeout(r, 500));
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

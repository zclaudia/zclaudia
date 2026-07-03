import { spawn } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import type { TaskRecord, TaskStatus } from '@zclaudia/shared/core/task';

import { type TaskRepository } from '../../../domains/tasks/repository.js';
import { TaskService } from '../../../domains/tasks/task-service.js';
import type { TaskExecutorUpdate } from '../../../domains/tasks/executors/types.js';
import { killProcessTree } from './bash-runner.js';
import { pidAlive, resolveDataDir } from '../../../domains/tasks/executors/command-executor.js';
import * as sandbox from './sandbox.js';
import {
  networkGrantToAllowedDomain,
  type SandboxGrant,
} from './sandbox-execution/index.js';
import { readTaskLogWindow } from './task-output-window.js';
import { errorResult, textResult, truncateText } from './tool-common.js';
import type { TaskRuntime } from './task-runtime.js';
import { toWorkspaceRelative } from './workspace-paths.js';

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'stopped']);

const EVAL_TASK_SOURCE = [
  "'use strict';",
  "const fs = require('fs');",
  "const vm = require('vm');",
  "const util = require('util');",
  "const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));",
  "fs.mkdirSync(require('path').dirname(payload.logPath), { recursive: true });",
  "const log = fs.createWriteStream(payload.logPath, { flags: 'a', mode: 0o600 });",
  'function writeLog(text) { log.write(String(text)); }',
  'const kernelConsole = {};',
  "for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {",
  "  kernelConsole[level] = (...args) => writeLog(args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4, maxArrayLength: 200, maxStringLength: 8192 }))).join(' ') + '\\n');",
  '}',
  'const contextObject = {',
  '  console: kernelConsole, require, process, Buffer,',
  '  URL, URLSearchParams, TextEncoder, TextDecoder,',
  '  setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,',
  '  AbortController, AbortSignal, structuredClone, fetch: globalThis.fetch, crypto: globalThis.crypto,',
  '};',
  'contextObject.globalThis = contextObject;',
  'const context = vm.createContext(contextObject);',
  'function inspectValue(value) { return util.inspect(value, { depth: 4, maxArrayLength: 200, maxStringLength: 8192 }); }',
  '(async () => {',
  '  try {',
  '    let value;',
  "    if (/\\bawait\\b/.test(payload.code)) value = await vm.runInContext('(async () => {\\n' + payload.code + '\\n})()', context, { filename: 'eval-task' });",
  "    else { value = vm.runInContext(payload.code, context, { filename: 'eval-task' }); if (value && typeof value.then === 'function') value = await value; }",
  "    const text = value === undefined ? 'Eval completed' : inspectValue(value);",
  "    if (value !== undefined) writeLog(text + '\\n');",
  "    fs.writeFileSync(payload.resultPath, JSON.stringify({ ok: true, text }), { encoding: 'utf8', mode: 0o600 });",
  '    log.end(() => process.exit(0));',
  '  } catch (err) {',
  '    const stack = err && err.stack ? String(err.stack) : String(err);',
  "    const error = stack.split('\\n').slice(0, 8).join('\\n');",
  "    writeLog(error + '\\n');",
  "    fs.writeFileSync(payload.resultPath, JSON.stringify({ ok: false, error }), { encoding: 'utf8', mode: 0o600 });",
  '    log.end(() => process.exit(1));',
  '  }',
  '})();',
].join('\n');

function evalTaskLogPath(taskId: string): string {
  return path.join(resolveDataDir(), 'task-logs', `${taskId}.log`);
}

function evalTaskResultPath(taskId: string): string {
  return path.join(resolveDataDir(), 'task-logs', `${taskId}.result.json`);
}

function evalTaskScriptPath(): string {
  const dir = path.join(resolveDataDir(), 'task-scripts');
  mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, 'eval-task-runner.cjs');
  writeFileSync(scriptPath, EVAL_TASK_SOURCE, { encoding: 'utf8', mode: 0o600 });
  return scriptPath;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function parseResult(
  resultPath: string
): { ok: true; text: string } | { ok: false; error: string } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(resultPath, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object') {
      const value = parsed as Record<string, unknown>;
      if (value.ok === true)
        return { ok: true, text: typeof value.text === 'string' ? value.text : 'Eval completed' };
      if (value.ok === false)
        return {
          ok: false,
          error: typeof value.error === 'string' ? value.error : 'Eval task failed',
        };
    }
  } catch {
    // result file is best-effort
  }
  return undefined;
}

export class EvalTaskRuntime implements TaskRuntime {
  readonly type = 'eval' as const;
  private readonly service: TaskService;
  private readonly reconcileWatches = new Set<string>();

  constructor(private readonly repo: TaskRepository) {
    this.service = new TaskService(repo);
  }

  async start(task: TaskRecord): Promise<TaskExecutorUpdate> {
    const metadata = (task.metadata ?? {}) as Record<string, unknown>;
    const code = typeof metadata.code === 'string' ? metadata.code : '';
    if (!code.trim()) throw new Error('eval task requires metadata.code');
    const workspaceRoot =
      typeof metadata.workspaceRoot === 'string' ? metadata.workspaceRoot : process.cwd();
    const readOnly = metadata.readOnly === true;
    const timeoutMs =
      typeof metadata.timeoutMs === 'number' && Number.isFinite(metadata.timeoutMs)
        ? metadata.timeoutMs
        : 30_000;
    const privilegePlan =
      metadata.privilegePlan && typeof metadata.privilegePlan === 'object'
        ? (metadata.privilegePlan as { mode?: unknown; grants?: unknown })
        : undefined;
    const privilegeGrants = Array.isArray(privilegePlan?.grants)
      ? (privilegePlan.grants.filter(
          (grant): grant is SandboxGrant =>
            !!grant && typeof grant === 'object' && (grant as { type?: unknown }).type === 'network'
        ) as SandboxGrant[])
      : [];
    const extraAllowedDomains = privilegeGrants.map(networkGrantToAllowedDomain);
    const logPath = evalTaskLogPath(task.id);
    const resultPath = evalTaskResultPath(task.id);
    mkdirSync(path.dirname(logPath), { recursive: true });
    const scriptPath = evalTaskScriptPath();
    const payloadPath = path.join(resolveDataDir(), 'task-scripts', `${task.id}.eval.json`);
    writeFileSync(payloadPath, JSON.stringify({ code, logPath, resultPath }), {
      encoding: 'utf8',
      mode: 0o600,
    });

    const forceUnsandboxed = privilegePlan?.mode === 'unsandboxed';
    const wrap = forceUnsandboxed
      ? ({ sandboxed: false } as sandbox.WrapResult)
      : await sandbox.wrapCommand(
          `${shellQuote(process.execPath)} ${shellQuote(scriptPath)} ${shellQuote(payloadPath)}`,
          {
            workspaceRoot,
            readOnly,
            extraAllowedDomains,
          }
        );
    if (!wrap.sandboxed && readOnly) {
      throw new Error('Eval task in read-only mode requires the sandbox, which is not available.');
    }
    this.repo.update(task.id, { metadata: { sandboxed: wrap.sandboxed, logPath, resultPath } });
    const child = wrap.sandboxed
      ? spawn(wrap.argv![0], wrap.argv!.slice(1), {
          cwd: workspaceRoot,
          env: wrap.env,
          detached: process.platform !== 'win32',
          stdio: 'ignore',
          windowsHide: true,
        })
      : spawn(process.execPath, [scriptPath, payloadPath], {
          cwd: workspaceRoot,
          detached: process.platform !== 'win32',
          stdio: 'ignore',
          windowsHide: true,
        });
    child.unref();
    const timer = setTimeout(() => {
      if (child.pid) killProcessTree(child.pid);
      this.finalize(task.id, null, 'Eval task timed out');
    }, timeoutMs);
    child.on('error', err => {
      clearTimeout(timer);
      this.finalize(task.id, null, `Eval task spawn error: ${err.message}`);
    });
    child.on('exit', code => {
      clearTimeout(timer);
      this.finalize(task.id, code);
    });
    return { status: 'running', executorRef: { pid: child.pid, command: 'eval' } };
  }

  private finalize(taskId: string, exitCode: number | null, errorNote?: string): void {
    try {
      const current = this.repo.findById(taskId);
      if (!current || TERMINAL.has(current.status)) return;
      const metadata = (current.metadata ?? {}) as Record<string, unknown>;
      const resultPath =
        typeof metadata.resultPath === 'string' ? metadata.resultPath : evalTaskResultPath(taskId);
      const result = parseResult(resultPath);
      if (errorNote) {
        this.service.failTask(taskId, { error: errorNote });
      } else if (result?.ok === true) {
        this.service.completeTask(taskId, { text: result.text });
      } else if (result?.ok === false) {
        this.service.failTask(taskId, { error: result.error });
      } else if (exitCode === 0) {
        this.service.completeTask(taskId, { text: 'Eval task completed' });
      } else {
        this.service.failTask(taskId, { error: `Eval task exited with code ${exitCode}` });
      }
    } catch {
      // lifecycle race
    }
  }

  private settleObservedExit(task: TaskRecord, fallbackError: string): TaskRecord {
    const current = this.repo.findById(task.id) ?? task;
    if (TERMINAL.has(current.status)) return current;
    const metadata = (current.metadata ?? {}) as Record<string, unknown>;
    const resultPath =
      typeof metadata.resultPath === 'string'
        ? metadata.resultPath
        : evalTaskResultPath(current.id);
    const result = parseResult(resultPath);
    if (result?.ok === true) {
      return this.service.completeTask(current.id, { text: result.text });
    }
    if (result?.ok === false) {
      return this.service.failTask(current.id, { error: result.error });
    }
    return this.service.stopTask(current.id, { error: fallbackError });
  }

  private taskTimeoutMs(task: TaskRecord): number {
    const metadata = (task.metadata ?? {}) as Record<string, unknown>;
    return typeof metadata.timeoutMs === 'number' && Number.isFinite(metadata.timeoutMs)
      ? metadata.timeoutMs
      : 30_000;
  }

  private watchReconciledTask(task: TaskRecord): void {
    if (this.reconcileWatches.has(task.id)) return;
    const pid = task.executorRef?.pid;
    if (typeof pid !== 'number') return;
    this.reconcileWatches.add(task.id);
    const timeoutAt = task.updatedAt + this.taskTimeoutMs(task);
    let interval: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;
    const clearWatch = () => {
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      this.reconcileWatches.delete(task.id);
    };
    const check = () => {
      const current = this.repo.findById(task.id);
      if (!current || TERMINAL.has(current.status)) {
        clearWatch();
        return;
      }
      const currentPid = current.executorRef?.pid;
      if (typeof currentPid !== 'number' || !pidAlive(currentPid)) {
        try {
          this.settleObservedExit(current, 'eval process not found after server restart');
        } catch {
          // lifecycle race
        }
        clearWatch();
        return;
      }
      if (Date.now() >= timeoutAt) {
        killProcessTree(currentPid);
        this.finalize(current.id, null, 'Eval task timed out');
        clearWatch();
      }
    };
    interval = setInterval(check, 1000);
    interval.unref?.();
    timeout = setTimeout(check, Math.max(0, timeoutAt - Date.now()));
    timeout.unref?.();
  }

  async stop(task: TaskRecord, reason?: string): Promise<TaskExecutorUpdate> {
    const pid = task.executorRef?.pid;
    if (typeof pid === 'number') killProcessTree(pid);
    if (!TERMINAL.has(task.status)) {
      try {
        this.service.stopTask(task.id, reason ? { error: reason } : undefined);
      } catch {
        // already terminal
      }
    }
    const after = this.repo.findById(task.id);
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

  async readOutput(task: TaskRecord, args: Record<string, unknown>) {
    let current = task;
    const pid = task.executorRef?.pid;
    if (task.status === 'running' && typeof pid === 'number' && !pidAlive(pid)) {
      try {
        current = this.settleObservedExit(task, 'eval process not found after server restart');
      } catch {
        current = this.repo.findById(task.id) ?? task;
      }
    }
    const metadata = (current.metadata ?? {}) as Record<string, unknown>;
    const logPath =
      typeof metadata.logPath === 'string' ? metadata.logPath : evalTaskLogPath(current.id);
    const window = readTaskLogWindow(logPath, args);
    if (!window.ok) return errorResult(window.code, window.message, window.details);
    const code = typeof metadata.code === 'string' ? metadata.code : '<unknown>';
    const workspaceRoot =
      typeof metadata.workspaceRoot === 'string' ? metadata.workspaceRoot : undefined;
    const cwd = workspaceRoot ? toWorkspaceRelative(workspaceRoot, workspaceRoot) || '.' : '.';
    const terminal = TERMINAL.has(current.status);
    const status = current.status === 'completed' ? 'success' : current.status;
    const text = [
      `Eval: ${truncateText(code.replace(/\s+/g, ' ').trim(), 160)}`,
      `Cwd: ${cwd}`,
      `Status: ${status}`,
      `Sandbox: ${metadata.sandboxed === true ? 'enabled' : 'disabled'}`,
      ...(terminal && current.result?.text ? [`Result: ${current.result.text}`] : []),
      ...(terminal && current.result?.error ? [`Error: ${current.result.error}`] : []),
      ...(window.truncated ? [`Output truncated (showing tail). Full output: ${logPath}`] : []),
      '',
      'Output:',
      window.output || '(no output)',
    ].join('\n');
    return textResult(text, {
      ok: true,
      taskId: current.id,
      status: current.status,
      nextOffset: window.nextOffset,
      eof: window.eof,
      logPath,
      logSize: window.size,
      rawOutput: window.output,
      ...(current.result ? { result: current.result } : {}),
    });
  }

  reconcile(): void {
    for (const task of this.repo.listByTypeAndStatuses('eval', ['queued', 'running'])) {
      try {
        const pid = task.executorRef?.pid;
        if (task.status === 'queued') {
          this.service.stopTask(task.id, {
            error: 'eval task was still queued after server restart',
          });
        } else if (typeof pid !== 'number' || !pidAlive(pid)) {
          this.settleObservedExit(task, 'eval process not found after server restart');
        } else {
          this.watchReconciledTask(task);
        }
      } catch {
        // best-effort
      }
    }
  }
}

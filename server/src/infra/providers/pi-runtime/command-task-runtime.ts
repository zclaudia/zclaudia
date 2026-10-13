import type { TaskRecord } from '@zclaudia/shared/core/task';

import type { TaskPort } from '../../../utils/task-port.js';
import {
  extractBashOutputInsights,
  formatBashResultText,
  type FormatBashResultInput,
} from './bash-output.js';
import { errorResult, textResult } from './tool-common.js';
import { readTaskLogWindow } from './task-output-window.js';
import type { TaskRuntime } from './task-runtime.js';
import { toWorkspaceRelative } from './workspace-paths.js';

/**
 * Resolve a command task's exit code. Prefer the structured metadata.exitCode
 * written by CommandTaskExecutor.finalize; the text parsing below is only a
 * legacy fallback for tasks finalized before that field existed.
 */
export function commandExitCode(task: TaskRecord): number | null {
  const stored = (task.metadata as Record<string, unknown> | undefined)?.exitCode;
  if (typeof stored === 'number' && Number.isInteger(stored)) return stored;
  const result = task.result;
  if (task.status === 'completed' && !result?.text?.includes('unknown')) return 0;
  const exitCodeMatch = result?.error?.match(/exit code (\d+)/);
  return exitCodeMatch ? Number(exitCodeMatch[1]) : null;
}

function commandTaskCwd(taskMetadata: unknown): string {
  if (!taskMetadata || typeof taskMetadata !== 'object') return '.';
  const metadata = taskMetadata as Record<string, unknown>;
  const cwd = typeof metadata.cwd === 'string' && metadata.cwd ? metadata.cwd : undefined;
  const workspaceRoot =
    typeof metadata.workspaceRoot === 'string' && metadata.workspaceRoot
      ? metadata.workspaceRoot
      : undefined;
  if (!cwd) return '.';
  return workspaceRoot ? toWorkspaceRelative(workspaceRoot, cwd) || '.' : cwd;
}

function commandTaskStatus(status: string): FormatBashResultInput['status'] {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  if (status === 'queued') return 'queued';
  if (status === 'stopped') return 'stopped';
  return 'failed';
}

function commandTaskDurationMs(createdAt: number, updatedAt: number, status: string): number {
  const terminal = status === 'completed' || status === 'failed' || status === 'stopped';
  return Math.max(0, (terminal ? updatedAt : Date.now()) - createdAt);
}

export class CommandTaskRuntime implements TaskRuntime {
  readonly type = 'command';

  constructor(private readonly tasks: TaskPort) {}

  async stop(task: TaskRecord, reason?: string) {
    return this.tasks.commandTasks.stop(task.id, reason);
  }

  async readOutput(task: TaskRecord, args: Record<string, unknown>) {
    let current = task;
    const pid = task.executorRef?.pid;
    if (
      task.status === 'running' &&
      typeof pid === 'number' &&
      !this.tasks.commandTasks.pidAlive(pid)
    ) {
      try {
        current = this.tasks.completeTask(task.id, {
          text: 'Process exited (exit code unknown; observed after restart)',
        });
      } catch {
        current = this.tasks.findById(task.id) ?? task;
      }
    }
    const logPath = this.tasks.commandTasks.logPath(task.id);
    const window = readTaskLogWindow(logPath, args);
    if (!window.ok) {
      return errorResult(window.code, window.message, window.details);
    }
    const metadata = (current.metadata ?? {}) as Record<string, unknown>;
    const command =
      typeof metadata.command === 'string' && metadata.command
        ? metadata.command
        : typeof current.executorRef?.command === 'string'
          ? current.executorRef.command
          : '<unknown>';
    const exitCode = commandExitCode(current);
    const insights = extractBashOutputInsights(window.output);
    const text = formatBashResultText(
      {
        command,
        cwd: commandTaskCwd(current.metadata),
        output: window.output,
        fullOutput: window.output,
        exitCode,
        durationMs: commandTaskDurationMs(current.createdAt, current.updatedAt, current.status),
        truncated: window.truncated,
        timedOut: false,
        sandboxed: metadata.sandboxed === true,
        status: commandTaskStatus(current.status),
        ...(window.truncated ? { fullOutputPath: logPath } : {}),
      },
      insights
    );
    return textResult(text, {
      ok: true,
      taskId: current.id,
      status: current.status,
      ...(exitCode !== null ? { exitCode } : {}),
      nextOffset: window.nextOffset,
      eof: window.eof,
      logPath,
      logSize: window.size,
      rawOutput: window.output,
      ...(insights.diagnostics.length ? { diagnostics: insights.diagnostics } : {}),
      ...(insights.failedTests.length ? { failedTests: insights.failedTests } : {}),
    });
  }

  reconcile(): void {
    this.tasks.commandTasks.reconcile();
  }
}

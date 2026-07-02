import type { TaskRecord, TaskResult } from '@zclaudia/shared/core/task';

import { type TaskRepository } from '../../../domains/tasks/repository.js';
import { TaskService } from '../../../domains/tasks/task-service.js';
import {
  CommandTaskExecutor,
  commandTaskLogPath,
  pidAlive,
} from '../../../domains/tasks/executors/command-executor.js';
import {
  extractBashOutputInsights,
  formatBashResultText,
  type FormatBashResultInput,
} from './bash-output.js';
import { errorResult, textResult } from './tool-common.js';
import { readTaskLogWindow } from './task-output-window.js';
import type { TaskRuntime } from './task-runtime.js';
import { toWorkspaceRelative } from './workspace-paths.js';

function commandExitCode(result: TaskResult | undefined, status: string): number | null {
  if (status === 'completed' && !result?.text?.includes('unknown')) return 0;
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

  constructor(private readonly repo: TaskRepository) {}

  async stop(task: TaskRecord, reason?: string) {
    return new CommandTaskExecutor(this.repo).stop(task.id, reason);
  }

  async readOutput(task: TaskRecord, args: Record<string, unknown>) {
    let current = task;
    const pid = task.executorRef?.pid;
    if (task.status === 'running' && typeof pid === 'number' && !pidAlive(pid)) {
      try {
        current = new TaskService(this.repo).completeTask(task.id, {
          text: 'Process exited (exit code unknown; observed after restart)',
        });
      } catch {
        current = this.repo.findById(task.id) ?? task;
      }
    }
    const logPath = commandTaskLogPath(task.id);
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
    const exitCode = commandExitCode(current.result, current.status);
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
    new CommandTaskExecutor(this.repo).reconcile();
  }
}

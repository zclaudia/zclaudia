import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared/interaction/permissions';
import { closeSync, openSync, readSync, statSync } from 'fs';

import { TaskRepository } from '../../../domains/tasks/repository.js';
import { TaskService } from '../../../domains/tasks/task-service.js';
import type { TaskExecutor } from '../../../domains/tasks/executors/types.js';
import { CommandTaskExecutor, commandTaskLogPath, pidAlive } from '../../../domains/tasks/executors/command-executor.js';
import { errorResult, jsonResult, textResult, toolParams, truncateText } from './tool-common.js';

function readLogWindow(filePath: string, offset: number, length: number): string {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const bytes = readSync(fd, buf, 0, length, offset);
    return buf.subarray(0, bytes).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function taskTitleFromArgs(args: Record<string, unknown>): string | undefined {
  if (typeof args.description === 'string' && args.description.trim()) return args.description.trim();
  if (typeof args.prompt === 'string' && args.prompt.trim()) return truncateText(args.prompt.trim(), 120);
  return undefined;
}

export function createAgentTool(
  cwd: string,
  sessionId?: string,
  runId?: string,
  db?: Database.Database,
  permissionOverride?: Partial<UnifiedPermissionPolicy>,
  agentTaskExecutor?: TaskExecutor,
): AgentTool<any> {
  return {
    name: 'Agent',
    label: 'Agent',
    description: 'Delegate work to a background sub-agent task. Set isolation:"worktree" to run it in an ephemeral git worktree so parallel agents never conflict on files; a clean worktree is removed automatically, one with changes is kept and reported.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        description: { type: 'string' },
        wait: { type: 'boolean' },
        isolation: { type: 'string', enum: ['worktree'], description: 'Run the sub-agent in an isolated git worktree' },
      },
      required: ['prompt'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!agentTaskExecutor) return jsonResult({ error: 'Agent tool requires a task executor' });
      if (!db) return jsonResult({ error: 'Agent tool requires database context' });
      if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
        return errorResult('missing_prompt', 'Agent requires a prompt');
      }

      const taskService = new TaskService(new TaskRepository(db));
      const task = taskService.createTask({
        type: 'agent',
        title: taskTitleFromArgs(args),
        parentSessionId: sessionId,
        parentRunId: runId,
        parentToolUseId: typeof toolCallId === 'string' ? toolCallId : undefined,
        metadata: {
          prompt: args.prompt,
          wait: Boolean(args.wait),
          permissionOverride: args.permission_override ?? args.permissionOverride ?? permissionOverride,
          cwd,
          ...(args.isolation === 'worktree' ? { isolation: 'worktree' } : {}),
        },
      });

      try {
        const started = await agentTaskExecutor.start(task);
        const running = taskService.startTask(task.id, { executorRef: started.executorRef });
        if (args.wait !== true) {
          return jsonResult({
            ok: true,
            taskId: task.id,
            status: running.status,
          });
        }
        const result = await agentTaskExecutor.wait(task.id);
        const updated = result.status === 'completed'
          ? taskService.completeTask(task.id, result.result ?? {})
          : result.status === 'stopped'
            ? taskService.stopTask(task.id, result.result)
            : taskService.failTask(task.id, result.result ?? { error: 'Agent task failed' });
        return jsonResult({
          ok: true,
          taskId: task.id,
          status: updated.status,
          result: result.result,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        taskService.failTask(task.id, { error: message });
        return errorResult('agent_delegate_failed', message, { taskId: task.id });
      }
    },
  } as unknown as AgentTool<any>;
}

export function createTaskOutputTool(db?: Database.Database): AgentTool<any> {
  return {
    name: 'TaskOutput',
    label: 'TaskOutput',
    description: 'Read task state, result, and lifecycle events by task id.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        taskId: { type: 'string' },
        include_events: { type: 'boolean', default: true },
        output_offset: { type: 'number', description: 'For command tasks: byte offset to read the log from (use the previous nextOffset)' },
        tail_lines: { type: 'number', description: 'For command tasks: return only the last N lines (takes precedence over output_offset)' },
      },
      required: ['task_id'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db) return errorResult('missing_db_context', 'TaskOutput requires database context');
      const taskId = args.task_id ?? args.taskId;
      if (typeof taskId !== 'string' || !taskId.trim()) {
        return errorResult('missing_task_id', 'TaskOutput requires task_id');
      }

      const repo = new TaskRepository(db);
      const task = repo.findById(taskId.trim());
      if (!task) return errorResult('task_not_found', `Task not found: ${taskId}`, { taskId });

      if (task.type === 'command') {
        let current = task;
        const pid = task.executorRef?.pid;
        if (task.status === 'running' && typeof pid === 'number' && !pidAlive(pid)) {
          try {
            current = new TaskService(repo).completeTask(task.id, { text: 'Process exited (exit code unknown; observed after restart)' });
          } catch {
            current = repo.findById(task.id) ?? task;
          }
        }
        const logPath = commandTaskLogPath(task.id);
        const CAP = 50 * 1024;
        const requestedOffset = Math.max(0, Number(args.output_offset ?? 0) || 0);
        let output = '';
        let size = 0;
        try {
          size = statSync(logPath).size;
          const tailLines = args.tail_lines !== undefined ? Math.max(1, Number(args.tail_lines) || 1) : undefined;
          if (tailLines !== undefined) {
            const start = Math.max(0, size - CAP);
            output = readLogWindow(logPath, start, size - start);
            const hadTrailingNewline = output.endsWith('\n');
            const lines = output.split('\n');
            if (lines.length && lines[lines.length - 1] === '') lines.pop();
            output = lines.slice(-tailLines).join('\n') + (hadTrailingNewline ? '\n' : '');
          } else {
            const offset = Math.min(requestedOffset, size);
            const len = Math.min(size - offset, CAP);
            output = len > 0 ? readLogWindow(logPath, offset, len) : '';
          }
        } catch { /* no log yet - empty output */ }
        const eof = args.tail_lines !== undefined || size <= requestedOffset + Buffer.byteLength(output, 'utf8');
        const exitCodeMatch = current.result?.error?.match(/exit code (\d+)/);
        return textResult(output, {
          ok: true,
          taskId: current.id,
          status: current.status,
          ...(current.status === 'completed' && !current.result?.text?.includes('unknown') ? { exitCode: 0 } : {}),
          ...(exitCodeMatch ? { exitCode: Number(exitCodeMatch[1]) } : {}),
          nextOffset: size,
          eof,
        });
      }

      const includeEvents = args.include_events !== false;
      const events = includeEvents ? repo.listEvents(task.id) : [];
      return textResult(JSON.stringify({ task, events }, null, 2), {
        ok: true,
        taskId: task.id,
        status: task.status,
        eventCount: events.length,
      });
    },
  } as unknown as AgentTool<any>;
}

export function createMonitorTool(sessionId?: string, runId?: string, db?: Database.Database): AgentTool<any> {
  return {
    name: 'Monitor',
    label: 'Monitor',
    description: 'Create, inspect, or stop a monitor task using the shared Task lifecycle.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'status', 'stop'], default: 'start' },
        task_id: { type: 'string' },
        taskId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        target_task_id: { type: 'string' },
        interval_ms: { type: 'number' },
        reason: { type: 'string' },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db) return errorResult('missing_db_context', 'Monitor requires database context');
      const repo = new TaskRepository(db);
      const service = new TaskService(repo);
      const action = typeof args.action === 'string' ? args.action : 'start';
      const taskId = args.task_id ?? args.taskId;

      if (action === 'start') {
        const task = service.createTask({
          type: 'monitor',
          title: typeof args.title === 'string' ? args.title : undefined,
          description: typeof args.description === 'string' ? args.description : undefined,
          parentSessionId: sessionId,
          parentRunId: runId,
          parentToolUseId: typeof toolCallId === 'string' ? toolCallId : undefined,
          metadata: {
            targetTaskId: typeof args.target_task_id === 'string' ? args.target_task_id : undefined,
            intervalMs: typeof args.interval_ms === 'number' ? args.interval_ms : undefined,
          },
        });
        const running = service.startTask(task.id, {
          executorRef: { providerType: 'task-monitor', taskId: task.id },
        });
        return jsonResult({ ok: true, taskId: running.id, status: running.status });
      }

      if (typeof taskId !== 'string' || !taskId.trim()) {
        return errorResult('missing_task_id', `Monitor action "${action}" requires task_id`);
      }
      const task = repo.findById(taskId.trim());
      if (!task) return errorResult('task_not_found', `Monitor task not found: ${taskId}`, { taskId });

      if (action === 'status') {
        return jsonResult({ ok: true, task, events: repo.listEvents(task.id) });
      }
      if (action === 'stop') {
        try {
          if (task.type === 'command') {
            const executor = new CommandTaskExecutor(repo);
            const update = await executor.stop(task.id, typeof args.reason === 'string' ? args.reason : undefined);
            return jsonResult({ ok: true, taskId: task.id, status: update.status });
          }
          const stopped = service.stopTask(task.id, {
            error: typeof args.reason === 'string' ? args.reason : undefined,
          });
          return jsonResult({ ok: true, taskId: stopped.id, status: stopped.status });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult('monitor_stop_failed', message, { taskId: task.id });
        }
      }

      return errorResult('unknown_monitor_action', `Unknown Monitor action: ${action}`);
    },
  } as unknown as AgentTool<any>;
}

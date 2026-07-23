import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared/interaction/permissions';

import { TaskRepository } from '../../../domains/tasks/repository.js';
import { TaskService } from '../../../domains/tasks/task-service.js';
import type { TaskExecutor } from '../../../domains/tasks/executors/types.js';
import {
  agentToolParameters,
  errorResult,
  jsonResult,
  textResult,
  toolParams,
  truncateText,
} from './tool-common.js';
import { CommandTaskRuntime } from './command-task-runtime.js';
import { EvalTaskRuntime } from './eval-task-runtime.js';
import {
  createTaskRuntimeRegistry,
  type TaskRuntimeRegistry,
  type TaskToolResult,
} from './task-runtime.js';
export { parseTaskOutputWindowParams } from './task-output-window.js';

function taskTitleFromArgs(args: Record<string, unknown>): string | undefined {
  if (typeof args.description === 'string' && args.description.trim())
    return args.description.trim();
  if (typeof args.prompt === 'string' && args.prompt.trim())
    return truncateText(args.prompt.trim(), 120);
  return undefined;
}

function resolveProjectIdForSession(
  db: Database.Database | undefined,
  sessionId: string | undefined
): string | undefined {
  if (!db || !sessionId) return undefined;
  try {
    const row = db
      .prepare('SELECT project_id AS projectId FROM sessions WHERE id = ?')
      .get(sessionId) as { projectId?: string } | undefined;
    return typeof row?.projectId === 'string' && row.projectId.trim()
      ? row.projectId.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export type TaskRuntimeRegistryFactory = (repo: TaskRepository) => TaskRuntimeRegistry;

export function createDefaultTaskRuntimeRegistry(repo: TaskRepository): TaskRuntimeRegistry {
  return createTaskRuntimeRegistry([new CommandTaskRuntime(repo), new EvalTaskRuntime(repo)]);
}

export function createAgentTool(
  cwd: string,
  sessionId?: string,
  runId?: string,
  db?: Database.Database,
  permissionOverride?: Partial<UnifiedPermissionPolicy>,
  agentTaskExecutor?: TaskExecutor
): AgentTool {
  return {
    name: 'Agent',
    label: 'Agent',
    description:
      'Delegate work to a background sub-agent task. Set isolation:"worktree" to run it in an ephemeral git worktree so parallel agents never conflict on files; a clean worktree is removed automatically, one with changes is kept and reported.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Full task instructions for the sub-agent. It runs without your conversation context, so include everything it needs.',
        },
        description: {
          type: 'string',
          description: 'Short human-readable task title shown in the task list',
        },
        wait: {
          type: 'boolean',
          description:
            'Block this tool call until the sub-agent finishes and return its result. Can block for a long time (up to the 30-minute sub-agent safety timeout). Default false: start in the background and poll with TaskOutput({ task_id, wait_ms }) instead — preferred, since it does not stall your run.',
        },
        isolation: {
          type: 'string',
          enum: ['worktree'],
          description: 'Run the sub-agent in an isolated git worktree',
        },
      },
      required: ['prompt'],
      // Model-supplied keys outside this list are rejected by schema-aware
      // providers; execute() additionally never reads them (see below).
      additionalProperties: false,
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!agentTaskExecutor)
        return errorResult('missing_task_executor', 'Agent tool requires a task executor');
      if (!db) return errorResult('missing_db_context', 'Agent tool requires database context');
      if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
        return errorResult('missing_prompt', 'Agent requires a prompt');
      }

      const projectId = resolveProjectIdForSession(db, sessionId);
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
          // Security (P0-2): never read permission_override/permissionOverride
          // from model-supplied args — a prompt-injected model could otherwise
          // mint a fully autonomous sub-agent (e.g. bash:'allow'). Only the
          // parent-provided factory override may flow into the sub-agent policy.
          permissionOverride,
          cwd,
          projectId,
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
        const updated =
          result.status === 'completed'
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
  };
}

export function createTaskOutputTool(
  db?: Database.Database,
  runtimeRegistryFactory: TaskRuntimeRegistryFactory = createDefaultTaskRuntimeRegistry
): AgentTool {
  return {
    name: 'TaskOutput',
    label: 'TaskOutput',
    description:
      'Read task state, result, and lifecycle events by task id. Pass wait_ms to block until new output arrives or the task finishes instead of polling with sleep.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        taskId: { type: 'string' },
        include_events: { type: 'boolean', default: true },
        output_offset: {
          type: 'number',
          description:
            'For command tasks: byte offset to read the log from (use the previous nextOffset)',
        },
        tail_lines: {
          type: 'number',
          description:
            'For command tasks: return only the last N lines (takes precedence over output_offset)',
        },
        wait_ms: {
          type: 'number',
          description:
            'Block up to this many ms (max 60000) until new output appears past output_offset or the task reaches a terminal state. Prefer this over sleep-and-poll loops.',
        },
      },
      required: ['task_id'],
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db) return errorResult('missing_db_context', 'TaskOutput requires database context');
      const taskId = args.task_id ?? args.taskId;
      if (typeof taskId !== 'string' || !taskId.trim()) {
        return errorResult('missing_task_id', 'TaskOutput requires task_id');
      }

      const repo = new TaskRepository(db);
      const registry = runtimeRegistryFactory(repo);
      const isTerminal = (status: string): boolean => status !== 'running' && status !== 'pending';

      const readOnce = async (): Promise<TaskToolResult | undefined> => {
        const task = repo.findById(taskId.trim());
        if (!task) return undefined;
        const runtime = registry.get(task.type);
        if (runtime?.readOutput) return runtime.readOutput(task, args);
        const includeEvents = args.include_events !== false;
        const events = includeEvents ? repo.listEvents(task.id) : [];
        return textResult(JSON.stringify({ task, events }, null, 2), {
          ok: true,
          taskId: task.id,
          status: task.status,
          eventCount: events.length,
        });
      };

      let result = await readOnce();
      if (!result) return errorResult('task_not_found', `Task not found: ${taskId}`, { taskId });

      const waitMsArg = typeof args.wait_ms === 'number' ? args.wait_ms : 0;
      const waitMs = Math.min(Math.max(waitMsArg, 0), 60_000);
      if (waitMs > 0) {
        const deadline = Date.now() + waitMs;
        const hasNewOutput = (details: Record<string, unknown>): boolean =>
          typeof details.rawOutput === 'string' && details.rawOutput.length > 0;
        const status = (details: Record<string, unknown>): string =>
          typeof details.status === 'string' ? details.status : 'running';
        while (
          !hasNewOutput(result.details) &&
          !isTerminal(status(result.details)) &&
          Date.now() < deadline
        ) {
          await new Promise(resolve => setTimeout(resolve, Math.min(250, deadline - Date.now())));
          const next = await readOnce();
          if (!next) break;
          result = next;
        }
      }
      return result;
    },
  };
}

export function createMonitorTool(
  // Unused since P1-7 disabled monitor start (no monitor runtime exists);
  // positions kept so tool-catalog's call site stays stable.
  _sessionId?: string,
  _runId?: string,
  db?: Database.Database,
  runtimeRegistryFactory: TaskRuntimeRegistryFactory = createDefaultTaskRuntimeRegistry
): AgentTool {
  return {
    name: 'Monitor',
    label: 'Monitor',
    description:
      'Inspect or stop an existing monitor task using the shared Task lifecycle. Starting new monitor tasks is not supported (no monitor runtime exists); use TaskOutput with wait_ms to watch a task.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'status', 'stop'],
          description:
            '"start" is rejected (no monitor runtime exists — watch a task via TaskOutput with wait_ms instead); "status" reads a task; "stop" stops it',
        },
        task_id: { type: 'string', description: 'Task id (required for status/stop)' },
        taskId: { type: 'string', description: 'Alias for task_id' },
        title: { type: 'string', description: 'Unused (start is not supported)' },
        description: { type: 'string', description: 'Unused (start is not supported)' },
        target_task_id: { type: 'string', description: 'Unused (start is not supported)' },
        interval_ms: { type: 'number', description: 'Unused (start is not supported)' },
        reason: { type: 'string', description: 'Optional stop reason recorded on the task' },
      },
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db) return errorResult('missing_db_context', 'Monitor requires database context');
      const repo = new TaskRepository(db);
      const service = new TaskService(repo);
      const action = typeof args.action === 'string' ? args.action : 'start';
      const taskId = args.task_id ?? args.taskId;

      if (action === 'start') {
        // P1-7: Monitor start used to mint a 'monitor' task that was marked
        // running forever — no monitor runtime exists (only command and eval
        // runtimes are registered) and nothing ever drove the task, so every
        // started monitor became a permanent zombie. Fail explicitly instead;
        // TaskOutput with wait_ms is the supported way to watch a task.
        // status/stop stay available so pre-existing monitor rows can still
        // be inspected and settled.
        return errorResult(
          'monitor_start_unsupported',
          'Monitor start is not supported: no monitor runtime exists to drive monitor tasks, so a started monitor would stay "running" forever. To watch an existing task, poll TaskOutput with wait_ms (it blocks until new output arrives or the task finishes). To inspect or stop an existing monitor task, use action:"status" or action:"stop".'
        );
      }

      if (typeof taskId !== 'string' || !taskId.trim()) {
        return errorResult('missing_task_id', `Monitor action "${action}" requires task_id`);
      }
      const task = repo.findById(taskId.trim());
      if (!task)
        return errorResult('task_not_found', `Monitor task not found: ${taskId}`, { taskId });

      if (action === 'status') {
        return jsonResult({ ok: true, task, events: repo.listEvents(task.id) });
      }
      if (action === 'stop') {
        try {
          const runtime = runtimeRegistryFactory(repo).get(task.type);
          if (runtime?.stop) {
            const update = await runtime.stop(
              task,
              typeof args.reason === 'string' ? args.reason : undefined
            );
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
  };
}

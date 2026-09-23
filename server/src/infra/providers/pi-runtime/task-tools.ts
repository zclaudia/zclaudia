import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared/interaction/permissions';

import { TaskRepository } from '../../../domains/tasks/repository.js';
import { TaskService } from '../../../domains/tasks/task-service.js';
import type { TaskExecutor } from '../../../domains/tasks/executors/types.js';
import { AgentProfileRepository } from '../../../domains/agent-profiles/repository.js';
import type { SubagentMessenger } from '../types.js';
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

export interface SubagentType {
  id: string;
  name: string;
  description?: string;
}

/**
 * Roster for the Agent tool's `subagent_type`: every active agent profile.
 * Profiles are global (no project column), so the roster is the same for
 * every session. Missing db or table → empty roster (tool still works with
 * the default profile).
 */
export function listSubagentTypes(db: Database.Database | undefined): SubagentType[] {
  if (!db) return [];
  try {
    return new AgentProfileRepository(db)
      .findAllOrdered()
      .filter(profile => (profile.status ?? 'active') === 'active')
      .map(profile => ({
        id: profile.id,
        name: profile.name,
        description: profile.description?.trim() || undefined,
      }));
  } catch {
    return [];
  }
}

export function resolveSubagentType(
  roster: SubagentType[],
  requested: string
): SubagentType | undefined {
  const needle = requested.trim();
  if (!needle) return undefined;
  const lower = needle.toLowerCase();
  return (
    roster.find(entry => entry.id === needle) ??
    roster.find(entry => entry.name.toLowerCase() === lower)
  );
}

function describeSubagentTypes(roster: SubagentType[]): string {
  if (roster.length === 0) return '';
  const lines = roster.map(entry =>
    entry.description ? `- ${entry.name}: ${entry.description}` : `- ${entry.name}`
  );
  return `\n\nAvailable subagent_type values (agent profiles):\n${lines.join('\n')}`;
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
  const roster = listSubagentTypes(db);
  return {
    name: 'Agent',
    label: 'Agent',
    description:
      'Delegate work to a background sub-agent task. Set isolation:"worktree" to run it in an ephemeral git worktree so parallel agents never conflict on files; a clean worktree is removed automatically, one with changes is kept and reported. Pick a subagent_type to run it under a specific agent profile (system prompt, model, tool set); omit it for the default profile. Send follow-up instructions to a running or finished sub-agent with SendMessage({ task_id, message }).' +
      describeSubagentTypes(roster),
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
        subagent_type: {
          type: 'string',
          description:
            'Agent profile to run the sub-agent under (profile name or id). Omit for the default profile.',
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

      let agentProfileId: string | undefined;
      if (args.subagent_type !== undefined) {
        if (typeof args.subagent_type !== 'string' || !args.subagent_type.trim()) {
          return errorResult('invalid_subagent_type', 'subagent_type must be a non-empty string');
        }
        // Re-read the roster at call time: profiles may have been added since
        // the tool was built, and the description is only a hint.
        const resolved = resolveSubagentType(listSubagentTypes(db), args.subagent_type);
        if (!resolved) {
          const available = listSubagentTypes(db)
            .map(entry => entry.name)
            .join(', ');
          return errorResult(
            'unknown_subagent_type',
            `Unknown subagent_type "${args.subagent_type}". Available: ${available || '(none)'}`
          );
        }
        agentProfileId = resolved.id;
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
          ...(agentProfileId ? { agentProfileId } : {}),
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
        // Persist the sub-agent's session id: SendMessage resolves task_id →
        // session through it, and the UI links the task to its transcript.
        const running = taskService.startTask(task.id, {
          executorRef: started.executorRef,
          sessionId: started.sessionId,
        });
        if (args.wait !== true) {
          return jsonResult({
            ok: true,
            taskId: task.id,
            status: running.status,
            ...(started.sessionId ? { sessionId: started.sessionId } : {}),
            ...(agentProfileId ? { agentProfileId } : {}),
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

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'stopped']);

export interface SendMessageToolDeps {
  cwd: string;
  sessionId?: string;
  runId?: string;
  db?: Database.Database;
  permissionOverride?: Partial<UnifiedPermissionPolicy>;
  agentTaskExecutor?: TaskExecutor;
  messenger?: SubagentMessenger;
}

/**
 * SendMessage: follow-up instructions for a sub-agent this session launched.
 *
 * - running sub-agent → steered into its live run (persisted + broadcast in
 *   the sub-agent's session, like a UI steer);
 * - finished sub-agent → a new agent task is started on the SAME session, so
 *   it resumes with its full history (`resumed_background`).
 *
 * Only the launching session may message a task (parentSessionId check):
 * a prompt-injected sub-agent must not be able to redirect its siblings.
 */
export function createSendMessageTool(deps: SendMessageToolDeps): AgentTool {
  const { cwd, sessionId, runId, db, permissionOverride, agentTaskExecutor, messenger } = deps;
  return {
    name: 'SendMessage',
    label: 'SendMessage',
    description:
      'Send a follow-up message to a sub-agent you launched with Agent. A running sub-agent receives it at its next turn boundary (delivery "steered"); a finished one is resumed in the background on the same session with its full history (delivery "resumed_background"). Poll TaskOutput for the response.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task id returned by Agent' },
        message: { type: 'string', description: 'Instructions or answer for the sub-agent' },
        summary: {
          type: 'string',
          description: 'Optional 5-10 word summary shown in the task list',
        },
      },
      required: ['task_id', 'message'],
      additionalProperties: false,
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db) return errorResult('missing_db_context', 'SendMessage requires database context');
      if (!messenger) {
        return errorResult('missing_messenger', 'SendMessage requires the session messenger');
      }
      const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
      if (!taskId) return errorResult('missing_task_id', 'SendMessage requires task_id');
      const message = typeof args.message === 'string' ? args.message.trim() : '';
      if (!message) return errorResult('missing_message', 'SendMessage requires a message');

      const repo = new TaskRepository(db);
      const task = repo.findById(taskId);
      if (!task) return errorResult('task_not_found', `Task not found: ${taskId}`);
      if (task.type !== 'agent') {
        return errorResult('not_an_agent_task', `Task ${taskId} is a ${task.type} task`);
      }
      if (!sessionId || task.parentSessionId !== sessionId) {
        return errorResult(
          'task_not_owned',
          `Task ${taskId} was not launched by this session; only its coordinator may message it`
        );
      }
      if (!task.sessionId) {
        return errorResult(
          'task_session_unknown',
          `Task ${taskId} has no session yet (it may not have started); retry after it starts`
        );
      }

      const text = `[Message from coordinator]\n${message}`;
      if (task.status === 'running') {
        const outcome = messenger.steer(task.sessionId, text);
        if (outcome.delivery === 'steered') {
          return jsonResult({ ok: true, taskId, delivery: 'steered', sessionId: task.sessionId });
        }
        if (outcome.delivery === 'not_ready') {
          return errorResult(
            'subagent_not_ready',
            `Sub-agent ${taskId} has not started its first turn yet; retry shortly`,
            { taskId, retryable: true }
          );
        }
        // running per the task row, but no live run: fall through and resume.
      } else if (!TERMINAL_TASK_STATUSES.has(task.status)) {
        return errorResult(
          'task_not_running',
          `Task ${taskId} is ${task.status}; it can only be messaged while running or after it finished`,
          { taskId, status: task.status }
        );
      }

      if (!agentTaskExecutor) {
        return errorResult(
          'missing_task_executor',
          `Sub-agent ${taskId} is not running and no task executor is available to resume it`
        );
      }
      const previous = task.metadata ?? {};
      const taskService = new TaskService(repo);
      const resumed = taskService.createTask({
        type: 'agent',
        title:
          typeof args.summary === 'string' && args.summary.trim()
            ? args.summary.trim()
            : (task.title ?? truncateText(message, 120)),
        parentSessionId: sessionId,
        parentRunId: runId,
        parentToolUseId: typeof toolCallId === 'string' ? toolCallId : undefined,
        metadata: {
          prompt: text,
          wait: false,
          // Same rule as Agent (P0-2): only the factory-provided override.
          permissionOverride,
          cwd: typeof previous.cwd === 'string' ? previous.cwd : cwd,
          projectId:
            typeof previous.projectId === 'string'
              ? previous.projectId
              : resolveProjectIdForSession(db, sessionId),
          sessionId: task.sessionId,
          resumedFromTaskId: taskId,
          ...(typeof previous.agentProfileId === 'string'
            ? { agentProfileId: previous.agentProfileId }
            : {}),
        },
      });
      try {
        const started = await agentTaskExecutor.start(resumed);
        taskService.startTask(resumed.id, {
          executorRef: started.executorRef,
          sessionId: started.sessionId ?? task.sessionId,
        });
        return jsonResult({
          ok: true,
          taskId: resumed.id,
          resumedFromTaskId: taskId,
          delivery: 'resumed_background',
          sessionId: task.sessionId,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        taskService.failTask(resumed.id, { error: errorMessage });
        return errorResult('subagent_resume_failed', errorMessage, { taskId: resumed.id });
      }
    },
  };
}

export interface RespondToCoordinatorToolDeps {
  sessionId?: string;
  db?: Database.Database;
  messenger?: SubagentMessenger;
}

export function buildCoordinatorNotice(input: {
  taskId: string;
  title?: string;
  summary: string;
  response: string;
}): string {
  const title = input.title ? ` ("${input.title}")` : '';
  return [
    `<system-reminder>Sub-agent task ${input.taskId}${title} reports: ${input.summary}`,
    input.response,
    `Reply with SendMessage({ task_id: "${input.taskId}", message }) if it needs more direction; it keeps working meanwhile.</system-reminder>`,
  ].join('\n');
}

/**
 * RespondToCoordinator: a sub-agent's mid-task reply to the session that
 * launched it. Delivered as a system notice into the coordinator's live run,
 * or queued for its next run. Does not end the sub-agent's turn.
 */
export function createRespondToCoordinatorTool(deps: RespondToCoordinatorToolDeps): AgentTool {
  const { sessionId, db, messenger } = deps;
  return {
    name: 'RespondToCoordinator',
    label: 'RespondToCoordinator',
    description:
      'Reply to the coordinator that launched you (for example to answer a message it sent, or to report a blocking finding) without ending your task. Keep working after calling it; do not use it for your final result.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        summary: { type: 'string', maxLength: 200, description: 'One-line summary of the reply' },
        response: { type: 'string', description: 'The full reply for the coordinator' },
      },
      required: ['summary', 'response'],
      additionalProperties: false,
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!db) {
        return errorResult('missing_db_context', 'RespondToCoordinator requires database context');
      }
      if (!messenger) {
        return errorResult(
          'missing_messenger',
          'RespondToCoordinator requires the session messenger'
        );
      }
      if (!sessionId) {
        return errorResult('missing_session_context', 'RespondToCoordinator requires a session');
      }
      const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
      const response = typeof args.response === 'string' ? args.response.trim() : '';
      if (!summary || !response) {
        return errorResult('missing_fields', 'RespondToCoordinator requires summary and response');
      }
      const task = new TaskRepository(db).findLatestAgentTaskForSession(sessionId);
      if (!task?.parentSessionId) {
        return errorResult(
          'no_coordinator',
          'This session was not launched by a coordinator; there is nobody to respond to'
        );
      }
      const notice = buildCoordinatorNotice({
        taskId: task.id,
        title: task.title,
        summary: truncateText(summary, 200),
        response,
      });
      const outcome = messenger.notify(task.parentSessionId, notice);
      return jsonResult({
        ok: true,
        taskId: task.id,
        coordinatorSessionId: task.parentSessionId,
        delivery: outcome.delivery,
      });
    },
  };
}

/**
 * Bridges background command-task lifecycle into the conversation layer.
 *
 * On start/settle of a command task owned by a session:
 *  - broadcasts task_notification to all authenticated clients (background
 *    task monitor UI),
 *  - keeps the owning run's pendingBackgroundTasks counter in sync (phase
 *    shows awaiting_followup while work is pending),
 *  - on settle, steers a completion notice into the live agent when the run
 *    is still active, otherwise queues it for the session's next run.
 */
import { readFileSync, statSync } from 'fs';
import type { TaskRecord } from '@zclaudia/shared/core/task';
import type { TaskNotificationMessage } from '@zclaudia/shared/wire/messages';
import { onTaskLifecycle, type TaskLifecycleEvent } from '../../../domains/tasks/task-events-bus.js';
import { commandTaskLogPath } from '../../../domains/tasks/executors/command-executor.js';
import type { ActiveRun, ConnectedClient } from '../transport/types.js';
import { sendMessage } from '../transport/broadcast.js';
import { computeBlockers, isTerminalPhase, recomputePhase } from './active-run-phase.js';
import { addPendingTaskNotice } from './pending-task-notices.js';

const LOG_TAIL_BYTES = 2 * 1024;

export interface TaskSettlementNotifierDeps {
  activeRuns: Map<string, ActiveRun>;
  connectedClients: Map<string, ConnectedClient>;
}

function findActiveRunForSession(activeRuns: Map<string, ActiveRun>, sessionId: string): ActiveRun | undefined {
  for (const run of activeRuns.values()) {
    if (run.sessionId === sessionId && !isTerminalPhase(run.phase)) return run;
  }
  return undefined;
}

function readLogTail(taskId: string): string {
  try {
    const logPath = commandTaskLogPath(taskId);
    const size = statSync(logPath).size;
    const text = readFileSync(logPath, 'utf8');
    return size > LOG_TAIL_BYTES ? `…${text.slice(-LOG_TAIL_BYTES)}` : text;
  } catch {
    return '';
  }
}

function settlementVerb(status: TaskRecord['status']): string {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'was stopped';
}

export function buildTaskSettlementNotice(task: TaskRecord): string {
  const title = task.title ? ` ("${task.title}")` : '';
  const verb = settlementVerb(task.status);
  const resultText = task.result?.text ?? task.result?.error ?? '';
  const tail = readLogTail(task.id).trimEnd();
  const lines = [
    `<system-reminder>Background task ${task.id}${title} ${verb}${resultText ? ` — ${resultText}` : ''}.`,
  ];
  if (tail) lines.push('Recent output:', tail);
  lines.push(`Use TaskOutput({ task_id: "${task.id}" }) for the full output. Mention the outcome to the user if relevant.</system-reminder>`);
  return lines.join('\n');
}

function broadcastTaskNotification(
  clients: Map<string, ConnectedClient>,
  task: TaskRecord,
  sessionId: string,
  status: string,
  message: string,
): void {
  const payload = {
    type: 'task_notification',
    runId: task.runId ?? task.parentRunId ?? '',
    sessionId,
    taskId: task.id,
    status,
    message,
  } as TaskNotificationMessage;
  for (const client of clients.values()) {
    if (!client.authenticated) continue;
    try {
      sendMessage(client.ws, payload);
    } catch {
      // best-effort fan-out; a broken socket must not affect task flow
    }
  }
}

function handleLifecycleEvent(deps: TaskSettlementNotifierDeps, event: TaskLifecycleEvent): void {
  const { task } = event;
  if (task.type !== 'command') return;
  const sessionId = task.sessionId ?? task.parentSessionId;
  if (!sessionId) return;

  const run = findActiveRunForSession(deps.activeRuns, sessionId);

  if (event.type === 'started') {
    broadcastTaskNotification(deps.connectedClients, task, sessionId, 'started',
      `Background task started${task.title ? `: ${task.title}` : ''}`);
    if (run) {
      run.pendingBackgroundTasks = (run.pendingBackgroundTasks || 0) + 1;
      recomputePhase(run, computeBlockers(run));
    }
    return;
  }

  broadcastTaskNotification(deps.connectedClients, task, sessionId, task.status,
    `Background task ${settlementVerb(task.status)}${task.title ? `: ${task.title}` : ''}`);
  if (run) {
    run.pendingBackgroundTasks = Math.max(0, (run.pendingBackgroundTasks || 0) - 1);
    recomputePhase(run, computeBlockers(run));
  }

  const notice = buildTaskSettlementNotice(task);
  if (run?.steerHandle) {
    try {
      run.steerHandle.steer({
        role: 'user',
        content: [{ type: 'text', text: notice }],
        timestamp: Date.now(),
      });
      return;
    } catch (err) {
      console.warn('[TaskSettlementNotifier] steer failed, queueing notice instead:', err);
    }
  }
  addPendingTaskNotice(sessionId, notice);
}

/** Subscribe to the task bus. Returns an unsubscribe function. */
export function registerTaskSettlementNotifier(deps: TaskSettlementNotifierDeps): () => void {
  return onTaskLifecycle((event) => handleLifecycleEvent(deps, event));
}

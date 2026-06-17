import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { ProviderRegistryPort } from '../../../infra/providers/registry.js';
import type { ProviderRuntimeEvent } from '../../../infra/providers/types.js';
import type { ActiveRun } from '../transport/types.js';
import { findProcessPidsByTaskCommand } from './run-lifecycle.js';
import { computeBlockers, recomputePhase } from './active-run-phase.js';

export interface BackgroundTaskState {
  backgroundTaskKeys?: Set<string>;
}

export interface TrackBackgroundTaskFromToolResultInput {
  activeRun: ActiveRun;
  state: BackgroundTaskState;
  toolName: string;
  toolUseId?: string;
  result: unknown;
  isError?: boolean;
}

export interface HandleTaskNotificationInput {
  activeRun: ActiveRun;
  msg: ProviderRuntimeEvent;
  providerRegistry: ProviderRegistryPort;
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
  state: BackgroundTaskState;
}

export function trackBackgroundTaskFromToolResult(input: TrackBackgroundTaskFromToolResultInput): void {
  if (input.isError) return;
  const backgroundTaskKey = getToolResultBackgroundTaskKey(
    input.toolName,
    input.toolUseId,
    input.result,
  );
  if (backgroundTaskKey) {
    markBackgroundTaskStarted(input.activeRun, input.state, backgroundTaskKey);
  }
}

export function handleTaskNotification(input: HandleTaskNotificationInput): void {
  const { activeRun, msg, providerRegistry, runId, sendRunEvent, state } = input;

  const taskKey = getTaskNotificationKey(msg);
  if (msg.taskStatus === 'started') {
    markBackgroundTaskStarted(activeRun, state, taskKey);
  } else if (
    msg.taskStatus === 'completed' ||
    msg.taskStatus === 'failed' ||
    msg.taskStatus === 'stopped'
  ) {
    markBackgroundTaskFinished(activeRun, state, taskKey);
  }

  const adapter = activeRun.providerType ? providerRegistry.get(activeRun.providerType) : undefined;
  const buildTaskNotificationEvent = () => {
    const cliPid = activeRun.providerSessionId
      ? adapter?.getCliPid?.(activeRun.providerSessionId)
      : undefined;
    const taskProcInfo = msg.taskId ? adapter?.getTaskProcessInfo?.(msg.taskId) : undefined;
    return {
      cliPid,
      taskProcInfo,
      event: {
        type: 'task_notification',
        runId,
        sessionId: activeRun.sessionId,
        taskId: msg.taskId,
        status: msg.taskStatus,
        message: msg.taskMessage,
        cliPid,
        taskCommand: taskProcInfo?.command,
        taskRootPid: taskProcInfo?.rootPid,
      } as import('@zclaudia/shared/wire/messages').TaskNotificationMessage,
    };
  };

  const { taskProcInfo, event } = buildTaskNotificationEvent();
  sendRunEvent(event);

  if (msg.taskId && msg.taskStatus === 'started' && !taskProcInfo?.rootPid) {
    const timer = setTimeout(async () => {
      try {
        const refreshed = buildTaskNotificationEvent();
        let resolvedRootPid = refreshed.taskProcInfo?.rootPid;

        if (!resolvedRootPid && refreshed.event.taskCommand) {
          const matchedPids = await findProcessPidsByTaskCommand(
            refreshed.event.taskCommand,
            [refreshed.event.cliPid, refreshed.event.taskRootPid].filter((pid): pid is number => typeof pid === 'number'),
          );
          resolvedRootPid = matchedPids[0];
        }

        if (resolvedRootPid && resolvedRootPid !== taskProcInfo?.rootPid) {
          sendRunEvent({
            ...refreshed.event,
            taskRootPid: resolvedRootPid,
          });
        }
      } catch (error) {
        console.warn(
          `[Task Notification] Failed to backfill PID for taskId=${msg.taskId}:`,
          error instanceof Error ? error.message : error
        );
      }
    }, 1800);
    timer.unref();
  }
}

function markBackgroundTaskStarted(activeRun: ActiveRun, state: BackgroundTaskState, key?: string): void {
  if (!key) {
    activeRun.pendingBackgroundTasks = (activeRun.pendingBackgroundTasks || 0) + 1;
    recomputePhase(activeRun, computeBlockers(activeRun));
    return;
  }
  state.backgroundTaskKeys ??= new Set();
  if (state.backgroundTaskKeys.has(key)) return;
  state.backgroundTaskKeys.add(key);
  activeRun.pendingBackgroundTasks = (activeRun.pendingBackgroundTasks || 0) + 1;
  recomputePhase(activeRun, computeBlockers(activeRun));
}

function markBackgroundTaskFinished(activeRun: ActiveRun, state: BackgroundTaskState, key?: string): void {
  if (key && state.backgroundTaskKeys?.has(key)) {
    state.backgroundTaskKeys.delete(key);
    activeRun.pendingBackgroundTasks = Math.max(0, (activeRun.pendingBackgroundTasks || 0) - 1);
    recomputePhase(activeRun, computeBlockers(activeRun));
    return;
  }
  activeRun.pendingBackgroundTasks = Math.max(0, (activeRun.pendingBackgroundTasks || 0) - 1);
  recomputePhase(activeRun, computeBlockers(activeRun));
}

function getTaskNotificationKey(msg: ProviderRuntimeEvent): string | undefined {
  if (msg.taskId) return `task:${msg.taskId}`;
  if (msg.taskToolUseId) return `tool:${msg.taskToolUseId}`;
  return undefined;
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getToolResultBackgroundTaskKey(
  toolName: string,
  toolUseId: string | undefined,
  result: unknown,
): string | undefined {
  const text = extractText(result);
  if (!text) return undefined;

  const bashMatch = text.match(/Command running in background with ID:\s*([A-Za-z0-9_-]+)/i);
  if (bashMatch?.[1]) return `task:${bashMatch[1]}`;

  const monitorMatch = text.match(/Monitor started\s*\(task\s+([A-Za-z0-9_-]+)/i);
  if (monitorMatch?.[1]) return `task:${monitorMatch[1]}`;

  if (/Command running in background/i.test(text) || /Monitor started/i.test(text)) {
    return toolUseId ? `tool:${toolUseId}` : `tool-result:${toolName}:${text.slice(0, 80)}`;
  }
  return undefined;
}

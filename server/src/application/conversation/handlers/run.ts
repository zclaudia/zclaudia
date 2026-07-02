import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  ErrorMessage,
  MessageAppendedMessage,
  RunSteerMessage,
  ServerMessage,
  StopBackgroundTaskMessage,
  TaskNotificationMessage,
} from '@zclaudia/shared/wire/messages';
import type { ConnectedClient, ActiveRun } from '../transport/types.js';
import type { TaskCoordinationPort } from '../../../application/conversation/task-coordination-port.js';
import type { ProcessMonitor } from '../../../utils/process-monitor.js';
import type { initDatabase } from '../../../infra/storage/db.js';
import type { Database } from 'better-sqlite3';
import { isProcessAlive, killProcessTree } from '../../../utils/process-tree.js';
import type { ProviderRegistryPort } from '../../../infra/providers/registry.js';
import { sendMessage } from '../transport/broadcast.js';
import { AgentProfileRepository } from '../../../domains/agent-profiles/repository.js';
import { LlmProfileRepository } from '../../../domains/llm-profiles/repository.js';
import { SessionRepository } from '../../../domains/sessions/repository.js';
import { TaskRepository } from '../../../domains/tasks/repository.js';
import { isTerminalPhase } from '../runtime/active-run-phase.js';
import { persistSteeredUserMessage } from '../runtime/steer-persistence.js';

function sendSteerError(client: ConnectedClient, code: string, message: string): void {
  sendMessage(client.ws, {
    type: 'error',
    code,
    message,
  } as ErrorMessage);
}

export async function handleKillLeakedProcesses(
  client: ConnectedClient,
  processMonitor: ProcessMonitor
): Promise<void> {
  console.log('[ProcessMonitor] Manual kill triggered by client');
  const result = await processMonitor.cleanupNow();
  sendMessage(client.ws, {
    type: 'process_cleanup_result',
    status: result.status,
    leakedCount: result.leakedCount,
    killedCount: result.killedCount,
    activeRunCount: result.activeRunCount,
  });
}

export async function handleStopBackgroundTask(
  client: ConnectedClient,
  message: StopBackgroundTaskMessage,
  db: ReturnType<typeof initDatabase>,
  activeRuns: Map<string, ActiveRun>,
  findProcessPidsByTaskCommand: (
    taskCommand?: string,
    excludedPids?: number[]
  ) => Promise<number[]>,
  providerRegistry: ProviderRegistryPort
): Promise<void> {
  const { sessionId: targetSessionId, taskId, taskRootPid, cliPid, taskCommand } = message;

  // Strategy 1: Direct PID kill
  const directPid = taskRootPid;
  if (directPid && isProcessAlive(directPid)) {
    console.log(`[StopTask] Direct PID stop for task ${taskId}: pid=${directPid}`);
    killProcessTree(directPid)
      .then(({ killed, failed }) => {
        const stopped = killed.length > 0 && failed.length === 0 && !isProcessAlive(directPid);
        sendMessage(client.ws, {
          type: 'task_notification',
          runId: '',
          sessionId: targetSessionId,
          taskId,
          status: stopped ? 'stopped' : 'failed',
          message: stopped ? `Task stopped by PID ${directPid}` : `Failed to stop PID ${directPid}`,
          cliPid,
          taskRootPid,
        } as TaskNotificationMessage);
      })
      .catch(err => {
        console.error(`[StopTask] Direct PID stop failed for task ${taskId}:`, err);
        sendMessage(client.ws, {
          type: 'task_notification',
          runId: '',
          sessionId: targetSessionId,
          taskId,
          status: 'failed',
          message: `PID stop failed: ${err instanceof Error ? err.message : String(err)}`,
          cliPid,
          taskRootPid,
        } as TaskNotificationMessage);
      });
    return;
  }

  // Strategy 2: Command-matched kill
  const matchedPids = await findProcessPidsByTaskCommand(
    taskCommand,
    [cliPid, taskRootPid].filter((pid): pid is number => typeof pid === 'number')
  );
  if (matchedPids.length > 0) {
    console.log(
      `[StopTask] Command-matched stop for task ${taskId}: pids=[${matchedPids.join(',')}]`
    );
    const killResults = await Promise.all(matchedPids.map(pid => killProcessTree(pid)));
    const failed = killResults.flatMap(result => result.failed);
    const killed = killResults.flatMap(result => result.killed);
    sendMessage(client.ws, {
      type: 'task_notification',
      runId: '',
      sessionId: targetSessionId,
      taskId,
      status: killed.length > 0 && failed.length === 0 ? 'stopped' : 'failed',
      message:
        killed.length > 0 && failed.length === 0
          ? `Task stopped by command match (${matchedPids.join(', ')})`
          : `Failed to stop command-matched PID(s): ${matchedPids.join(', ')}`,
      cliPid,
      taskRootPid,
    } as TaskNotificationMessage);
    return;
  }

  // Strategy 3: Provider adapter kill
  const targetRun = [...activeRuns.values()].find(r => r.sessionId === targetSessionId);
  let resolvedProviderType = targetRun?.providerType;
  let resolvedSdkSessionId = targetRun?.providerSessionId;
  const sessionRepo = new SessionRepository(db as unknown as Database);
  const session = sessionRepo.findById(targetSessionId);

  if (!resolvedSdkSessionId) {
    resolvedSdkSessionId = session?.sdkSessionId || undefined;
  }

  if (!resolvedProviderType) {
    // Resolve provider type via session → agent_profile → llm_profile chain,
    // using the same repository layer that run-bootstrap.ts uses (avoids the
    // older LEFT JOIN COALESCE shim that pre-dated agent profiles).
    const agentRepo = new AgentProfileRepository(db as unknown as Database);
    const llmRepo = new LlmProfileRepository(db as unknown as Database);
    const agentProfile = session?.agentProfileId
      ? (agentRepo.findById(session.agentProfileId) ?? agentRepo.findDefault())
      : agentRepo.findDefault();
    const llmProfile = agentProfile?.llmProfileId
      ? (llmRepo.findById(agentProfile.llmProfileId) ?? llmRepo.findDefault())
      : llmRepo.findDefault();
    resolvedProviderType = llmProfile?.providerType;
  }

  if (resolvedProviderType && resolvedSdkSessionId) {
    const adapter = providerRegistry.get(resolvedProviderType);
    if (adapter?.stopTask) {
      console.log(
        `[StopTask] Stopping task ${taskId}: adapter=${resolvedProviderType} sdkSession=${resolvedSdkSessionId}`
      );
      adapter
        .stopTask(resolvedSdkSessionId, taskId)
        .then(killed => {
          sendMessage(client.ws, {
            type: 'task_notification',
            runId: targetRun?.runId || '',
            sessionId: targetSessionId,
            taskId,
            status: killed !== false ? 'stopped' : 'failed',
            message: killed !== false ? 'Task stopped by user' : 'No processes found to kill',
          } as TaskNotificationMessage);
        })
        .catch(err => {
          console.error(`[StopTask] Failed to stop task ${taskId}:`, err);
          sendMessage(client.ws, {
            type: 'task_notification',
            runId: targetRun?.runId || '',
            sessionId: targetSessionId,
            taskId,
            status: 'failed',
            message: `Stop failed: ${err instanceof Error ? err.message : String(err)}`,
          } as TaskNotificationMessage);
        });
      return;
    }
  }

  console.warn(
    `[StopTask] Cannot stop task ${taskId} in session ${targetSessionId} — providerType=${resolvedProviderType} sdkSessionId=${resolvedSdkSessionId}`
  );
}

export async function handleAgentCancel(
  client: ConnectedClient,
  sessionId: string,
  activeRuns: Map<string, ActiveRun>,
  cancelRun: (runId: string) => void,
  db: ReturnType<typeof initDatabase>,
  taskCoordination?: Pick<TaskCoordinationPort, 'cancelCanonicalAgentTask'>
): Promise<void> {
  let cancelled = false;

  for (const [runId, run] of activeRuns.entries()) {
    if (run.sessionId === sessionId && !isTerminalPhase(run.phase)) {
      cancelRun(runId);
      cancelled = true;
      break;
    }
  }

  if (!cancelled && taskCoordination) {
    const canonicalTaskId = new TaskRepository(
      db as unknown as Database
    ).findLatestClaudiaAgentTaskId(sessionId);

    if (canonicalTaskId) {
      try {
        await taskCoordination.cancelCanonicalAgentTask(canonicalTaskId);
        return;
      } catch (err) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'TASK_CANCEL_FAILED',
          message: err instanceof Error ? err.message : 'Failed to cancel task',
        } as ErrorMessage);
        return;
      }
    }
  }
}

/**
 * Inject a user message into the live pi agent's steering queue for the named
 * run, so it gets processed at the next turn boundary without cancelling.
 *
 * Validates (in order): non-empty content; active run exists and isn't
 * completed; SteerHandle has been registered by the adapter (onAgentReady).
 * On accept: forwards to handle.steer, persists the user message to both the
 * `messages` table and the session-tree (so the next `buildContext` sees it and
 * history stays complete), tracks in pendingSteers for cancel-time draft
 * recovery, and broadcasts MessageAppendedMessage so every connected client
 * renders the user message immediately.
 */
export async function handleRunSteer(
  client: ConnectedClient,
  msg: RunSteerMessage,
  activeRuns: Map<string, ActiveRun>,
  broadcastRunMessage: (run: ActiveRun, payload: ServerMessage) => void
): Promise<void> {
  const trimmed = msg.content?.trim() ?? '';
  if (!trimmed) {
    sendSteerError(client, 'STEER_EMPTY', 'Steering message cannot be empty');
    return;
  }

  const run = activeRuns.get(msg.runId);
  if (!run || isTerminalPhase(run.phase)) {
    sendSteerError(client, 'STEER_NO_ACTIVE_RUN', 'No active run to steer');
    return;
  }
  if (!run.steerHandle) {
    sendSteerError(client, 'STEER_NOT_READY', 'Agent not yet ready for steering');
    return;
  }

  // Monotonic per run: guarantees the derived steer id stays unique even if two
  // steers land in the same millisecond (else the second collides on the
  // messages PRIMARY KEY and is dropped from history). The client mirrors this
  // exact value from the broadcast `timestamp`, so the ids stay in lockstep.
  const now = Math.max(Date.now(), (run.lastSteerAt ?? 0) + 1);
  run.lastSteerAt = now;
  const agentMessage: AgentMessage = {
    role: 'user',
    content: [{ type: 'text', text: trimmed }],
    timestamp: now,
  };

  // 1. Push into pi steering queue (drained at next turn boundary)
  try {
    run.steerHandle.steer(agentMessage);
  } catch (err) {
    console.error('[handleRunSteer] steer call threw:', err);
    sendSteerError(
      client,
      'STEER_FAILED',
      err instanceof Error ? err.message : 'Failed to inject steering message'
    );
    return;
  }

  // 2. Persist the steered user message so the next run's `buildContext`
  //    (tree-backed) sees it AND the history/UI projection stays complete.
  //    Without this the agent "forgets" the steer on the next turn and the
  //    client's optimistic render becomes an orphan that history sync drops.
  //    The message id is `steer-${runId}-${now}` so it matches the client's
  //    optimistic `stableId` (steer-<runId>-<timestamp>) and dedupes cleanly.
  //    Appending to the leaf *now* orders it ahead of this run's eventual
  //    assistant turn, matching how pi's steering queue interleaves it.
  const steerMessageId = `steer-${msg.runId}-${now}`;
  try {
    const db = run.db;
    if (db) {
      persistSteeredUserMessage(db, {
        id: steerMessageId,
        sessionId: run.sessionId,
        content: trimmed,
        createdAt: now,
      });
    }
  } catch (err) {
    // Persistence failure must NOT block the steer (agent already accepted it).
    // Log so the integrity gap is visible; the run proceeds with a partial write.
    console.error('[handleRunSteer] failed to persist steered user message:', err);
  }

  // 3. Track in memory so cancel can hand the text back as restoreDraft
  run.pendingSteers.push(agentMessage);

  // 4. Broadcast to all session clients so UI shows the user message immediately
  broadcastRunMessage(run, {
    type: 'message_appended',
    sessionId: run.sessionId,
    runId: msg.runId,
    role: 'user',
    content: trimmed,
    steered: true,
    timestamp: now,
  } as MessageAppendedMessage);
}

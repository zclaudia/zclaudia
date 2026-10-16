import { getUsageRecorder } from '../../../domains/usage/recorder.js';
/**
 * Background follow-up consumer for provider streams with in-flight background tasks.
 *
 * When a provider run completes but has pending background tasks (run_in_background),
 * the main run ends normally while this module continues consuming the stream in
 * a fire-and-forget async context. When the CLI sends a follow-up assistant turn
 * (after the background task finishes), a brand-new run is created so the frontend
 * sees it as a separate message.
 */

import { newId } from '../../../utils/uuid.js';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { ProviderRuntimeEvent } from '../../../infra/providers/types.js';
import type { ProviderRegistryPort } from '../../../infra/providers/registry.js';
import type { NotificationSender } from '../../../infra/push/notification-sender.js';
import type { NotificationService } from '../../../domains/notification-feed/index.js';
import type { ActiveRun, ConnectedClient } from '../transport/types.js';
import type { initDatabase } from '../../../infra/storage/db.js';
import { sendMessage, broadcastToOtherAuthenticatedClients } from '../transport/broadcast.js';
import { handleProviderEvent, type ProviderEventState } from './run-events.js';
import { persistAssistantTerminalSnapshot } from './run-terminal-snapshot.js';
import { postRunCompletedNotification } from './run-terminal-notifications.js';
import {
  loadSessionRememberedDecisions,
  loadProjectAllowedOutsideWorkspaceRoots,
} from '../agent/permission-evaluator.js';
import { PhaseEmitter, isTerminalPhase, setPhase } from './active-run-phase.js';
import { createRunDomainEvent, type RunDomainEvent } from './run-domain-events.js';
import {
  runDomainEventListeners,
  type RunDomainEventListenerRegistry,
} from './run-domain-event-listeners.js';
import { attachRunPhaseDomainEventEmitter } from './run-phase-domain-events.js';
import { createRunDeltaBatcher } from './run-delta-batcher.js';

export interface BackgroundFollowUpContext {
  /** Owns the original provider permission callback for this native invocation. */
  sourceRun?: ActiveRun;
  activeRuns: Map<string, ActiveRun>;
  broadcastHeartbeat: () => void;
  client: ConnectedClient;
  connectedClients: Map<string, ConnectedClient>;
  db: ReturnType<typeof initDatabase>;
  sessionId: string;
  projectId: string;
  providerType: string;
  providerRegistry: ProviderRegistryPort;
  notificationService: NotificationSender;
  notificationsService?: NotificationService;
  initialPendingTasks: number;
  /** The same native invocation continues after the foreground reply. */
  usageInvocationId?: string;
  workspaceRoot: string;
  listeners?: RunDomainEventListenerRegistry;
}

/**
 * Spawn a detached async consumer that continues reading the provider stream
 * after the main run has ended. Does not block the caller.
 */
export function spawnBackgroundFollowUpConsumer(
  iterator: AsyncIterator<ProviderRuntimeEvent>,
  ctx: BackgroundFollowUpContext
): void {
  consumeBackgroundStream(iterator, ctx).catch(err => {
    console.error('[BackgroundFollowUp] Unhandled error:', err);
  });
}

async function consumeBackgroundStream(
  iterator: AsyncIterator<ProviderRuntimeEvent>,
  ctx: BackgroundFollowUpContext
): Promise<void> {
  let pendingTasks = ctx.initialPendingTasks;
  let executionState: 'completed' | 'failed' = 'failed';
  const followUp: {
    run: ActiveRun | null;
    sendRunEvent: ((event: ServerMessage) => void) | null;
  } = { run: null, sendRunEvent: null };
  const toolUseIdToName = new Map<string, string>();
  const providerEventState: ProviderEventState = {};

  const ensureFollowUpRun = (): ActiveRun => {
    if (!followUp.run) {
      const created = createFollowUpRun(ctx);
      followUp.run = created.activeRun;
      if (ctx.usageInvocationId) {
        followUp.run.usageAccounting = {
          invocationId: ctx.usageInvocationId,
          runningMarked: true,
          deferSettlement: true,
        };
      }
      followUp.sendRunEvent = created.sendRunEvent;
      console.log(
        `[BackgroundFollowUp] Follow-up run ${followUp.run.runId} started for session ${ctx.sessionId}`
      );
    }
    return followUp.run;
  };
  // A can_use_tool control request may precede its assistant/tool_use event.
  // Create the answerable run lazily in either order, scoped to this stream.
  if (ctx.sourceRun) ctx.sourceRun.resolvePermissionRun = ensureFollowUpRun;

  try {
    while (true) {
      const iterResult = await iterator.next();
      if (iterResult.done) {
        executionState = 'completed';
        break;
      }
      const msg = iterResult.value;
      // Snapshots cover the original native invocation, not the synthetic
      // follow-up UI message. They can arrive before that UI run exists.
      if (msg.type === 'provider_usage_updated' && ctx.usageInvocationId) {
        getUsageRecorder(ctx.db).applySnapshotEvent(
          ctx.usageInvocationId,
          pendingTasks > 0 && msg.snapshot ? { ...msg.snapshot, final: false } : msg.snapshot
        );
        continue;
      }

      // Track background task lifecycle
      if (msg.type === 'task_notification') {
        if (msg.taskStatus === 'started') {
          pendingTasks++;
        } else if (
          msg.taskStatus === 'completed' ||
          msg.taskStatus === 'failed' ||
          msg.taskStatus === 'stopped'
        ) {
          pendingTasks = Math.max(0, pendingTasks - 1);
        }

        // Broadcast task_notification to clients even without an active follow-up run
        if (followUp.run && followUp.sendRunEvent) {
          handleProviderEvent({
            activeRun: followUp.run,
            activeRuns: ctx.activeRuns,
            broadcastHeartbeat: ctx.broadcastHeartbeat,
            client: ctx.client,
            db: ctx.db,
            input: '',
            modeValue: 'default',
            msg,
            notificationService: ctx.notificationService,
            notificationsService: ctx.notificationsService,
            persistSessionWorkingDirectory: () => {},
            providerRegistry: ctx.providerRegistry,
            providerType: ctx.providerType,
            runId: followUp.run.runId,
            sendRunEvent: followUp.sendRunEvent,
            sessionId: ctx.sessionId,
            sessionType: 'regular',
            state: providerEventState,
            toolUseIdToName,
          });
        }
        continue;
      }

      // New assistant/tool_use message → create a follow-up run
      if (!followUp.run && (msg.type === 'assistant' || msg.type === 'tool_use')) {
        ensureFollowUpRun();
      }

      if (followUp.run && followUp.sendRunEvent) {
        followUp.run.lastActivityAt = Date.now();

        handleProviderEvent({
          activeRun: followUp.run,
          activeRuns: ctx.activeRuns,
          broadcastHeartbeat: ctx.broadcastHeartbeat,
          client: ctx.client,
          db: ctx.db,
          input: '',
          modeValue: 'default',
          msg,
          notificationService: ctx.notificationService,
          notificationsService: ctx.notificationsService,
          persistSessionWorkingDirectory: () => {},
          providerRegistry: ctx.providerRegistry,
          providerType: ctx.providerType,
          runId: followUp.run.runId,
          sendRunEvent: followUp.sendRunEvent,
          sessionId: ctx.sessionId,
          sessionType: 'regular',
          state: providerEventState,
          toolUseIdToName,
        });

        if (isTerminalPhase(followUp.run.phase)) {
          executionState = followUp.run.phase === 'failed' ? 'failed' : 'completed';
          finalizeFollowUpRun(followUp.run, ctx);
          followUp.run = null;
          followUp.sendRunEvent = null;

          if (pendingTasks <= 0) {
            await iterator.return?.();
            return;
          }
          // More background tasks may still trigger another follow-up
        }
      }
    }
  } catch (error) {
    executionState = 'failed';
    throw error;
  } finally {
    if (ctx.sourceRun) delete ctx.sourceRun.resolvePermissionRun;
    if (ctx.usageInvocationId) {
      getUsageRecorder(ctx.db).settleInvocation({
        invocationId: ctx.usageInvocationId,
        executionState,
      });
    }
    await iterator.return?.();
    if (followUp.run) {
      finalizeFollowUpRun(followUp.run, ctx);
    }
  }
}

// ---------------------------------------------------------------------------
// Follow-up run lifecycle
// ---------------------------------------------------------------------------

function createFollowUpRun(ctx: BackgroundFollowUpContext): {
  activeRun: ActiveRun;
  sendRunEvent: (event: ServerMessage) => void;
} {
  const runId = newId();
  const assistantMessageId = newId();

  const activeRun: ActiveRun = {
    runId,
    clientId: ctx.client.id,
    client: ctx.client,
    pendingPermissions: new Map(),
    db: ctx.db,
    sessionId: ctx.sessionId,
    projectId: ctx.projectId,
    assistantMessageId,
    fullContent: '',
    collectedToolCalls: [],
    contentBlocks: [],
    thinkingBlocks: [],
    phase: 'running',
    phaseEmitter: new PhaseEmitter(),
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    recentToolCalls: [],
    loopHeartbeatStreak: 0,
    pendingBackgroundTasks: 0,
    sessionType: 'regular',
    workspaceRoot: ctx.workspaceRoot,
    rememberedDecisions: loadSessionRememberedDecisions(ctx.db, ctx.sessionId),
    allowedOutsideWorkspaceRoots: loadProjectAllowedOutsideWorkspaceRoots(ctx.db, ctx.projectId),
    eventSeq: 0,
    providerType: ctx.providerType,
    providerSessionId: ctx.sourceRun?.providerSessionId,
    providerCwd: ctx.sourceRun?.providerCwd,
    abortController: ctx.sourceRun?.abortController,
    aiInitiatedPlanMode: ctx.sourceRun?.aiInitiatedPlanMode,
    originalMode: ctx.sourceRun?.originalMode,
    pendingSteers: [],
    // agentProfile / llmProfile intentionally omitted: background follow-up runs
    // do not eagerly load these (they're not always available here), and as a
    // result auto-compaction is skipped for follow-up turns. The user-driven
    // /compact path can still compact the session on demand once the regular
    // session run loads the profiles.
  };

  // Wire broadcast
  const broadcastRaw = (msg: ServerMessage) => {
    sendMessage(ctx.client.ws, msg);
    if (ctx.connectedClients.size > 0) {
      broadcastToOtherAuthenticatedClients(ctx.connectedClients, ctx.client.id, msg);
    }
  };

  const sendSequencedRunEvent = (event: ServerMessage) => {
    if ('runId' in event) {
      activeRun.eventSeq += 1;
      (event as ServerMessage & { seq?: number }).seq = activeRun.eventSeq;
    }
    broadcastRaw(event);
  };
  const deltaBatcher = createRunDeltaBatcher(sendSequencedRunEvent);
  const sendRunEvent = deltaBatcher.send;
  activeRun.broadcast = (msg: ServerMessage) => {
    deltaBatcher.flush();
    broadcastRaw(msg);
  };
  activeRun.sendRunEvent = sendRunEvent;
  activeRun.flushPendingRunDeltas = deltaBatcher.flush;

  ctx.activeRuns.set(runId, activeRun);
  attachRunPhaseDomainEventEmitter(activeRun, ctx.listeners);

  sendRunEvent({
    type: 'run_started',
    runId,
    sessionId: ctx.sessionId,
    clientRequestId: `bg-followup:${runId}`,
    assistantMessageId,
  });
  emitBackgroundFollowUpDomainEvent(ctx, activeRun, 'backgroundFollowup.started');

  return { activeRun, sendRunEvent };
}

function finalizeFollowUpRun(run: ActiveRun, ctx: BackgroundFollowUpContext): void {
  let terminalSnapshot;
  try {
    if (!isTerminalPhase(run.phase)) setPhase(run, 'finalizing');
    terminalSnapshot = persistAssistantTerminalSnapshot(run, { indexMetadata: true });
  } catch (err) {
    console.error(`[BackgroundFollowUp] Failed to save message for run ${run.runId}:`, err);
  }

  if (!isTerminalPhase(run.phase)) {
    const completed = {
      type: 'run_completed',
      runId: run.runId,
      sessionId: run.sessionId,
      ...terminalSnapshot,
    } as const;
    if (run.sendRunEvent) run.sendRunEvent(completed);
    else run.broadcast?.(completed);
    setPhase(run, 'completed');
  }

  ctx.activeRuns.delete(run.runId);
  ctx.broadcastHeartbeat();

  postRunCompletedNotification({
    db: ctx.db,
    sessionId: ctx.sessionId,
    notificationSender: ctx.notificationService,
    notificationsService: ctx.notificationsService,
  });
  emitBackgroundFollowUpDomainEvent(ctx, run, 'backgroundFollowup.finished');

  console.log(`[BackgroundFollowUp] Follow-up run ${run.runId} finalized`);
}

function emitBackgroundFollowUpDomainEvent(
  ctx: BackgroundFollowUpContext,
  run: ActiveRun,
  type: 'backgroundFollowup.started' | 'backgroundFollowup.finished'
): RunDomainEvent<typeof type> {
  const event = createRunDomainEvent({
    type,
    runId: run.runId,
    sessionId: run.sessionId,
    providerType: run.providerType,
    seq: (run.eventSeq ?? 0) + 1,
    source: 'runtime',
    payload: {
      followupRunId: run.runId,
    },
  });
  (ctx.listeners ?? runDomainEventListeners).emit(event);
  return event;
}

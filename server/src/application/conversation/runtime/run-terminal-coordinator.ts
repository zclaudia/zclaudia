import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { ActiveRun } from '../transport/types.js';
import type { ProviderRegistryPort } from '../../../infra/providers/registry.js';
import type { ProviderRuntimeEvent, SystemInfo } from '../../../infra/providers/types.js';
import type { NotificationSender } from '../../../infra/push/notification-sender.js';
import type { NotificationService } from '../../../domains/notification-feed/index.js';
import {
  buildStatusOutput,
  SYSTEM_INFO_COMMANDS,
} from '../../../utils/server-utils.js';
import { maybeCompact } from '../compaction/compaction-service.js';
import { clearSession } from '../interactions/todo-state-tracker.js';
import { cleanupPendingPermissions, upsertAssistantMessage } from './run-lifecycle.js';
import { compactionDomainEventFor } from './compaction-events.js';
import { isTerminalPhase, setPhase } from './active-run-phase.js';
import { postRunCompletedNotification, postRunFailedNotification } from './run-terminal-notifications.js';
import { finalizeRunInteractions } from './interaction-coordinator.js';
import {
  createRunDomainEvent,
  type RunDomainEvent,
  type RunDomainEventPayloadMap,
  type RunDomainEventType,
} from './run-domain-events.js';
import {
  runDomainEventListeners,
  type RunDomainEventListenerRegistry,
} from './run-domain-event-listeners.js';
import { projectRunDomainEventToWireMessages } from './wire-projector.js';
import { broadcastRunMessage } from '../transport/broadcast.js';
import { maybeGenerateSessionTitle } from '../title/session-title-service.js';

export interface TerminalProviderEventState {
  systemInfo?: SystemInfo;
}

export interface CompleteProviderTurnInput {
  activeRun: ActiveRun;
  broadcastHeartbeat: () => void;
  db: ActiveRun['db'];
  input: string;
  msg: ProviderRuntimeEvent;
  notificationService: NotificationSender;
  notificationsService?: NotificationService;
  providerRegistry: ProviderRegistryPort;
  providerType: string;
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
  sessionId: string;
  sessionType: ActiveRun['sessionType'];
  state: TerminalProviderEventState;
  listeners?: RunDomainEventListenerRegistry;
}

export interface FailProviderTurnInput {
  activeRun: ActiveRun;
  activeRuns: Map<string, ActiveRun>;
  broadcastHeartbeat: () => void;
  cleanupReason: string;
  db: ActiveRun['db'];
  errorCode?: string;
  errorMessage: string;
  notificationService: NotificationSender;
  notificationsService?: NotificationService;
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
  sessionId: string;
  listeners?: RunDomainEventListenerRegistry;
}

export function completeProviderTurn(input: CompleteProviderTurnInput): void {
  const {
    activeRun,
    broadcastHeartbeat,
    db,
    msg,
    notificationService,
    notificationsService,
    providerType,
    runId,
    sendRunEvent,
    sessionId,
    sessionType,
    listeners,
  } = input;

  applyTerminalContentFallbacks(input);

  upsertAssistantMessage(activeRun, {
    usage: msg.usage,
    indexMetadata: true,
  });

  finalizeRunInteractions({
    activeRun,
    providerType,
    runId,
    sendRunEvent,
    sessionId,
  });

  const shouldRunCompaction = !isTerminalPhase(activeRun.phase)
    && Boolean(msg.usage)
    && Boolean(activeRun.agentProfile)
    && Boolean(activeRun.llmProfile);

  const wasAlreadyCompleted = isTerminalPhase(activeRun.phase);
  const emitRunCompleted = () => {
    if (wasAlreadyCompleted) {
      if (msg.usage) {
        sendRunEvent({
          type: 'run_completed',
          runId,
          sessionId: activeRun.sessionId,
          usage: msg.usage,
        });
      }
      return;
    }
    setPhase(activeRun, 'completed');
    dispatchTerminalDomainEvent({
      activeRun,
      listeners,
      payload: { usage: msg.usage },
      runId,
      sendRunEvent,
      type: 'run.completed',
    });
    broadcastHeartbeat();
    postRunCompletedNotification({
      db,
      sessionId,
      notificationSender: notificationService,
      notificationsService,
    });
  };

  const emitBackgroundUpdate = () => {
    if (sessionType === 'background') {
      sendRunEvent({
        type: 'background_task_update',
        sessionId,
        status: 'completed',
      } as import('@zclaudia/shared/wire/messages').BackgroundTaskUpdateMessage);
    }
  };

  const triggerSessionTitle = () => {
    if (!activeRun.agentProfile || !activeRun.llmProfile) return;
    maybeGenerateSessionTitle({
      db,
      sessionId,
      agentProfile: activeRun.agentProfile,
      llmProfile: activeRun.llmProfile,
      broadcast: (m) => broadcastRunMessage(activeRun, m),
    });
  };

  if (shouldRunCompaction) {
    setPhase(activeRun, 'completed');
    maybeCompact({
      db,
      sessionId: activeRun.sessionId,
      agentProfile: activeRun.agentProfile!,
      llmProfile: activeRun.llmProfile!,
      lastAssistantUsage: msg.usage,
      source: 'auto',
      signal: activeRun.abortController?.signal,
    }).then((outcome) => {
      if (outcome.outcome === 'compacted') {
        console.log(`[Compaction] auto session=${activeRun.sessionId} id=${outcome.compactionId} tokens=${outcome.tokensBefore}`);
      } else if (outcome.outcome === 'failed') {
        console.warn(`[Compaction] auto FAILED session=${activeRun.sessionId} reason=${outcome.reason} tokens=${outcome.tokensBefore ?? 'n/a'} breakerOpen=${outcome.breaker?.breakerOpen}`);
      } else if (outcome.reason === 'circuit_open') {
        console.log(`[Compaction] auto skipped session=${activeRun.sessionId} (circuit open until ${outcome.breaker?.nextRetryAtMs})`);
      } else {
        console.log(`[Compaction] auto skipped session=${activeRun.sessionId} reason=${outcome.reason} tokens=${outcome.tokensBefore ?? 'n/a'}`);
      }
      const event = compactionDomainEventFor({
        outcome,
        providerType: activeRun.providerType,
        runId,
        seq: (activeRun.eventSeq ?? 0) + 1,
        sessionId: activeRun.sessionId,
      });
      if (event) emitTerminalDomainEvent({
        event,
        listeners,
        sendRunEvent,
      });
    }).catch((err: unknown) => {
      console.warn('[Compaction] auto-trigger unexpected error:', err instanceof Error ? err.message : err);
    }).finally(() => {
      emitRunCompleted();
      emitBackgroundUpdate();
      triggerSessionTitle();
    });
  } else {
    emitRunCompleted();
    emitBackgroundUpdate();
    triggerSessionTitle();
  }

}

export function failProviderTurn(input: FailProviderTurnInput): void {
  const {
    activeRun,
    activeRuns,
    broadcastHeartbeat,
    cleanupReason,
    db,
    errorCode,
    errorMessage,
    notificationService,
    notificationsService,
    runId,
    sendRunEvent,
    sessionId,
    listeners,
  } = input;

  if (!isTerminalPhase(activeRun.phase)) {
    try {
      upsertAssistantMessage(activeRun, { indexMetadata: true });
    } catch (saveErr) {
      console.error(`[Error Save] Failed for run ${runId}:`, saveErr);
    }
    setPhase(activeRun, 'failed');
    dispatchTerminalDomainEvent({
      activeRun,
      listeners,
      payload: {
        error: errorMessage,
        ...(errorCode ? { errorCode } : {}),
      },
      runId,
      sendRunEvent,
      type: 'run.failed',
    });
    broadcastHeartbeat();
    postRunFailedNotification({
      db,
      sessionId,
      error: errorMessage,
      notificationSender: notificationService,
      notificationsService,
    });
  }

  clearSession(sessionId);
  cleanupPendingPermissions(activeRun, cleanupReason);
  activeRuns.delete(runId);
}

function dispatchTerminalDomainEvent<TType extends RunDomainEventType>(input: {
  activeRun: ActiveRun;
  listeners?: RunDomainEventListenerRegistry;
  payload: RunDomainEventPayloadMap[TType];
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
  type: TType;
}): RunDomainEvent<TType> {
  const event = createRunDomainEvent({
    type: input.type,
    runId: input.runId,
    sessionId: input.activeRun.sessionId,
    providerType: input.activeRun.providerType,
    seq: (input.activeRun.eventSeq ?? 0) + 1,
    source: 'runtime',
    payload: input.payload,
  });

  emitTerminalDomainEvent({
    event,
    listeners: input.listeners,
    sendRunEvent: input.sendRunEvent,
  });
  return event;
}

function emitTerminalDomainEvent(input: {
  event: RunDomainEvent;
  listeners?: RunDomainEventListenerRegistry;
  sendRunEvent: (event: ServerMessage) => void;
}): void {
  for (const wireEvent of projectRunDomainEventToWireMessages(input.event)) {
    input.sendRunEvent(stripProjectedSeq(wireEvent));
  }
  (input.listeners ?? runDomainEventListeners).emit(input.event);
}

function stripProjectedSeq(event: ServerMessage): ServerMessage {
  const eventForSend = { ...event };
  if ('seq' in eventForSend) {
    delete (eventForSend as { seq?: number }).seq;
  }
  return eventForSend;
}

function applyTerminalContentFallbacks(input: CompleteProviderTurnInput): void {
  const { activeRun, input: userInput, msg, providerRegistry, runId, sendRunEvent, state } = input;

  if (msg.content && !activeRun.fullContent) {
    activeRun.fullContent = msg.content;
    activeRun.contentBlocks.push({ type: 'text', content: msg.content });
    sendRunEvent({
      type: 'delta',
      runId,
      sessionId: activeRun.sessionId,
      content: msg.content,
    });
  }

  const inputTrimmed = userInput.trim().toLowerCase();
  if (!activeRun.fullContent && SYSTEM_INFO_COMMANDS.includes(inputTrimmed) && state.systemInfo) {
    const statusOutput = buildStatusOutput(state.systemInfo);
    if (statusOutput) {
      activeRun.fullContent = statusOutput;
      sendRunEvent({
        type: 'delta',
        runId,
        sessionId: activeRun.sessionId,
        content: statusOutput,
      });
    }
  }

  if (
    !activeRun.fullContent &&
    activeRun.collectedToolCalls.length > 0 &&
    activeRun.providerType
  ) {
    const fallback = providerRegistry.getPolicy(activeRun.providerType)?.emptyResultFallback;
    if (fallback) {
      activeRun.fullContent = fallback;
      activeRun.contentBlocks.push({ type: 'text', content: fallback });
      sendRunEvent({
        type: 'delta',
        runId,
        sessionId: activeRun.sessionId,
        content: fallback,
      });
    }
  }

  const lastBlock = activeRun.contentBlocks[activeRun.contentBlocks.length - 1];
  const endsWithThinking = lastBlock?.type === 'text' &&
    lastBlock.content.trimEnd().endsWith('</think>');
  if (endsWithThinking) {
    console.warn(`[Truncation] Run ${runId} ended with a thinking block as last output. Possible provider truncation.`);
    const warning = '\n\n⚠️ *The model appeared to stop mid-thought without producing a response. This may be caused by output token limits or provider compatibility issues. Try sending "continue" or starting a new session.*';
    activeRun.fullContent += warning;
    activeRun.contentBlocks.push({ type: 'text', content: warning });
    sendRunEvent({
      type: 'delta',
      runId,
      sessionId: activeRun.sessionId,
      content: warning,
    });
  }
}

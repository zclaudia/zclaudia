import type { ActiveRun } from '../transport/types.js';
import { formatProviderErrorMessage } from '../../../utils/server-utils.js';
import type { ProviderRegistryPort } from '../../../infra/providers/registry.js';
import type { ProviderRuntimeEvent, SystemInfo } from '../../../infra/providers/types.js';
import type { NotificationSender } from '../../../infra/push/notification-sender.js';
import type { NotificationService } from '../../../domains/notification-feed/index.js';
import { isTerminalPhase } from './active-run-phase.js';
import { isContextOverflowError, ContextOverflowError } from './context-overflow.js';
import { dispatchProviderRuntimeEventToDomain } from './run-domain-dispatcher.js';
import { completeProviderTurn, failProviderTurn } from './run-terminal-coordinator.js';
import {
  handleTaskNotification,
  trackBackgroundTaskFromToolResult,
} from './background-task-coordinator.js';
import { handleToolUseInteraction } from './interaction-coordinator.js';
import { handleProviderInit } from './provider-session-coordinator.js';
import { handleModeTransition } from './mode-transition-coordinator.js';
import { registerPluginDomainEventListener } from './plugin-domain-event-listener.js';

registerPluginDomainEventListener();

export interface ProviderEventState {
  sdkSessionId?: string;
  systemInfo?: SystemInfo;
  backgroundTaskKeys?: Set<string>;
  /** Sum of totalTokens across this run's turn-finished events; fed to the goal coordinator. */
  lastTurnTotalTokens?: number;
}

interface HandleProviderEventParams {
  activeRun: ActiveRun;
  activeRuns: Map<string, ActiveRun>;
  client: ActiveRun['client'];
  db: ActiveRun['db'];
  input: string;
  modeValue: string;
  notificationService: NotificationSender;
  notificationsService?: NotificationService;
  persistSessionWorkingDirectory: (nextWorkingDirectory: string | null | undefined) => void;
  providerType: string;
  runId: string;
  sendRunEvent: (event: import('@zclaudia/shared/wire/messages').ServerMessage) => void;
  sessionId: string;
  sessionType: ActiveRun['sessionType'];
  state: ProviderEventState;
  toolUseIdToName: Map<string, string>;
  msg: ProviderRuntimeEvent;
  broadcastHeartbeat: () => void;
  providerRegistry: ProviderRegistryPort;
}

export function handleProviderEvent({
  activeRun,
  activeRuns,
  broadcastHeartbeat,
  client,
  db,
  input,
  modeValue,
  msg,
  notificationService,
  notificationsService,
  persistSessionWorkingDirectory,
  providerRegistry,
  providerType,
  runId,
  sendRunEvent,
  sessionId,
  sessionType,
  state,
  toolUseIdToName,
}: HandleProviderEventParams): void {
  switch (msg.type) {
    case 'init':
      handleProviderInit({
        activeRun,
        db,
        msg,
        persistSessionWorkingDirectory,
        runId,
        sendRunEvent,
        sessionId,
        state,
      });
      break;

    case 'assistant':
    case 'assistant_delta': {
      if (!msg.content) break;
      dispatchProviderRuntimeEventToDomain({
        activeRun,
        providerEvent: msg,
        providerType,
        runId,
        sendRunEvent,
      });
      break;
    }

    case 'tool_use':
    case 'tool_started': {
      if (msg.toolUseId && msg.toolName) {
        toolUseIdToName.set(msg.toolUseId, msg.toolName);
      }

      dispatchProviderRuntimeEventToDomain({
        activeRun,
        providerEvent: msg,
        providerType,
        runId,
        sendRunEvent,
      });

      handleToolUseInteraction({
        activeRun,
        msg,
        providerType,
        runId,
        sendRunEvent,
        sessionId,
      });
      break;
    }

    case 'tool_result':
    case 'tool_finished': {
      const toolName =
        msg.toolName || (msg.toolUseId ? toolUseIdToName.get(msg.toolUseId) || '' : '');
      const dispatchMsg = toolName && toolName !== msg.toolName ? { ...msg, toolName } : msg;
      dispatchProviderRuntimeEventToDomain({
        activeRun,
        providerEvent: dispatchMsg as ProviderRuntimeEvent,
        providerType,
        runId,
        sendRunEvent,
      });

      trackBackgroundTaskFromToolResult({
        activeRun,
        state,
        toolName,
        toolUseId: msg.toolUseId,
        result: msg.toolResult,
        isError: msg.isToolError,
      });

      break;
    }

    case 'mode_transition': {
      handleModeTransition({
        activeRun,
        modeValue,
        msg,
        providerRegistry,
        providerType,
        runId,
        sendRunEvent,
      });
      break;
    }

    case 'tool_activity': {
      // Providers that emit per-tool execution updates (pi-runtime,
      // tool_execution_update) populate msg.toolUseId directly. Fall back
      // to the legacy "most recent uncompleted Agent" heuristic for the
      // Claude SDK path which only emits sub-agent progress text.
      const targetToolUseId =
        msg.toolUseId ||
        [...activeRun.collectedToolCalls].reverse().find(tc => tc.name === 'Agent' && !tc.output)
          ?.toolUseId;
      if (targetToolUseId && msg.content) {
        dispatchProviderRuntimeEventToDomain({
          activeRun,
          providerEvent: { ...msg, toolUseId: targetToolUseId },
          providerType,
          runId,
          sendRunEvent,
        });
      }
      break;
    }

    case 'thinking_delta': {
      dispatchProviderRuntimeEventToDomain({
        activeRun,
        providerEvent: msg,
        providerType,
        runId,
        sendRunEvent,
      });
      // No wire-level streaming for thinking content yet — the desktop UI
      // currently receives thinking blocks via the final assistant message
      // metadata persisted in upsertAssistantMessage. A future task can add
      // a delta event if real-time reasoning rendering is desired.
      break;
    }

    case 'result':
    case 'provider_turn_finished': {
      completeProviderTurn({
        activeRun,
        broadcastHeartbeat,
        db,
        input,
        msg,
        notificationService,
        notificationsService,
        providerRegistry,
        providerType,
        runId,
        sendRunEvent,
        sessionId,
        sessionType,
        state,
      });
      break;
    }

    case 'retry_scheduled': {
      dispatchProviderRuntimeEventToDomain({
        activeRun,
        providerEvent: msg,
        providerType,
        runId,
        sendRunEvent,
      });
      break;
    }

    case 'error':
    case 'provider_error': {
      const rawProviderError = (msg.error || 'Provider error') as string;

      // Context-window overflow: do NOT fail here. Throw a sentinel so the
      // synchronous call stack unwinds to handleRunStart's catch → handleRunException,
      // which compacts and retries. handleProviderEvent is sync (: void), so this
      // throw propagates through consume-provider-stream's while-loop.
      if (
        isContextOverflowError(rawProviderError, msg.errorCode) &&
        !isTerminalPhase(activeRun.phase)
      ) {
        console.warn(
          `[Overflow] runId=${runId} provider rejected turn for context overflow; deferring to recovery`
        );
        throw new ContextOverflowError(rawProviderError);
      }

      const authHint = activeRun.providerType
        ? providerRegistry.getPolicy(activeRun.providerType)?.authErrorHint
        : undefined;
      const errorMessage = formatProviderErrorMessage(
        rawProviderError,
        activeRun.providerType,
        authHint
      );
      console.error(
        `[Provider Error] runId=${runId} provider=${activeRun.providerType}: ${rawProviderError}`
      );

      failProviderTurn({
        activeRun,
        activeRuns,
        broadcastHeartbeat,
        cleanupReason: errorMessage,
        db,
        errorCode: msg.errorCode,
        errorMessage,
        notificationService,
        notificationsService,
        runId,
        sendRunEvent,
        sessionId,
      });
      break;
    }

    case 'task_notification': {
      handleTaskNotification({
        activeRun,
        msg,
        providerRegistry,
        runId,
        sendRunEvent,
        state,
      });
      break;
    }
  }
}

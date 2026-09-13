/**
 * WebSocket message dispatcher.
 * Routes ClientMessage to domain-specific handlers under ../handlers/.
 */
import type {
  ClientMessage,
  PongMessage,
  ErrorMessage,
  BrowserEngineStatusMessage,
} from '@zclaudia/shared/wire/messages';
import type { TerminalManager } from '../../../terminal-manager.js';
import type { ProcessMonitor } from '../../../utils/process-monitor.js';
import type { initDatabase } from '../../../infra/storage/db.js';
import type { ConnectedClient, ActiveRun } from './types.js';
import type { NotificationService } from '../../../domains/notification-feed/index.js';
import type { TaskCoordinationPort } from '../../../application/conversation/task-coordination-port.js';
import type { ProviderRegistryPort } from '../../../infra/providers/registry.js';
import { sendMessage } from './broadcast.js';
import { resolveReservedInvocation } from '../../invocations/gateway.js';
import {
  getSessionInvocableSnapshot,
  resolveSessionInvocation,
} from '../../invocations/session-catalog.js';
import { hostActionRegistry } from '../../invocations/host-actions.js';
import { providerRegistry as defaultProviderRegistry } from '../../../infra/providers/registry.js';
import { InvocationError, type RuntimeAttachment } from '@zclaudia/shared/providers';
import { normalizeLegacyRunInput, normalizeRunStartV2 } from '@zclaudia/shared/wire/messages';
import { isTerminalPhase } from '../runtime/active-run-phase.js';

// Domain handlers
import {
  handleTerminalOpen,
  handleTerminalInput,
  handleTerminalResize,
  handleTerminalClose,
  handleTerminalDetach,
  handleTerminalAttach,
} from '../handlers/terminal.js';
import {
  handleGetNotifications,
  handleMarkNotificationsRead,
  handleMarkAllNotificationsRead,
  handleDismissNotifications,
  handleClearReadNotifications,
} from '../handlers/notification-feed.js';
import {
  handlePermission,
  handlePromptAnswerMessage,
  handleInteractionResponse,
  handlePluginPermissionResponse,
} from '../../../application/conversation/interactions/ws-handlers.js';
import {
  handleKillLeakedProcesses,
  handleStopBackgroundTask,
  handleAgentCancel,
  handleRunSteer,
} from '../handlers/run.js';
import { requestBackgroundForCommand } from '../../../infra/providers/pi-runtime/inflight-bash-registry.js';
import { broadcastRunMessage } from './broadcast.js';
import {
  handleClaudiaMessage,
  handleClaudiaTaskSubmit,
  handleClaudiaTaskContinue,
  handleClaudiaTaskCancel,
} from '../handlers/claudia.js';
import {
  handleCreateMetaWorkflowRun,
  handleSubmitMetaWorkflowRequirements,
  handleResolveMetaWorkflowRequirements,
  handleSetMetaWorkflowPhases,
  handleCancelMetaWorkflowRun,
  handleRunMetaWorkflowPhase,
  handleRerunMetaWorkflowPhase,
  handleIgnoreMetaWorkflowPhaseStale,
  handleEvaluateMetaWorkflowPhaseImpact,
  handleCascadeRerunMetaWorkflowPhase,
} from '../handlers/meta-workflow.js';
import { handleBrowserMessage } from '../handlers/browser.js';
import type { BrowserManager } from '../../browser/browser-manager.js';

/** Context object bundling module-level dependencies for handleClientMessage. */
export interface MessageHandlerContext {
  activeRuns: Map<string, ActiveRun>;
  connectedClients: Map<string, ConnectedClient>;
  processMonitor: ProcessMonitor | null;

  handleRunStart: (
    client: ConnectedClient,
    message: any,
    db: ReturnType<typeof initDatabase>,
    options?: Record<string, unknown>,
    clients?: Map<string, ConnectedClient>
  ) => Promise<void>;
  cancelRun: (runId: string) => void;
  /** Pause the session's active goal when its run is interrupted (Codex-aligned). */
  pauseActiveGoalForSession?: (sessionId: string) => void;
  broadcastPluginState: () => void;
  findProcessPidsByTaskCommand: (
    taskCommand?: string,
    excludedPids?: number[]
  ) => Promise<number[]>;
  notificationService?: NotificationService;
  taskCoordination?: TaskCoordinationPort;
  providerRegistry?: ProviderRegistryPort;
  permissionBridge?: import('../agent/permission-bridge.js').PermissionBridge;
  cancelWorkflowRun?: (runId: string) => void;
  metaWorkflowService?: import('../../../domains/meta-workflow/service.js').MetaWorkflowService;
  browserManager?: BrowserManager;
  installBrowserEngine?: (notify: (msg: BrowserEngineStatusMessage) => void) => Promise<void>;
  broadcastBrowserEngineStatus?: (msg: BrowserEngineStatusMessage) => void;
}

export async function handleClientMessage(
  client: ConnectedClient,
  message: ClientMessage,
  db: ReturnType<typeof initDatabase>,
  clients: Map<string, ConnectedClient>,
  ctx: MessageHandlerContext,
  termMgr?: TerminalManager
): Promise<void> {
  if (ctx.browserManager && message.type.startsWith('browser_')) {
    const handled = handleBrowserMessage(
      client,
      message,
      ctx.browserManager,
      ctx.broadcastBrowserEngineStatus ?? (() => {}),
      ctx.installBrowserEngine
    );
    if (handled) return;
  }

  switch (message.type) {
    // ── Core ──
    case 'auth':
      break; // Already handled before dispatch

    case 'ping':
      sendMessage(client.ws, { type: 'pong' } as PongMessage);
      break;

    // ── Run lifecycle ──
    case 'run_start': {
      const registry = ctx.providerRegistry ?? defaultProviderRegistry;
      try {
        if ((message as { protocolVersion?: unknown }).protocolVersion === 2) {
          const normalized = normalizeRunStartV2(message as never);
          const turnInput = (message as import('@zclaudia/shared/wire/messages').RunStartMessageV2)
            .turnInput;
          if (normalized.kind === 'invocation') {
            await dispatchCanonicalInvocation({
              client,
              clients,
              ctx,
              db,
              registry,
              runStart: normalized.runStart as InternalRunStart,
              request: normalized.request,
              attachments: turnInput.attachments as RuntimeAttachment[] | undefined,
            });
            break;
          }
          const handled = await dispatchReservedMessage({
            client,
            clients,
            ctx,
            db,
            registry,
            runStart: normalized.runStart as InternalRunStart,
            text: turnInput.type === 'message' ? turnInput.text : normalized.runStart.input,
            attachments: turnInput.attachments as RuntimeAttachment[] | undefined,
            reservedNamespaceMode:
              turnInput.type === 'message' ? turnInput.reservedNamespaceMode : undefined,
          });
          if (!handled) await ctx.handleRunStart(client, normalized.runStart, db, {}, clients);
          break;
        }

        // Legacy desktop sends a string (or the established JSON attachment
        // envelope). Reserved namespaces must pass through the same gateway so
        // `/skill:` and `/<runtime>:` cannot bypass canonical routing.
        const legacyMessage = message as import('@zclaudia/shared/wire/messages').RunStartMessage;
        const legacy = normalizeLegacyRunInput(legacyMessage.input);
        const handled = await dispatchReservedMessage({
          client,
          clients,
          ctx,
          db,
          registry,
          runStart: legacyMessage as InternalRunStart,
          text: legacy.text,
          attachments: legacy.attachments as RuntimeAttachment[] | undefined,
        });
        if (!handled) await ctx.handleRunStart(client, message, db, {}, clients);
      } catch (error) {
        sendMessage(client.ws, {
          type: 'error',
          code: error instanceof InvocationError ? error.code : 'INVOCATION_PREPARE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        } as ErrorMessage);
      }
      break;
    }

    case 'agent_start':
      await ctx.handleRunStart(
        client,
        {
          type: 'run_start',
          clientRequestId: message.clientRequestId,
          sessionId: message.sessionId,
          input: message.input,
          llmProfileId: message.llmProfileId,
        },
        db,
        {},
        clients
      );
      break;

    case 'run_cancel': {
      const run = ctx.activeRuns.get(message.runId);
      const pausable = !!run && !isTerminalPhase(run.phase);
      ctx.cancelRun(message.runId);
      if (run?.sessionId && pausable) ctx.pauseActiveGoalForSession?.(run.sessionId);
      break;
    }

    case 'run_steer':
      await handleRunSteer(client, message, ctx.activeRuns, broadcastRunMessage);
      break;

    case 'agent_cancel':
      await handleAgentCancel(
        client,
        message.sessionId,
        ctx.activeRuns,
        ctx.cancelRun,
        db,
        ctx.taskCoordination
      );
      break;

    case 'kill_leaked_processes':
      if (ctx.processMonitor) await handleKillLeakedProcesses(client, ctx.processMonitor);
      break;

    case 'stop_background_task':
      if (!ctx.providerRegistry) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'NOT_READY',
          message: 'Provider registry not available',
        } as ErrorMessage);
        break;
      }
      await handleStopBackgroundTask(
        client,
        message,
        db,
        ctx.activeRuns,
        ctx.findProcessPidsByTaskCommand,
        ctx.providerRegistry
      );
      break;

    case 'background_running_command': {
      const conversion = requestBackgroundForCommand(message.sessionId, message.toolUseId);
      if (!conversion.ok) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'NO_INFLIGHT_COMMAND',
          message: conversion.reason,
        } as ErrorMessage);
      }
      // On success the tool result (background:true) and the task_notification
      // broadcast arrive through the normal run/task event flow.
      break;
    }

    // ── Notifications ──
    case 'get_notifications':
      if (ctx.notificationService) handleGetNotifications(client, message, ctx.notificationService);
      break;

    case 'mark_notifications_read':
      if (ctx.notificationService) handleMarkNotificationsRead(message, ctx.notificationService);
      break;

    case 'mark_all_notifications_read':
      if (ctx.notificationService) handleMarkAllNotificationsRead(message, ctx.notificationService);
      break;

    case 'dismiss_notifications':
      if (ctx.notificationService) handleDismissNotifications(message, ctx.notificationService);
      break;

    case 'clear_read_notifications':
      if (ctx.notificationService) handleClearReadNotifications(ctx.notificationService);
      break;

    // ── Claudia (inline + tasks) ──
    case 'claudia_message':
      await handleClaudiaMessage(client, message, db, clients, ctx);
      break;

    case 'claudia_task_submit':
      if (!ctx.taskCoordination) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'NO_ORCHESTRATOR',
          message: 'Task coordination not available',
        } as ErrorMessage);
        break;
      }
      await handleClaudiaTaskSubmit(client, message, db, ctx.taskCoordination);
      break;

    case 'claudia_task_continue':
      if (!ctx.taskCoordination) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'NO_ORCHESTRATOR',
          message: 'Task coordination not available',
        } as ErrorMessage);
        break;
      }
      await handleClaudiaTaskContinue(client, message, db, ctx.taskCoordination);
      break;

    case 'claudia_task_cancel':
      if (!ctx.taskCoordination) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'NO_ORCHESTRATOR',
          message: 'Task coordination not available',
        } as ErrorMessage);
        break;
      }
      await handleClaudiaTaskCancel(client, message, ctx.taskCoordination);
      break;

    // ── Permissions ──
    case 'permission_decision':
      handlePermission(
        message,
        ctx.activeRuns,
        ctx.connectedClients,
        ctx.permissionBridge,
        ctx.cancelWorkflowRun
      );
      break;

    case 'prompt_answer':
      handlePromptAnswerMessage(message, ctx.activeRuns, ctx.connectedClients);
      break;

    case 'interaction_response':
      handleInteractionResponse(message, ctx.activeRuns, clients);
      break;

    case 'plugin_permission_response':
      handlePluginPermissionResponse(message, ctx.broadcastPluginState);
      break;

    // ── Meta Workflow ──
    case 'create_meta_workflow_run':
      if (ctx.metaWorkflowService)
        handleCreateMetaWorkflowRun(client, message, ctx.metaWorkflowService);
      break;

    case 'submit_meta_workflow_requirements':
      if (ctx.metaWorkflowService)
        handleSubmitMetaWorkflowRequirements(client, message, ctx.metaWorkflowService);
      break;

    case 'resolve_meta_workflow_requirements':
      if (ctx.metaWorkflowService)
        handleResolveMetaWorkflowRequirements(client, message, ctx.metaWorkflowService);
      break;

    case 'set_meta_workflow_phases':
      if (ctx.metaWorkflowService)
        handleSetMetaWorkflowPhases(client, message, ctx.metaWorkflowService);
      break;

    case 'cancel_meta_workflow_run':
      if (ctx.metaWorkflowService)
        handleCancelMetaWorkflowRun(client, message, ctx.metaWorkflowService);
      break;

    case 'run_meta_workflow_phase':
      if (ctx.metaWorkflowService)
        await handleRunMetaWorkflowPhase(client, message, ctx.metaWorkflowService);
      break;

    case 'rerun_meta_workflow_phase':
      if (ctx.metaWorkflowService)
        await handleRerunMetaWorkflowPhase(client, message, ctx.metaWorkflowService);
      break;

    case 'ignore_meta_workflow_phase_stale':
      if (ctx.metaWorkflowService)
        handleIgnoreMetaWorkflowPhaseStale(client, message, ctx.metaWorkflowService);
      break;

    case 'evaluate_meta_workflow_phase_impact':
      if (ctx.metaWorkflowService)
        await handleEvaluateMetaWorkflowPhaseImpact(client, message, ctx.metaWorkflowService);
      break;

    case 'cascade_rerun_meta_workflow_phase':
      if (ctx.metaWorkflowService)
        await handleCascadeRerunMetaWorkflowPhase(client, message, ctx.metaWorkflowService);
      break;

    // ── Terminal ──
    case 'terminal_open':
      if (termMgr) handleTerminalOpen(client, message, db, termMgr);
      break;

    case 'terminal_input':
      if (termMgr) handleTerminalInput(message, termMgr);
      break;

    case 'terminal_resize':
      if (termMgr) handleTerminalResize(message, termMgr);
      break;

    case 'terminal_close':
      if (termMgr) handleTerminalClose(client, message, termMgr);
      break;

    case 'terminal_detach':
      if (termMgr) handleTerminalDetach(message, client.id, termMgr);
      break;

    case 'terminal_attach':
      if (termMgr) handleTerminalAttach(client, message, termMgr);
      break;

    // ── Unknown ──
    default:
      sendMessage(client.ws, {
        type: 'error',
        code: 'UNKNOWN_MESSAGE_TYPE',
        message: `Unknown message type: ${(message as { type: string }).type}`,
      } as ErrorMessage);
  }
}

// ── URIP invocation gateway helpers (§12.2/§12.4) ────────────────────────────

type SubmittedRequest = import('@zclaudia/shared/providers').InvocationRequest;
type InternalRunStart = import('../runtime/run-bootstrap.js').RunStartMessage;

interface InvocationDispatchBase {
  client: ConnectedClient;
  clients: Map<string, ConnectedClient>;
  ctx: MessageHandlerContext;
  db: ReturnType<typeof initDatabase>;
  registry: ProviderRegistryPort;
  runStart: InternalRunStart;
  attachments?: RuntimeAttachment[];
}

async function dispatchReservedMessage(
  input: InvocationDispatchBase & {
    text: string;
    reservedNamespaceMode?: 'resolve' | 'literal';
  }
): Promise<boolean> {
  const runtimeType = runtimeTypeForSession(input.db, input.runStart.sessionId);
  let disposition = resolveReservedInvocation({
    text: input.text,
    runtimeType,
    reservedNamespaceMode: input.reservedNamespaceMode,
  });
  if (disposition.kind === 'passthrough') return false;

  if (disposition.kind === 'unresolved' && disposition.namespace !== 'zc') {
    const snapshot = await getSessionInvocableSnapshot(
      input.db,
      input.runStart.sessionId,
      input.registry
    );
    if (!snapshot) throw new InvocationError('INVOCATION_NOT_FOUND', 'Session not found.');
    disposition = resolveReservedInvocation({
      text: input.text,
      runtimeType,
      snapshot,
      reservedNamespaceMode: input.reservedNamespaceMode,
    });
    if (disposition.kind === 'catalog-invocation') {
      await dispatchCanonicalInvocation({
        ...input,
        request: {
          invocableId: disposition.descriptor.id,
          catalogRevision: snapshot.revision,
          contextFingerprint: snapshot.contextFingerprint,
          arguments: { type: 'raw', value: disposition.rawArguments },
        },
      });
      return true;
    }
  }

  if (disposition.kind === 'host-action') {
    const definition = hostActionRegistry.get(disposition.name);
    if (!definition) {
      throw new InvocationError(
        'INVOCATION_NOT_FOUND',
        'The selected host action no longer exists.'
      );
    }
    const request: SubmittedRequest = {
      invocableId: `host:${disposition.name}`,
      catalogRevision: 'reserved-namespace',
      contextFingerprint: 'reserved-namespace',
      arguments: { type: 'raw', value: disposition.rawArguments },
    };
    const result = await hostActionRegistry.execute(disposition.name, request, {
      sessionId: input.runStart.sessionId,
      arguments: request.arguments,
    });
    sendInvocationResolution(
      input.client,
      input.runStart.clientRequestId,
      input.runStart.sessionId,
      result
    );
    return true;
  }

  if (disposition.kind === 'unresolved') {
    throw new InvocationError(
      disposition.code,
      `No invocable matches /${disposition.namespace}:${extractReservedName(input.text)}.`
    );
  }
  return disposition.kind !== 'passthrough';
}

async function dispatchCanonicalInvocation(
  input: InvocationDispatchBase & { request: SubmittedRequest }
): Promise<void> {
  const resolution = await resolveSessionInvocation(
    input.db,
    input.runStart.sessionId,
    input.registry,
    input.request,
    input.attachments
  );
  if (resolution.hostAction) {
    if (resolution.hostAction.locus === 'client') {
      sendInvocationResolution(
        input.client,
        input.runStart.clientRequestId,
        input.runStart.sessionId,
        { type: 'client-action', actionId: resolution.hostAction.clientActionId }
      );
      return;
    }
    const result = await hostActionRegistry.execute(resolution.hostAction.name, input.request, {
      sessionId: input.runStart.sessionId,
      arguments: input.request.arguments,
    });
    sendInvocationResolution(
      input.client,
      input.runStart.clientRequestId,
      input.runStart.sessionId,
      result
    );
    return;
  }
  if (!resolution.turnInput) {
    throw new InvocationError('INVOCATION_UNSUPPORTED', 'Invocation produced no runtime turn.');
  }

  const previousMetadata = input.runStart.userMessageMetadata;
  const metadata =
    previousMetadata && typeof previousMetadata === 'object' && !Array.isArray(previousMetadata)
      ? (previousMetadata as Record<string, unknown>)
      : {};
  await input.ctx.handleRunStart(
    input.client,
    {
      ...input.runStart,
      input:
        input.attachments && input.attachments.length > 0
          ? JSON.stringify({ text: resolution.transcriptText, attachments: input.attachments })
          : resolution.transcriptText,
      userMessageMetadata: { ...metadata, invocation: resolution.metadata },
      runtimeTurnInput: resolution.turnInput,
    } satisfies InternalRunStart,
    input.db,
    {},
    input.clients
  );
}

function runtimeTypeForSession(db: import('better-sqlite3').Database, sessionId: string): string {
  const row = db
    .prepare(
      `SELECT COALESCE(srb.runtime_type, ap.runtime_type) AS rt FROM sessions s
       JOIN agent_profiles ap ON ap.id = s.agent_profile_id
       LEFT JOIN session_runtime_bindings srb ON srb.session_id = s.id
       WHERE s.id = ?`
    )
    .get(sessionId) as { rt?: string } | undefined;
  return row?.rt ?? 'pi';
}

function extractReservedName(text: string): string {
  const token = text.split(/\s/, 1)[0] ?? text;
  return token.includes(':') ? token.slice(token.indexOf(':') + 1) : token;
}

function sendInvocationResolution(
  client: ConnectedClient,
  clientRequestId: string,
  sessionId: string,
  result: import('@zclaudia/shared/wire/messages').InvocationResultMessage['result']
): void {
  sendMessage(client.ws, {
    type: 'invocation_result',
    clientRequestId,
    sessionId,
    result,
  } as never);
}

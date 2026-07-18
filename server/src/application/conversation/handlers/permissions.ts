import type {
  PermissionDecisionMessage,
  PromptAnswerMessage,
  PluginPermissionResponseMessage,
  ServerMessage,
} from '@zclaudia/shared/wire/messages';
import type {
  InteractionResponseMessage,
  InteractionResolvedMessage,
} from '@zclaudia/shared/interaction/forms';
import type { ConnectedClient, ActiveRun } from '../transport/types.js';
import {
  handlePermissionDecision,
  handlePromptAnswer,
} from '../interactions/permission-handler.js';
import { interactionDispatcher } from '../interactions/interaction-dispatcher.js';
import { permissionManager as pluginPermissionManager } from '../../../application/plugins/index.js';
import { broadcastRunMessage } from '../transport/broadcast.js';
import type { PermissionBridge } from '../agent/permission-bridge.js';

export function handlePermission(
  message: PermissionDecisionMessage,
  activeRuns: Map<string, ActiveRun>,
  connectedClients: Map<string, ConnectedClient>,
  permissionBridge?: PermissionBridge,
  cancelWorkflowRun?: (runId: string) => void
): void {
  handlePermissionDecision(
    message,
    activeRuns,
    connectedClients,
    permissionBridge,
    cancelWorkflowRun
  );
}

export function handlePromptAnswerMessage(
  message: PromptAnswerMessage,
  activeRuns: Map<string, ActiveRun>,
  connectedClients: Map<string, ConnectedClient>
): void {
  handlePromptAnswer(message, activeRuns, connectedClients);
}

export function handleInteractionResponse(
  message: InteractionResponseMessage,
  activeRuns: Map<string, ActiveRun>,
  clients: Map<string, ConnectedClient>
): void {
  const resolved = interactionDispatcher.resolve(message.interactionId, message.response);
  if (!resolved) {
    // Unknown interaction (timed out, cancelled, or answered elsewhere): still
    // broadcast so every client retires the zombie card instead of keeping
    // live-looking buttons.
    console.warn(`[InteractionResponse] No pending interaction for ${message.interactionId}`);
  }
  for (const [, run] of activeRuns) {
    if (run.sessionId === message.sessionId) {
      const resolvedEvent: InteractionResolvedMessage = {
        type: 'interaction_resolved',
        interactionId: message.interactionId,
        sessionId: message.sessionId,
        ...(resolved ? {} : { reason: 'stale' as const }),
      };
      broadcastRunMessage(run, resolvedEvent);
      break;
    }
  }
}

export function handlePluginPermissionResponse(
  message: PluginPermissionResponseMessage,
  broadcastPluginState: () => void
): void {
  const { pluginId, granted, permanently } = message;
  pluginPermissionManager.respondToRequest(pluginId, granted, permanently);
  broadcastPluginState();
}

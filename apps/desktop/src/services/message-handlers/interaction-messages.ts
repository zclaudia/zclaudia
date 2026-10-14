import type { ServerMessage } from '@zclaudia/shared/wire/messages/index';
import type { MessageHandlerContext } from './types';
import { useInteractionStore } from '../../stores/interactionStore';
import { useProcessMonitorStore } from '../../stores/processMonitorStore';
import { usePromptRequestStore } from '../../stores/promptRequestStore';
import { useRunStore } from '../../stores/runStore';
import { resolveOwnerBackendId } from './interaction-owner';

export function handleInteractionMessage(msg: ServerMessage, ctx: MessageHandlerContext): boolean {
  const activeRunIds = ctx.serverRunsRef.get(ctx.serverId) ?? new Set<string>();
  const runId =
    'sessionId' in msg && msg.sessionId
      ? Array.from(activeRunIds).find(
          candidate => useRunStore.getState().activeRuns[candidate] === msg.sessionId
        )
      : undefined;
  const owner = { serverId: resolveOwnerBackendId(ctx.backendId, ctx.serverId), runId };

  switch (msg.type) {
    case 'interaction_prompt':
      if (msg.source === 'provider_native') {
        usePromptRequestStore.getState().setPendingRequest({
          requestId: msg.interactionId,
          sessionId: msg.sessionId,
          serverId: ctx.serverId,
        });
      }
      useInteractionStore.getState().upsertInteraction(msg);
      return true;

    case 'interaction_approval':
    case 'interaction_todo_update':
    case 'interaction_plan_review':
      if (msg.type === 'interaction_approval') {
        useInteractionStore.getState().upsertInteraction(msg, owner);
      } else {
        useInteractionStore.getState().upsertInteraction(msg);
      }
      return true;

    case 'interaction_resolved':
      usePromptRequestStore.getState().clearRequestById(msg.interactionId);
      if (msg.reason === 'timeout' || msg.reason === 'cancelled' || msg.reason === 'stale') {
        // Nobody can answer this interaction anymore: keep the card but render
        // it as expired instead of leaving live-looking buttons behind.
        useInteractionStore.getState().markExpired(msg.interactionId, msg.reason);
      } else {
        // User responded, or a newer interaction superseded this one.
        useInteractionStore.getState().resolveInteraction(msg.interactionId);
      }
      return true;

    case 'process_cleanup_result':
      useProcessMonitorStore.getState().setCleanupResult(msg);
      return true;

    default:
      return false;
  }
}

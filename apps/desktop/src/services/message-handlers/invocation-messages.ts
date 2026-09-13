import type { ServerMessage } from '@zclaudia/shared';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { invocableCatalogKey, useInvocableCatalogStore } from '../../stores/invocableCatalogStore';
import { dispatchClientActionFromWire } from '../../features/chat/clientActions';
import type { MessageHandlerContext } from './types';

/**
 * URIP catalog/invocation server messages (§15.3, §12.4):
 * - `invocable_catalog_changed`: drop the session's cached snapshot so the
 *   hook refetches once per revision from the executing backend.
 * - `invocation_result`: `text` / `completed` render into the transcript;
 *   `client-action` dispatches through the fixed client action table.
 */
export function handleInvocationMessage(msg: ServerMessage, ctx: MessageHandlerContext): boolean {
  if (msg.type === 'invocable_catalog_changed') {
    const message = msg as Extract<ServerMessage, { type: 'invocable_catalog_changed' }>;
    // The store is keyed by backend+session; drop the direct-backend entry for
    // this session so the hook refetches once per revision.
    const { removeEntry } = useInvocableCatalogStore.getState();
    removeEntry(invocableCatalogKey(ctx.backendId, message.sessionId));
    return true;
  }
  if (msg.type !== 'invocation_result') return false;
  const message = msg as Extract<ServerMessage, { type: 'invocation_result' }>;
  const store = useChatMessageStore.getState();

  const addSystem = (content: string, metadata?: Record<string, unknown>) => {
    store.addMessage(message.sessionId, {
      id: crypto.randomUUID(),
      sessionId: message.sessionId,
      role: 'system',
      content,
      metadata,
      createdAt: Date.now(),
    });
  };

  switch (message.result.type) {
    case 'text':
      addSystem(message.result.content);
      break;
    case 'completed':
      addSystem(message.result.message ?? 'Command executed.');
      break;
    case 'client-action': {
      const actionId = message.result.actionId;
      void dispatchClientActionFromWire(actionId, message.sessionId).then(handled => {
        if (!handled) {
          console.warn(`[${ctx.logTag}] No client action registered for "${actionId}"`);
        }
      });
      break;
    }
  }
  return true;
}

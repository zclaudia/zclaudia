import type { ServerMessage } from '@zclaudia/shared';
import { useBackgroundRequestStore } from '../../stores/backgroundRequestStore';
import { useToastStore } from '../../stores/toastStore';
import type { MessageHandlerContext } from './types';

/**
 * Error codes answering a "Send to background" gesture. The card's button is
 * locked while the request is in flight, so a failure must both tell the
 * user and release the lock — a silent console line would leave them staring
 * at a stuck control.
 */
const BACKGROUND_CONVERSION_ERRORS: Record<string, string> = {
  NO_INFLIGHT_COMMAND: 'Command could not be moved to the background',
  BACKGROUND_UNSUPPORTED: 'This runtime cannot move commands to the background',
};

export function handleErrorMessage(msg: ServerMessage, ctx: MessageHandlerContext): boolean {
  if (msg.type !== 'error') return false;
  console.error(`[${ctx.logTag}] Server error:`, msg.message);
  const title = BACKGROUND_CONVERSION_ERRORS[msg.code];
  if (title) {
    useBackgroundRequestStore.getState().clearAll();
    useToastStore.getState().add({ type: 'error', title, message: msg.message, icon: 'error' });
  }
  return true;
}

import type { ServerMessage } from '@zclaudia/shared';
import { useBrowserStore } from './browserStore';

export function handleBrowserMessage(msg: ServerMessage): boolean {
  const store = useBrowserStore.getState();
  switch (msg.type) {
    case 'browser_opened':
      store.patchSession(msg.sessionId, { state: msg.state, closedReason: null, error: null });
      return true;
    case 'browser_state':
      store.patchSession(msg.sessionId, { state: msg.state });
      return true;
    case 'browser_frame':
      store.patchSession(msg.sessionId, {
        frame: { data: msg.data, deviceWidth: msg.metadata.deviceWidth, deviceHeight: msg.metadata.deviceHeight },
      });
      return true;
    case 'browser_closed':
      store.patchSession(msg.sessionId, { closedReason: msg.reason, frame: null });
      return true;
    case 'browser_error':
      if (msg.sessionId) store.patchSession(msg.sessionId, { error: msg.message });
      return true;
    case 'browser_engine_status':
      store.setEngine({ status: msg.status, progress: msg.progress, message: msg.message });
      return true;
    case 'browser_agent_activity':
      store.patchSession(msg.sessionId, { agentActive: msg.active });
      return true;
    default:
      return false;
  }
}

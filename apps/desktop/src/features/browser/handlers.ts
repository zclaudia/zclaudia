import type { ServerMessage } from '@zclaudia/shared';
import { useBrowserStore } from './browserStore';
import { openToolInWorkspace } from '../../utils/workspaceActions';
import { isPanelAvailable } from '../../utils/openPanel';
import { useSelectionStore } from '../../stores/selectionStore';
import { useRightWorkspaceStore, findPaneWithTool } from '../../stores/rightWorkspaceStore';

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
    case 'browser_emulation':
      store.patchSession(msg.sessionId, { emulation: msg.emulation });
      return true;
    case 'browser_console': {
      const prev = useBrowserStore.getState().sessions[msg.sessionId]?.console ?? [];
      const next = msg.replace ? msg.entries : [...prev, ...msg.entries];
      // Mirror the server's ring-buffer cap so a chatty page can't grow the store unbounded.
      store.patchSession(msg.sessionId, { console: next.slice(-500) });
      return true;
    }
    case 'browser_agent_activity': {
      store.patchSession(msg.sessionId, { agentActive: msg.active });
      // Auto-open only for the session the user is currently looking at, and
      // only if the browser tool isn't already open there — otherwise a
      // background agent's activity would steal focus/expand the sidebar for
      // an unrelated session, or re-focus a tab the user just switched away
      // from mid-task.
      const isSelectedSession = useSelectionStore.getState().selectedSessionId === msg.sessionId;
      if (msg.active && isPanelAvailable('browser') && isSelectedSession) {
        const root = useRightWorkspaceStore.getState().bySession[msg.sessionId]?.root ?? null;
        const alreadyOpen = findPaneWithTool(root, 'browser', undefined, true) !== null;
        if (!alreadyOpen) {
          openToolInWorkspace(msg.sessionId, 'browser');
        }
      }
      return true;
    }
    default:
      return false;
  }
}

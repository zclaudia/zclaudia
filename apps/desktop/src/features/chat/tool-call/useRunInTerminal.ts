import { useCallback } from 'react';
import { useConnection } from '../../../contexts/ConnectionContext';
import { useServerStore } from '../../../stores/serverStore';
import { useSelectionStore } from '../../../stores/selectionStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useTerminalStore } from '../../../stores/terminalStore';
import { activatePanel } from '../../../actions/openPanel';
import { useChatActionsOptional } from '../ChatActionsContext';
import { useSessionRoute } from '../hooks/useSessionRoute';
import { openToolInWorkspace } from '../../../actions/workspaceActions';

/**
 * Host capability: paste a command into the project's remote terminal.
 *
 * Returns undefined when the chat's backend has no remote terminal, so pure
 * transcript components can gate the affordance on prop presence instead of
 * reaching into stores. This is the store-touching half of what used to live
 * inside RunInTerminalButton.
 */
export function useRunInTerminal(): ((command: string) => void) | undefined {
  const { sendMessage, sendToServer } = useConnection();
  const chatSessionId = useChatActionsOptional()?.sessionId;
  const sessionId = useSelectionStore(s => chatSessionId ?? s.selectedSessionId);
  const route = useSessionRoute(sessionId);
  const activeBackendId = useServerStore(s => s.activeServerId);
  const backendId = route.backendId ?? activeBackendId;
  const backendFeatures = useServerStore(s => backendId ? s.connections?.[backendId]?.features : undefined);
  const hasTerminal = backendFeatures
    ? backendFeatures.includes('remoteTerminal')
    : backendId && backendId !== activeBackendId
      ? false
      : useServerStore.getState().activeServerSupports('remoteTerminal');
  const run = useCallback(
    (command: string) => {
      void (async () => {
        const selectedSessionId = sessionId;
        const { sessions } = useProjectStore.getState();
        const session = sessions.find(s => s.id === selectedSessionId);
        if (!session?.projectId) return;

        const store = useTerminalStore.getState();
        const getTerminalId = () => backendId
          ? useTerminalStore.getState().getTerminalId(session.projectId, backendId)
          : useTerminalStore.getState().getTerminalId(session.projectId);
        if (!getTerminalId()) {
          if (backendId) store.openTerminal(session.projectId, backendId);
          else store.openTerminal(session.projectId);
        }
        if (backendId) store.setDrawerOpen(session.projectId, true, backendId);
        else store.setDrawerOpen(session.projectId, true);
        if (chatSessionId) openToolInWorkspace(chatSessionId, 'terminal', { projectId: session.projectId, backendId });
        else activatePanel('terminal');

        const terminalId = getTerminalId();
        if (terminalId) {
          await useTerminalStore.getState().waitForReady(terminalId);
          const message = { type: 'terminal_input' as const, terminalId, data: command };
          if (backendId) sendToServer(backendId, message);
          else sendMessage(message);
        }
      })();
    },
    [chatSessionId, sessionId, backendId, sendMessage, sendToServer]
  );
  return hasTerminal ? run : undefined;
}

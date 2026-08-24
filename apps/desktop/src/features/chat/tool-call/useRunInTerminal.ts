import { useCallback } from 'react';
import { useConnection } from '../../../contexts/ConnectionContext';
import { useServerStore } from '../../../stores/serverStore';
import { useSelectionStore } from '../../../stores/selectionStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useTerminalStore } from '../../../stores/terminalStore';
import { activatePanel } from '../../../utils/openPanel';

/**
 * Host capability: paste a command into the project's remote terminal.
 *
 * Returns undefined when the active server has no remote terminal, so pure
 * transcript components can gate the affordance on prop presence instead of
 * reaching into stores. This is the store-touching half of what used to live
 * inside RunInTerminalButton.
 */
export function useRunInTerminal(): ((command: string) => void) | undefined {
  const { sendMessage } = useConnection();
  const run = useCallback(
    (command: string) => {
      void (async () => {
        const { selectedSessionId } = useSelectionStore.getState();
        const { sessions } = useProjectStore.getState();
        const session = sessions.find(s => s.id === selectedSessionId);
        if (!session?.projectId) return;

        const store = useTerminalStore.getState();
        if (!store.getTerminalId(session.projectId)) {
          store.openTerminal(session.projectId);
        }
        store.setDrawerOpen(session.projectId, true);
        activatePanel('terminal');

        const terminalId = useTerminalStore.getState().getTerminalId(session.projectId);
        if (terminalId) {
          await useTerminalStore.getState().waitForReady(terminalId);
          sendMessage({ type: 'terminal_input', terminalId, data: command });
        }
      })();
    },
    [sendMessage]
  );
  const hasTerminal = useServerStore.getState().activeServerSupports('remoteTerminal');
  return hasTerminal ? run : undefined;
}

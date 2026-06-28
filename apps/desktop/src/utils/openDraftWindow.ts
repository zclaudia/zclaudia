import { openPopoutWindow, buildWindowTitle, getConnectionParams } from './popoutWindow';
import { useOwnershipStore } from '../stores/ownershipStore';

/** Open the current session's draft in a standalone pop-out window. */
export async function openDraftInNewWindow(sessionId: string): Promise<string> {
  const backendId = useOwnershipStore.getState().getSessionBackendId(sessionId);
  const conn = getConnectionParams({ backendId });
  return openPopoutWindow({
    type: 'draft',
    params: { draftWindow: sessionId },
    title: buildWindowTitle('Draft', conn.serverName),
    width: 720,
    height: 640,
    connectionTarget: { backendId },
  });
}

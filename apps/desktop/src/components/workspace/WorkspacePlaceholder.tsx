import { useContext, useState } from 'react';
import type { PlaceholderNode } from '../../stores/rightWorkspaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { fillChatSlot, fillToolSlot } from '../../actions/layoutPresetActions';
import { useLauncherPanels } from '../../actions/openPanel';
import { Button } from '../ui/Button';
import { WorkspaceNavigationContext } from './WorkspaceContext';

export function WorkspacePlaceholder({
  node,
  projectId,
}: {
  node: PlaceholderNode;
  projectId: string;
}) {
  const { syncSelection = true } = useContext(WorkspaceNavigationContext);
  const catalog = useProjectStore(s => s.sessions);
  const sessions = catalog.filter(
    session => session.projectId === projectId && !session.archivedAt
  );
  const activeServerId = useServerStore(s => s.activeServerId);
  const ownerBackendId = useOwnershipStore(s => s.getProjectBackendId(projectId));
  const backendId = ownerBackendId ?? activeServerId;
  const panels = useLauncherPanels('desktop', backendId);
  const [error, setError] = useState('');
  const chat = node.accepts === 'chat';
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-auto p-3">
      <p className="text-sm text-muted-foreground">{chat ? 'Select a session' : 'Open a tool'}</p>
      {chat
        ? sessions.map(session => (
            <Button
              key={session.id}
              variant="outline"
              onClick={() => {
                const result = fillChatSlot(projectId, node.id, session.id);
                if (result.ok && syncSelection)
                  useProjectStore.getState().selectSession(session.id, projectId);
                else if (!result.ok) setError('Unable to fill this slot');
              }}
            >
              {session.name || session.autoTitle || 'Untitled Session'}
            </Button>
          ))
        : panels
            .filter(panel => node.accepts === 'tool:*' || node.accepts === `tool:${panel.id}`)
            .map(panel => (
              <Button
                key={panel.id}
                variant="outline"
                onClick={() => {
                  if (!fillToolSlot(projectId, node.id, panel.id, { projectId, backendId }).ok)
                    setError('Unable to open this tool');
                }}
              >
                {panel.label}
              </Button>
            ))}
      {chat && sessions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Create a session from the sidebar to open it here.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

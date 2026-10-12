import { Pin } from 'lucide-react';
import { useProjectWorkspaceStore, workspaceRefKey } from '../../stores/projectWorkspaceStore';
import {
  flattenPanes,
  useRightWorkspaceStore,
  type ToolRef,
} from '../../stores/rightWorkspaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { DropdownMenu } from '../ui/DropdownMenu';
import { Button } from '../ui/Button';

export function ToolBindingMenu({ projectId, tool }: { projectId: string; tool: ToolRef }) {
  const project = useProjectWorkspaceStore(s => s.byProject[projectId]);
  const root = useRightWorkspaceStore(s =>
    project ? (s.bySession[project.workspaceId]?.root ?? null) : null
  );
  const sessions = useProjectStore(s => s.sessions);
  const binding = project?.toolBindings[workspaceRefKey(tool)];
  const boundId = binding?.mode === 'fixed' ? binding.sessionId : project?.focusedChatSessionId;
  const bound = sessions.find(s => s.id === boundId);
  const label = bound?.name || bound?.autoTitle || 'chat';
  const chatIds = [
    ...new Set(
      flattenPanes(root)
        .flatMap(p => p.tools.filter(t => t.toolId === 'chat').map(t => t.instanceKey))
        .filter((id): id is string => !!id)
    ),
  ];
  return (
    <DropdownMenu
      ariaLabel="Tool chat binding"
      align="end"
      entries={[
        {
          key: 'follow',
          label: 'Follow focused chat',
          onSelect: () =>
            useProjectWorkspaceStore.getState().setToolBinding(projectId, tool, { mode: 'follow' }),
        },
        ...chatIds.map(id => ({
          key: id,
          label: `Pin to ${sessions.find(s => s.id === id)?.name || sessions.find(s => s.id === id)?.autoTitle || 'Untitled Session'}`,
          onSelect: () =>
            useProjectWorkspaceStore
              .getState()
              .setToolBinding(projectId, tool, { mode: 'fixed', sessionId: id }),
        })),
      ]}
      trigger={({ ref, props }) => (
        <Button
          ref={ref}
          {...props}
          size="sm"
          className="max-w-36 min-w-0 shrink-0 text-3xs"
          aria-label={`Tool ${binding?.mode === 'fixed' ? 'pinned to' : 'follows'} ${label}`}
        >
          {binding?.mode === 'fixed' && <Pin size={11} />}
          <span className="truncate">
            {binding?.mode === 'fixed' ? 'pinned' : 'follows'} {label}
          </span>
        </Button>
      )}
    />
  );
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatTabs } from '../ChatTabs';
import { useProjectStore } from '../../../stores/projectStore';
import { useRightWorkspaceStore, flattenPanes, type PaneNode } from '../../../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../../../stores/projectWorkspaceStore';
import { openSessionTab, resolveProjectWorkspace } from '../../../actions/projectWorkspaceActions';
import { useDragSplitStore } from '../dragSplit';

const { selectSession } = vi.hoisted(() => ({ selectSession: vi.fn() }));
vi.mock('../../../hooks/useSelectionCoordinator', () => ({ useSelectionCoordinator: () => ({ selectSession }) }));

function currentPane(): PaneNode {
  return flattenPanes(useRightWorkspaceStore.getState().bySession['chat-1'].root).find(p => p.tools.some(ref => ref.toolId === 'chat'))!;
}

describe('ChatTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectWorkspaceStore.setState({ byProject: {} });
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    useDragSplitStore.getState().endDrag();
    useProjectStore.setState({ sessions: [
      { id: 'chat-1', projectId: 'project', name: 'Main' },
      { id: 'chat-2', projectId: 'project', autoTitle: 'Watcher' },
      { id: 'chat-3', projectId: 'project', name: 'Review' },
      { id: 'foreign', projectId: 'foreign-project', name: 'Foreign' },
    ] as any });
    resolveProjectWorkspace('project', ['chat-1', 'chat-2', 'chat-3'], 'chat-1');
    openSessionTab('project', 'chat-2');
  });

  it('activates the selected tab and supplies complete chat drag identity', () => {
    render(<ChatTabs workspaceId="chat-1" projectId="project" pane={currentPane()} />);
    const tab = screen.getByRole('tab', { name: 'Main' });
    fireEvent.click(tab);
    expect(useProjectWorkspaceStore.getState().byProject.project.focusedChatSessionId).toBe('chat-1');
    expect(currentPane().activeInstanceKey).toBe('chat-1');
    expect(selectSession).toHaveBeenCalledWith('chat-1');
    fireEvent.pointerDown(tab, { buttons: 1, pointerType: 'mouse' });
    expect(useDragSplitStore.getState().active).toMatchObject({ toolId: 'chat', instanceKey: 'chat-1', multiInstance: true, sourcePaneId: currentPane().id });
  });

  it('adds only same-project sessions and focuses an existing ref without duplication', () => {
    const { rerender } = render(<ChatTabs workspaceId="chat-1" projectId="project" pane={currentPane()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add chat' }));
    expect(screen.queryByRole('menuitem', { name: 'Foreign' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Review' }));
    expect(currentPane().tools).toHaveLength(3);
    rerender(<ChatTabs workspaceId="chat-1" projectId="project" pane={currentPane()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add chat' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Main' }));
    expect(currentPane().tools).toHaveLength(3);
    expect(selectSession).toHaveBeenLastCalledWith('chat-1');
  });

  it('closes an active tab while preserving the final chat', () => {
    const { rerender } = render(<ChatTabs workspaceId="chat-1" projectId="project" pane={currentPane()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close Watcher' }));
    expect(currentPane().tools).toHaveLength(1);
    expect(selectSession).toHaveBeenCalledWith('chat-1');
    rerender(<ChatTabs workspaceId="chat-1" projectId="project" pane={currentPane()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close Main' }));
    expect(currentPane().tools).toHaveLength(1);
  });
});

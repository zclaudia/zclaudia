import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceToolProvider, useWorkspaceTool } from '../WorkspaceToolContext';
import { useWorkspaceVisible } from '../WorkspaceContext';

const { draft, viewer } = vi.hoisted(() => ({
  draft: { activeSessionId: 'old-session', openEditor: vi.fn() },
  viewer: { isOpen: true, projectRoot: '/old-worktree', close: vi.fn() },
}));
vi.mock('../../../stores/draftEditorStore', () => ({ useDraftEditorStore: { getState: () => draft } }));
vi.mock('../../../stores/fileViewerStore', () => ({ useFileViewerStore: { getState: () => viewer } }));

function Consumer() {
  const tool = useWorkspaceTool();
  const visible = useWorkspaceVisible();
  return <div>{`${tool?.sessionId}:${tool?.projectRoot}:${visible}`}</div>;
}

describe('WorkspaceToolProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes the bound worktree and delays singleton draft changes until visible', () => {
    const { rerender } = render(
      <WorkspaceToolProvider sessionId="fixed-chat" projectRoot="/fixed-worktree" toolId="draft" visible={false}>
        <Consumer />
      </WorkspaceToolProvider>
    );
    expect(screen.getByText('fixed-chat:/fixed-worktree:false')).toBeInTheDocument();
    expect(draft.openEditor).not.toHaveBeenCalled();
    rerender(
      <WorkspaceToolProvider sessionId="fixed-chat" projectRoot="/fixed-worktree" toolId="draft" visible>
        <Consumer />
      </WorkspaceToolProvider>
    );
    expect(draft.openEditor).toHaveBeenCalledWith('fixed-chat');
    expect(viewer.close).not.toHaveBeenCalled();
  });

  it('resets a singleton file viewer only for its visible bound worktree', () => {
    const { rerender } = render(
      <WorkspaceToolProvider sessionId="new-chat" projectRoot="/new-worktree" toolId="file-viewer" visible={false}>
        <Consumer />
      </WorkspaceToolProvider>
    );
    expect(viewer.close).not.toHaveBeenCalled();
    rerender(
      <WorkspaceToolProvider sessionId="new-chat" projectRoot="/new-worktree" toolId="file-viewer" visible>
        <Consumer />
      </WorkspaceToolProvider>
    );
    expect(viewer.close).toHaveBeenCalledOnce();
    expect(draft.openEditor).not.toHaveBeenCalled();
  });
});

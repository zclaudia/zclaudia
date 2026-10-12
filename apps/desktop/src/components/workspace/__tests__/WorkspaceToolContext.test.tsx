import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceToolProvider, useWorkspaceTool } from '../WorkspaceToolContext';
import { useWorkspaceVisible } from '../WorkspaceContext';

const { draft, viewer } = vi.hoisted(() => ({
  draft: { activeSessionId: 'old-session', openEditor: vi.fn(), closeEditor: vi.fn() },
  viewer: {
    isOpen: true,
    projectRoot: '/old-worktree',
    backendId: null as string | null,
    filePath: null as string | null,
    close: vi.fn(),
    backToTree: vi.fn(),
    openFile: vi.fn(),
  },
}));
vi.mock('../../../stores/draftEditorStore', () => ({
  useDraftEditorStore: { getState: () => draft },
}));
vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: { getState: () => viewer, setState: vi.fn() },
}));

function Consumer() {
  const tool = useWorkspaceTool();
  const visible = useWorkspaceVisible();
  return <div>{`${tool?.sessionId}:${tool?.projectRoot}:${visible}`}</div>;
}

describe('WorkspaceToolProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewer.projectRoot = '/old-worktree';
    viewer.backendId = null;
    viewer.filePath = null;
  });

  it('closes the stale singleton instead of opening an empty chat binding', () => {
    render(
      <WorkspaceToolProvider sessionId="" projectId="project" toolId="draft" visible>
        <Consumer />
      </WorkspaceToolProvider>
    );
    expect(draft.openEditor).not.toHaveBeenCalled();
    expect(draft.closeEditor).toHaveBeenCalledOnce();
  });

  it('clears old backend content when a binding follows a different server with the same root', () => {
    viewer.projectRoot = '/shared-path';
    viewer.backendId = 'backend-A';
    viewer.filePath = 'same.ts';
    render(
      <WorkspaceToolProvider
        sessionId="B"
        projectRoot="/shared-path"
        backendId="backend-B"
        toolId="file-viewer"
        visible
      >
        <Consumer />
      </WorkspaceToolProvider>
    );
    expect(viewer.backToTree).toHaveBeenCalledOnce();
    expect(viewer.openFile).not.toHaveBeenCalled();
  });

  it('exposes the bound worktree and delays singleton draft changes until visible', () => {
    const { rerender } = render(
      <WorkspaceToolProvider
        sessionId="fixed-chat"
        projectRoot="/fixed-worktree"
        toolId="draft"
        visible={false}
      >
        <Consumer />
      </WorkspaceToolProvider>
    );
    expect(screen.getByText('fixed-chat:/fixed-worktree:false')).toBeInTheDocument();
    expect(draft.openEditor).not.toHaveBeenCalled();
    rerender(
      <WorkspaceToolProvider
        sessionId="fixed-chat"
        projectRoot="/fixed-worktree"
        toolId="draft"
        visible
      >
        <Consumer />
      </WorkspaceToolProvider>
    );
    expect(draft.openEditor).toHaveBeenCalledWith('fixed-chat');
    expect(viewer.close).not.toHaveBeenCalled();
  });

  it('resets a singleton file viewer only for its visible bound worktree', () => {
    const { rerender } = render(
      <WorkspaceToolProvider
        sessionId="new-chat"
        projectRoot="/new-worktree"
        toolId="file-viewer"
        visible={false}
      >
        <Consumer />
      </WorkspaceToolProvider>
    );
    expect(viewer.close).not.toHaveBeenCalled();
    rerender(
      <WorkspaceToolProvider
        sessionId="new-chat"
        projectRoot="/new-worktree"
        toolId="file-viewer"
        visible
      >
        <Consumer />
      </WorkspaceToolProvider>
    );
    expect(viewer.close).toHaveBeenCalledOnce();
    expect(draft.openEditor).not.toHaveBeenCalled();
  });
});

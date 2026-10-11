import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangesPanel } from '../ChangesPanel';
import { WorkspaceToolContext } from '../../../components/workspace/WorkspaceToolContext';
import { useSelectionStore } from '../../../stores/selectionStore';

const { data } = vi.hoisted(() => ({ data: vi.fn() }));
vi.mock('../../../components/changes/useSessionChanges', () => ({
  useChangesData: data,
  useUserMessageOptions: () => [],
  isTurnEmpty: () => true,
}));
vi.mock('../../../components/changes/SinceSelector', () => ({ SinceSelector: () => <span>Since</span> }));
vi.mock('../SummarySection', () => ({ SummarySection: () => null }));

describe('ChangesPanel binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    data.mockReturnValue({ result: { modified: [], affected: [], turns: [] } });
    useSelectionStore.setState({ selectedSessionId: 'selected-chat' });
  });

  it('reads changes from its fixed chat worktree even when another chat is selected', () => {
    render(
      <WorkspaceToolContext.Provider value={{ sessionId: 'fixed-chat', projectRoot: '/fixed-worktree' }}>
        <ChangesPanel projectRoot="/fixed-worktree" />
      </WorkspaceToolContext.Provider>
    );
    expect(data).toHaveBeenCalledWith('fixed-chat', undefined, '/fixed-worktree');
    expect(screen.getByText('No file changes in this session')).toBeInTheDocument();
  });

  it('retains the selected-session fallback outside workspace tool hosts', () => {
    render(<ChangesPanel projectRoot="/selected-worktree" />);
    expect(data).toHaveBeenCalledWith('selected-chat', undefined, '/selected-worktree');
  });
});

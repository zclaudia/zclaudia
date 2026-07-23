import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GitWorktreeStatus, GitCommit, SlashCommand } from '@zclaudia/shared';
import { useGitStore } from '../../git/store';
import { EmptySessionSnapshot, EmptySessionChips } from '../EmptySessionOverview';

vi.mock('../../../services/api', () => ({
  getWorktreeStatus: vi.fn(() => new Promise(() => {})),
  getGitLog: vi.fn(() => new Promise(() => {})),
}));

const PROJECT_ID = 'p1';
const WT = '/repo';

const dirtyStatus: GitWorktreeStatus = {
  clean: false,
  staged: ['a.ts'],
  unstaged: ['a.ts', 'b.ts'],
  untracked: ['c.ts'],
  currentBranch: 'main',
  ahead: 2,
  behind: 0,
};

const cleanStatus: GitWorktreeStatus = {
  clean: true,
  staged: [],
  unstaged: [],
  untracked: [],
  currentBranch: 'main',
  ahead: 0,
  behind: 0,
};

const commit: GitCommit = {
  sha: 'be5cc81d000000',
  shortSha: 'be5cc81d',
  message: 'refactor(sidebar): drop redundant DirectoryPicker portal',
  author: 'zhvala',
  date: 1751600000000,
};

function seedGit(status?: GitWorktreeStatus, log?: GitCommit[]) {
  const s = useGitStore.getState();
  if (status) s.setStatus(PROJECT_ID, WT, status);
  if (log) s.setLog(PROJECT_ID, WT, log);
}

beforeEach(() => {
  useGitStore.setState({ statusByPath: {}, logByPath: {} });
});

describe('EmptySessionSnapshot', () => {
  it('renders project name, branch, ahead marker, change count, and latest commit', () => {
    seedGit(dirtyStatus, [commit]);
    render(
      <EmptySessionSnapshot projectId={PROJECT_ID} projectName="zclaudia" worktreePath={WT} />
    );
    expect(screen.getByText('zclaudia')).toBeInTheDocument();
    expect(screen.getByText(/main/)).toBeInTheDocument();
    expect(screen.getByText(/↑2/)).toBeInTheDocument();
    // union of staged/unstaged/untracked = a.ts, b.ts, c.ts = 3
    expect(screen.getByText(/3 uncommitted changes/)).toBeInTheDocument();
    expect(screen.getByText('be5cc81d')).toBeInTheDocument();
    expect(screen.getByText(/drop redundant DirectoryPicker portal/)).toBeInTheDocument();
  });

  it('shows "Working tree clean" and no ahead/behind markers when clean', () => {
    seedGit(cleanStatus, [commit]);
    render(
      <EmptySessionSnapshot projectId={PROJECT_ID} projectName="zclaudia" worktreePath={WT} />
    );
    expect(screen.getByText(/Working tree clean/)).toBeInTheDocument();
    expect(screen.queryByText(/↑/)).not.toBeInTheDocument();
    expect(screen.queryByText(/↓/)).not.toBeInTheDocument();
  });

  it('renders nothing while git status is unavailable', () => {
    const { container } = render(
      <EmptySessionSnapshot projectId={PROJECT_ID} projectName="zclaudia" worktreePath={WT} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders status line without commit segment when log is empty', () => {
    seedGit(dirtyStatus, []);
    render(
      <EmptySessionSnapshot projectId={PROJECT_ID} projectName="zclaudia" worktreePath={WT} />
    );
    expect(screen.getByText(/3 uncommitted changes/)).toBeInTheDocument();
    expect(screen.queryByText('be5cc81d')).not.toBeInTheDocument();
  });

  it('uses singular "change" wording when exactly one file changed', () => {
    const oneFileStatus: GitWorktreeStatus = {
      clean: false,
      staged: ['a.ts'],
      unstaged: [],
      untracked: [],
      currentBranch: 'main',
      ahead: 0,
      behind: 0,
    };
    seedGit(oneFileStatus, []);
    render(
      <EmptySessionSnapshot projectId={PROJECT_ID} projectName="zclaudia" worktreePath={WT} />
    );
    expect(screen.getByText(/1 uncommitted change(?!s)/)).toBeInTheDocument();
  });
});

describe('EmptySessionChips', () => {
  const goalCommand: SlashCommand = {
    command: '/goal',
    description: 'Set a goal',
    source: 'local',
  };

  it('shows the review chip when dirty, and no explain fallback', () => {
    seedGit(dirtyStatus);
    render(
      <EmptySessionChips
        projectId={PROJECT_ID}
        worktreePath={WT}
        commands={[]}
        onSuggestion={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /Review uncommitted changes/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Explain this codebase/ })).not.toBeInTheDocument();
  });

  it('falls back to the explain chip when the tree is clean', () => {
    seedGit(cleanStatus);
    render(
      <EmptySessionChips
        projectId={PROJECT_ID}
        worktreePath={WT}
        commands={[]}
        onSuggestion={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /Explain this codebase/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Review uncommitted changes/ })
    ).not.toBeInTheDocument();
  });

  it('falls back to the explain chip when git info is unavailable', () => {
    render(
      <EmptySessionChips
        projectId={PROJECT_ID}
        worktreePath={WT}
        commands={[]}
        onSuggestion={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /Explain this codebase/ })).toBeInTheDocument();
  });

  it('shows the goal chip only when a /goal command exists', () => {
    seedGit(cleanStatus);
    const { rerender } = render(
      <EmptySessionChips
        projectId={PROJECT_ID}
        worktreePath={WT}
        commands={[]}
        onSuggestion={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /Set a goal/ })).not.toBeInTheDocument();
    rerender(
      <EmptySessionChips
        projectId={PROJECT_ID}
        worktreePath={WT}
        commands={[goalCommand]}
        onSuggestion={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /Set a goal/ })).toBeInTheDocument();
  });

  it('fires onSuggestion with the template on click', () => {
    seedGit(dirtyStatus);
    const onSuggestion = vi.fn();
    render(
      <EmptySessionChips
        projectId={PROJECT_ID}
        worktreePath={WT}
        commands={[goalCommand]}
        onSuggestion={onSuggestion}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Review uncommitted changes/ }));
    expect(onSuggestion).toHaveBeenCalledWith(
      'Review my uncommitted changes and point out any issues.'
    );
    fireEvent.click(screen.getByRole('button', { name: /Set a goal/ }));
    expect(onSuggestion).toHaveBeenCalledWith('/goal ');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomeView } from '../HomeView';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionsStore, LOCAL_BACKEND_KEY } from '../../../stores/sessionsStore';

const selectSessionOnBackend = vi.fn();
vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({ selectSessionOnBackend }),
}));

function seedProject(id: string, name: string) {
  useProjectStore.setState(s => ({ projects: [...s.projects, { id, name } as any] }));
}

function seedLocalSession(id: string, over: Record<string, unknown> = {}) {
  useProjectStore.setState(s => ({
    sessions: [
      ...s.sessions,
      { id, projectId: 'p1', type: 'regular', createdAt: 1, updatedAt: 1, ...over } as any,
    ],
  }));
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ projects: [], sessions: [] } as any);
    useSessionsStore.setState({
      remoteSessions: new Map(),
      activeSessionIdsByBackend: new Map(),
    } as any);
  });

  it('renders the empty state with quick actions when there are no sessions', () => {
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(screen.getByText('Welcome to ZClaudia')).toBeTruthy();
    expect(screen.getByText('Start a session or add a project to get going.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /New session/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add project/ })).toBeTruthy();
    expect(screen.queryByText('Recent')).toBeNull();
  });

  it('renders recent rows with project names and hides the Running group when idle', () => {
    seedProject('p1', 'zclaudia');
    seedLocalSession('s1', { name: 'Fix the thing', updatedAt: 100 });
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(screen.getByText('Recent')).toBeTruthy();
    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.getByText('Fix the thing')).toBeTruthy();
    expect(screen.getByText('zclaudia')).toBeTruthy();
  });

  it('pins running sessions in a Running group', () => {
    seedProject('p1', 'zclaudia');
    seedLocalSession('s1', { name: 'Busy one' });
    useSessionsStore.setState({
      activeSessionIdsByBackend: new Map([[LOCAL_BACKEND_KEY, new Set(['s1'])]]),
    } as any);
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Busy one')).toBeTruthy();
  });

  it('selects a clicked session through the coordinator with a resolved backend id', () => {
    seedProject('p1', 'zclaudia');
    seedLocalSession('s1', { name: 'Fix the thing' });
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    fireEvent.click(screen.getByText('Fix the thing'));
    expect(selectSessionOnBackend).toHaveBeenCalledTimes(1);
    expect(selectSessionOnBackend.mock.calls[0][1]).toBe('s1');
  });

  it('fires the quick-action callbacks', () => {
    const onNewSession = vi.fn();
    const onAddProject = vi.fn();
    render(<HomeView onNewSession={onNewSession} onAddProject={onAddProject} />);
    fireEvent.click(screen.getByRole('button', { name: /New session/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add project/ }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(onAddProject).toHaveBeenCalledTimes(1);
  });

  it('shows backend badges only when sessions span multiple backends', () => {
    seedProject('p1', 'zclaudia');
    seedLocalSession('s1', { name: 'Local one', updatedAt: 2 });
    // Unmount before mutating the store: the mounted view is store-subscribed
    // and would re-render alongside the second copy.
    const { unmount } = render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(screen.queryByText('Local')).toBeNull();
    unmount();

    useSessionsStore.setState({
      remoteSessions: new Map([
        [
          'remote-1',
          [
            {
              id: 's2',
              projectId: 'p1',
              type: 'regular',
              name: 'Remote one',
              createdAt: 1,
              updatedAt: 1,
              isActive: false,
            } as any,
          ],
        ],
      ]),
    } as any);
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(screen.getByText('Local')).toBeTruthy();
  });
});

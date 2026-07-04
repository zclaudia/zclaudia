import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HomeView } from '../HomeView';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionsStore, LOCAL_BACKEND_KEY } from '../../../stores/sessionsStore';
import { useOwnershipStore } from '../../../stores/ownershipStore';
import { useFacadeStore } from '../../../stores/facadeStore';

const selectSessionOnBackend = vi.fn();
vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({ selectSessionOnBackend }),
}));

vi.mock('../UsageStatsStrip', () => ({
  UsageStatsStrip: () => <div data-testid="usage-strip" />,
}));

const generateSessionTitle = vi.fn(() => Promise.resolve());
vi.mock('../../../services/api', () => ({
  generateSessionTitle: (...args: unknown[]) => generateSessionTitle(...args),
}));

function seedProject(id: string, name: string) {
  useProjectStore.setState(s => ({ projects: [...s.projects, { id, name } as any] }));
}

/** Simulate the initial REST data load having completed (useDataLoader sets this). */
function markDataLoaded() {
  useProjectStore.setState({ dataServerId: 'local' } as any);
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
    useProjectStore.setState({ projects: [], sessions: [], dataServerId: null } as any);
    useSessionsStore.setState({
      remoteSessions: new Map(),
      activeSessionIdsByBackend: new Map(),
    } as any);
    useOwnershipStore.setState({
      sessionBackendIds: {},
      sessionOwnershipVersions: {},
      projectBackendIds: {},
      taskOwners: {},
    });
    useFacadeStore.setState({ localBackendId: null } as any);
  });

  it('renders nothing before the initial data load completes', () => {
    const { container } = render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the empty state with quick actions when there are no sessions', () => {
    markDataLoaded();
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(screen.getByText('Welcome to ZClaudia')).toBeTruthy();
    expect(screen.getByText('Start a session or add a project to get going.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /New session/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add project/ })).toBeTruthy();
    expect(screen.queryByText('Recent')).toBeNull();
  });

  it('greets instead of welcoming once there is activity', () => {
    seedProject('p1', 'zclaudia');
    seedLocalSession('s1', { name: 'Fix the thing', updatedAt: 100 });
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(screen.getByText(/Good (morning|afternoon|evening)/)).toBeTruthy();
    expect(screen.queryByText('Welcome to ZClaudia')).toBeNull();
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

  it('shows a meta line with message count and project', () => {
    seedProject('p1', 'zclaudia');
    seedLocalSession('s1', { name: 'Fix the thing', lastMessageOffset: 12 });
    seedLocalSession('s2', { name: 'Sparse one', updatedAt: 0 });
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(screen.getByText('12 messages · zclaudia')).toBeTruthy();
    // No count recorded -> the segment is omitted, project only.
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
    markDataLoaded();
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
    expect(screen.queryByText(/· Local/)).toBeNull();
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
    expect(screen.getByText(/· Local$/)).toBeTruthy();
  });

  it('drops remote-owned sessions from the local list instead of mislabeling them', () => {
    seedProject('p1', 'zclaudia');
    // Genuinely local session: no ownership record.
    seedLocalSession('sl', { name: 'Local one', updatedAt: 2 });
    // Remote-owned session that also leaked into projectStore.sessions because
    // the active backend switched to remote-1 (useDataLoader reload).
    seedLocalSession('sr', { name: 'Remote one', updatedAt: 1 });
    useOwnershipStore.getState().setSessionOwners(['sr'], 'remote-1');
    useSessionsStore.setState({
      remoteSessions: new Map([
        [
          'remote-1',
          [
            {
              id: 'sr',
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

    // The remote session must appear exactly once, from its remote bucket.
    expect(screen.getAllByText('Remote one')).toHaveLength(1);
    // Rows span two backends → badges visible with the right labels.
    expect(screen.getByText(/· Local$/)).toBeTruthy();
    expect(screen.getByText(/· Backend remote-1$/)).toBeTruthy();
  });

  it('requests an auto-title for untitled sessions once a backend is resolvable', async () => {
    useFacadeStore.setState({ localBackendId: 'local' } as any);
    seedProject('p1', 'zclaudia');
    seedLocalSession('s1', { updatedAt: 100 }); // no name, no autoTitle -> "Untitled"
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    await waitFor(() => expect(generateSessionTitle).toHaveBeenCalled());
    expect(generateSessionTitle.mock.calls[0][1]).toBe('s1');
  });

  it('does not request a title for sessions that already have a name', () => {
    useFacadeStore.setState({ localBackendId: 'local' } as any);
    seedProject('p1', 'zclaudia');
    seedLocalSession('s1', { name: 'Fix the thing' });
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(generateSessionTitle).not.toHaveBeenCalled();
  });

  it('renders the usage strip only in the populated state', () => {
    markDataLoaded();
    const empty = render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(empty.container.querySelector('[data-testid="usage-strip"]')).toBeNull();
    empty.unmount();

    seedProject('p1', 'zclaudia');
    seedLocalSession('s1', { name: 'Fix the thing' });
    render(<HomeView onNewSession={vi.fn()} onAddProject={vi.fn()} />);
    expect(screen.getByTestId('usage-strip')).toBeTruthy();
  });
});

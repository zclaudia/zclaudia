// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';

import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';
import { useServerStore } from '../../../stores/serverStore';
import { useFacadeStore } from '../../../stores/facadeStore';

const { mockLoadAll, mockRefresh } = vi.hoisted(() => ({
  mockLoadAll: vi.fn().mockResolvedValue(undefined),
  mockRefresh: vi.fn().mockResolvedValue(undefined),
}));

// The stub exposes buttons wired to onSaved/onDeleted so tests can drive the
// parent's handlers without the real (network-heavy) editor.
vi.mock('../ProfileEditor', () => ({
  ProfileEditor: ({
    profile,
    onSaved,
    onDeleted,
  }: {
    profile: AgentProfileConfig | null;
    onSaved: (saved: AgentProfileConfig) => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="profile-editor" data-profile-id={profile?.id ?? 'null'}>
      <button onClick={() => onSaved(makeProfile('saved-1', 'Saved One'))}>stub-save</button>
      <button onClick={() => onDeleted()}>stub-delete</button>
    </div>
  ),
}));

vi.mock('../../../stores/agentProfileMetaStore', () => ({
  useAgentProfileMetaStore: { getState: () => ({ loadAll: mockLoadAll }) },
}));

vi.mock('../../../stores/agentReadinessStore', () => ({
  useAgentReadinessStore: { getState: () => ({ refresh: mockRefresh }) },
}));

import { AgentsContent } from '../AgentsContent';
import type { AgentsBackend, ProfilesByBackend } from '../useProfilesByBackend';

function makeProfile(id: string, name = id): AgentProfileConfig {
  return {
    id,
    name,
    llmProfileId: 'lp1',
    model: 'claude-sonnet-4-6',
    systemPrompt: '',
    enabledTools: ['read'],
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

const backends: AgentsBackend[] = [
  { backendId: 'b1', name: 'Backend 1', online: true },
  { backendId: 'b2', name: 'Backend 2', online: true },
];

function makeData(
  profilesByBackend: Record<string, AgentProfileConfig[]>,
  errors: Record<string, string> = {}
): ProfilesByBackend {
  return {
    profiles: new Map(Object.entries(profilesByBackend)),
    errors: new Map(Object.entries(errors)),
    loading: false,
  };
}

describe('AgentsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'profiles' },
      agentsSelection: null,
      agentsRefreshNonce: 0,
    });
    useServerStore.setState({ activeServerId: null } as never);
    useFacadeStore.setState({ localBackendId: 'b1' } as never);
  });

  it('renders the empty state when nothing is selected', () => {
    render(<AgentsContent backends={backends} data={makeData({})} />);

    expect(screen.getByText('Select a profile')).toBeTruthy();
    expect(
      screen.getByText('Choose a profile from the sidebar, or create one with +.')
    ).toBeTruthy();
    expect(screen.queryByTestId('profile-editor')).toBeNull();
  });

  it('renders the editor and header for a selected profile', () => {
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b1', kind: 'profile', id: 'ap1' },
    });

    render(
      <AgentsContent
        backends={backends}
        data={makeData({ b1: [makeProfile('ap1', 'Coding Agent')] })}
      />
    );

    expect(screen.getByTestId('profile-editor').getAttribute('data-profile-id')).toBe('ap1');
    expect(screen.getByText('Coding Agent')).toBeTruthy();
    expect(screen.getByText('Backend 1')).toBeTruthy();
  });

  it('falls back to the empty state for a stale selection', () => {
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b1', kind: 'profile', id: 'gone' },
    });

    render(<AgentsContent backends={backends} data={makeData({ b1: [makeProfile('ap1')] })} />);

    expect(screen.getByText('Select a profile')).toBeTruthy();
    expect(screen.queryByTestId('profile-editor')).toBeNull();
  });

  it('shows a fetch-error hint when the selected backend failed to load', () => {
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b1', kind: 'profile', id: 'ap1' },
    });

    render(<AgentsContent backends={backends} data={makeData({}, { b1: 'boom' })} />);

    expect(screen.getByText('Select a profile')).toBeTruthy();
    expect(screen.getByText("Couldn't load profiles for this backend.")).toBeTruthy();
    expect(screen.queryByTestId('profile-editor')).toBeNull();
  });

  it('renders create mode with a null profile and "New profile" header', () => {
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b2', kind: 'new' } });

    render(<AgentsContent backends={backends} data={makeData({})} />);

    expect(screen.getByTestId('profile-editor').getAttribute('data-profile-id')).toBe('null');
    expect(screen.getByText('New profile')).toBeTruthy();
    expect(screen.getByText('Backend 2')).toBeTruthy();
  });

  it('onSaved bumps the refresh nonce and selects the saved profile id', () => {
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new' } });

    render(<AgentsContent backends={backends} data={makeData({})} />);

    fireEvent.click(screen.getByText('stub-save'));

    const state = useTopLevelViewStore.getState();
    expect(state.agentsRefreshNonce).toBe(1);
    expect(state.agentsSelection).toEqual({ backendId: 'b1', kind: 'profile', id: 'saved-1' });
  });

  it('keeps the saved profile visible while the refetch is still stale', () => {
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new' } });

    render(<AgentsContent backends={backends} data={makeData({})} />);

    // data does not contain saved-1 yet — the overlay must bridge the gap
    // instead of flashing the empty state.
    fireEvent.click(screen.getByText('stub-save'));

    expect(screen.queryByText('Select a profile')).toBeNull();
    expect(screen.getByTestId('profile-editor').getAttribute('data-profile-id')).toBe('saved-1');
    expect(screen.getByText('Saved One')).toBeTruthy();
  });

  it('prefers the fetched profile over the overlay once the refetch lands', () => {
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new' } });

    const { rerender } = render(<AgentsContent backends={backends} data={makeData({})} />);
    fireEvent.click(screen.getByText('stub-save'));
    expect(screen.getByText('Saved One')).toBeTruthy();

    // Refetch lands with the authoritative record — it wins over the overlay.
    rerender(
      <AgentsContent
        backends={backends}
        data={makeData({ b1: [makeProfile('saved-1', 'Fetched One')] })}
      />
    );

    expect(screen.getByText('Fetched One')).toBeTruthy();
    expect(screen.queryByText('Saved One')).toBeNull();
  });

  it('does not leak the overlay into a different selection', () => {
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new' } });

    render(<AgentsContent backends={backends} data={makeData({})} />);
    fireEvent.click(screen.getByText('stub-save'));
    expect(screen.getByTestId('profile-editor')).toBeTruthy();

    // Select a different (absent) profile — the overlay must not stand in.
    act(() => {
      useTopLevelViewStore.setState({
        agentsSelection: { backendId: 'b1', kind: 'profile', id: 'other' },
      });
    });

    expect(screen.getByText('Select a profile')).toBeTruthy();
    expect(screen.queryByTestId('profile-editor')).toBeNull();
  });

  it('onDeleted clears the selection and bumps the refresh nonce', () => {
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b1', kind: 'profile', id: 'ap1' },
    });

    render(<AgentsContent backends={backends} data={makeData({ b1: [makeProfile('ap1')] })} />);

    fireEvent.click(screen.getByText('stub-delete'));

    const state = useTopLevelViewStore.getState();
    expect(state.agentsSelection).toBeNull();
    expect(state.agentsRefreshNonce).toBe(1);
  });

  it('refreshes the global stores only when the edited backend is active', () => {
    // b1 is the active backend (activeServerId null → localBackendId 'b1').
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new' } });
    const { unmount } = render(<AgentsContent backends={backends} data={makeData({})} />);

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    unmount();

    // b2 is not the active backend — no global refresh.
    vi.clearAllMocks();
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b2', kind: 'new' } });
    render(<AgentsContent backends={backends} data={makeData({})} />);

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes the global stores when activeServerId directly matches the edited backend', () => {
    useServerStore.setState({ activeServerId: 'b2' } as never);
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b2', kind: 'new' } });

    render(<AgentsContent backends={backends} data={makeData({})} />);

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes the legacy "local" activeServerId before comparing', () => {
    // activeServerId still holds the legacy id while the edited backend uses
    // the canonical local backend id — the refresh must still fire.
    useServerStore.setState({ activeServerId: 'local' } as never);
    useFacadeStore.setState({ localBackendId: 'b1' } as never);
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new' } });

    render(<AgentsContent backends={backends} data={makeData({})} />);

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

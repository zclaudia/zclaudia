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

// Skill editor stub: onSaved reports only the saved id (mirrors the real
// editor's contract), so the parent has no object to overlay with.
vi.mock('../SkillEditor', () => ({
  SkillEditor: ({
    skill,
    onSaved,
    onDeleted,
  }: {
    skill: { id: string } | null;
    onSaved: (id: string) => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="skill-editor" data-skill-id={skill?.id ?? 'null'}>
      <button onClick={() => onSaved('skill-saved-1')}>skill-stub-save</button>
      <button onClick={() => onDeleted()}>skill-stub-delete</button>
    </div>
  ),
}));

vi.mock('../SkillDirsEditor', () => ({
  SkillDirsEditor: ({
    backendId,
    dirs,
    diagnostics,
    onSaved,
  }: {
    backendId: string;
    dirs: string[];
    diagnostics: unknown[];
    onSaved: () => void;
  }) => (
    <div
      data-testid="skill-dirs-editor"
      data-backend-id={backendId}
      data-dirs={dirs.join(',')}
      data-diagnostics={diagnostics.length}
    >
      <button onClick={() => onSaved()}>dirs-stub-save</button>
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
import type { SkillsByBackend } from '../useSkillsByBackend';
import type { WorkspaceSkillInfo, SkillLoadDiagnostic } from '../../../services/api';

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

function makeSkill(id: string, name = id): WorkspaceSkillInfo {
  return { id, name, description: '', path: `/skills/${id}` };
}

function makeSkillsData(
  skillsByBackend: Record<string, WorkspaceSkillInfo[]>,
  opts: {
    dirs?: Record<string, string[]>;
    diagnostics?: Record<string, SkillLoadDiagnostic[]>;
    errors?: Record<string, string>;
    loading?: boolean;
  } = {}
): SkillsByBackend {
  return {
    skills: new Map(Object.entries(skillsByBackend)),
    diagnostics: new Map(Object.entries(opts.diagnostics ?? {})),
    dirs: new Map(Object.entries(opts.dirs ?? {})),
    errors: new Map(Object.entries(opts.errors ?? {})),
    loading: opts.loading ?? false,
  };
}

const emptySkills = makeSkillsData({});

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
    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

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
        skillsData={emptySkills}
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

    render(
      <AgentsContent
        backends={backends}
        data={makeData({ b1: [makeProfile('ap1')] })}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('Select a profile')).toBeTruthy();
    expect(screen.queryByTestId('profile-editor')).toBeNull();
  });

  it('shows a fetch-error hint when the selected backend failed to load', () => {
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b1', kind: 'profile', id: 'ap1' },
    });

    render(
      <AgentsContent
        backends={backends}
        data={makeData({}, { b1: 'boom' })}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('Select a profile')).toBeTruthy();
    expect(screen.getByText("Couldn't load profiles for this backend.")).toBeTruthy();
    expect(screen.queryByTestId('profile-editor')).toBeNull();
  });

  it('renders create mode with a null profile and "New profile" header', () => {
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b2', kind: 'new-profile' } });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    expect(screen.getByTestId('profile-editor').getAttribute('data-profile-id')).toBe('null');
    expect(screen.getByText('New profile')).toBeTruthy();
    expect(screen.getByText('Backend 2')).toBeTruthy();
  });

  it('onSaved bumps the refresh nonce and selects the saved profile id', () => {
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new-profile' } });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    fireEvent.click(screen.getByText('stub-save'));

    const state = useTopLevelViewStore.getState();
    expect(state.agentsRefreshNonce).toBe(1);
    expect(state.agentsSelection).toEqual({ backendId: 'b1', kind: 'profile', id: 'saved-1' });
  });

  it('keeps the saved profile visible while the refetch is still stale', () => {
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new-profile' } });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    // data does not contain saved-1 yet — the overlay must bridge the gap
    // instead of flashing the empty state.
    fireEvent.click(screen.getByText('stub-save'));

    expect(screen.queryByText('Select a profile')).toBeNull();
    expect(screen.getByTestId('profile-editor').getAttribute('data-profile-id')).toBe('saved-1');
    expect(screen.getByText('Saved One')).toBeTruthy();
  });

  it('prefers the fetched profile over the overlay once the refetch lands', () => {
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new-profile' } });

    const { rerender } = render(
      <AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />
    );
    fireEvent.click(screen.getByText('stub-save'));
    expect(screen.getByText('Saved One')).toBeTruthy();

    // Refetch lands with the authoritative record — it wins over the overlay.
    rerender(
      <AgentsContent
        backends={backends}
        data={makeData({ b1: [makeProfile('saved-1', 'Fetched One')] })}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('Fetched One')).toBeTruthy();
    expect(screen.queryByText('Saved One')).toBeNull();
  });

  it('does not leak the overlay into a different selection', () => {
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new-profile' } });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);
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

    render(
      <AgentsContent
        backends={backends}
        data={makeData({ b1: [makeProfile('ap1')] })}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByText('stub-delete'));

    const state = useTopLevelViewStore.getState();
    expect(state.agentsSelection).toBeNull();
    expect(state.agentsRefreshNonce).toBe(1);
  });

  it('refreshes the global stores only when the edited backend is active', () => {
    // b1 is the active backend (activeServerId null → localBackendId 'b1').
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new-profile' } });
    const { unmount } = render(
      <AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />
    );

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    unmount();

    // b2 is not the active backend — no global refresh.
    vi.clearAllMocks();
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b2', kind: 'new-profile' } });
    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes the global stores when activeServerId directly matches the edited backend', () => {
    useServerStore.setState({ activeServerId: 'b2' } as never);
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b2', kind: 'new-profile' } });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes the legacy "local" activeServerId before comparing', () => {
    // activeServerId still holds the legacy id while the edited backend uses
    // the canonical local backend id — the refresh must still fire.
    useServerStore.setState({ activeServerId: 'local' } as never);
    useFacadeStore.setState({ localBackendId: 'b1' } as never);
    useTopLevelViewStore.setState({ agentsSelection: { backendId: 'b1', kind: 'new-profile' } });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  // ---- Skills tab ----

  it('renders the skills empty state copy when the skills tab has no selection', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: null,
    });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    expect(screen.getByText('Select a skill')).toBeTruthy();
    expect(screen.getByText('Choose a skill from the sidebar, or create one with +.')).toBeTruthy();
    expect(screen.queryByTestId('skill-editor')).toBeNull();
  });

  it('renders the skill editor and header for a selected skill', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'skill', id: 'sk1' },
    });

    render(
      <AgentsContent
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({ b1: [makeSkill('sk1', 'Git Helper')] })}
      />
    );

    expect(screen.getByTestId('skill-editor').getAttribute('data-skill-id')).toBe('sk1');
    expect(screen.getByText('Git Helper')).toBeTruthy();
    expect(screen.getByText('Backend 1')).toBeTruthy();
  });

  it('falls back to the skills empty state for a stale skill selection', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'skill', id: 'gone' },
    });

    render(
      <AgentsContent
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({ b1: [makeSkill('sk1')] })}
      />
    );

    expect(screen.getByText('Select a skill')).toBeTruthy();
    expect(screen.queryByTestId('skill-editor')).toBeNull();
  });

  it('shows a fetch-error hint when the selected backend failed to load skills', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'skill', id: 'sk1' },
    });

    render(
      <AgentsContent
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({}, { errors: { b1: 'boom' } })}
      />
    );

    expect(screen.getByText('Select a skill')).toBeTruthy();
    expect(screen.getByText("Couldn't load skills for this backend.")).toBeTruthy();
    expect(screen.queryByTestId('skill-editor')).toBeNull();
  });

  it('keeps the detail chrome while skills are still loading for a missing id', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'skill', id: 'sk1' },
    });

    render(
      <AgentsContent
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({}, { loading: true })}
      />
    );

    expect(screen.queryByText('Select a skill')).toBeNull();
    expect(screen.getByText('sk1')).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders skill create mode with a null skill and "New skill" header', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b2', kind: 'new-skill' },
    });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    expect(screen.getByTestId('skill-editor').getAttribute('data-skill-id')).toBe('null');
    expect(screen.getByText('New skill')).toBeTruthy();
    expect(screen.getByText('Backend 2')).toBeTruthy();
  });

  it('skill save bumps the nonce, re-selects the id, and avoids the empty-state flash', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'new-skill' },
    });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    // skillsData does not contain skill-saved-1 (and is not even loading yet) —
    // the just-saved marker must keep the detail chrome up instead of flashing
    // the empty state.
    fireEvent.click(screen.getByText('skill-stub-save'));

    const state = useTopLevelViewStore.getState();
    expect(state.agentsRefreshNonce).toBe(1);
    expect(state.agentsSelection).toEqual({ backendId: 'b1', kind: 'skill', id: 'skill-saved-1' });
    expect(screen.queryByText('Select a skill')).toBeNull();
    expect(screen.getByText('skill-saved-1')).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders the fetched skill once the refetch lands after a save', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'new-skill' },
    });

    const { rerender } = render(
      <AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />
    );
    fireEvent.click(screen.getByText('skill-stub-save'));
    expect(screen.getByText('Loading…')).toBeTruthy();

    rerender(
      <AgentsContent
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({ b1: [makeSkill('skill-saved-1', 'Saved Skill')] })}
      />
    );

    expect(screen.getByTestId('skill-editor').getAttribute('data-skill-id')).toBe('skill-saved-1');
    expect(screen.getByText('Saved Skill')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('skill mutations never refresh the global profile stores', () => {
    // b1 is the active backend — a profile mutation here would refresh the
    // stores, but skills must not.
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'new-skill' },
    });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    fireEvent.click(screen.getByText('skill-stub-save'));
    expect(mockLoadAll).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('skill delete clears the selection and bumps the refresh nonce', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'skill', id: 'sk1' },
    });

    render(
      <AgentsContent
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({ b1: [makeSkill('sk1')] })}
      />
    );

    fireEvent.click(screen.getByText('skill-stub-delete'));

    const state = useTopLevelViewStore.getState();
    expect(state.agentsSelection).toBeNull();
    expect(state.agentsRefreshNonce).toBe(1);
    expect(mockLoadAll).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('renders the external directories editor with dirs and diagnostics', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'skill-dirs' },
    });

    render(
      <AgentsContent
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData(
          {},
          {
            dirs: { b1: ['/a', '/b'] },
            diagnostics: {
              b1: [
                {
                  type: 'warning',
                  code: 'W1',
                  message: 'w',
                  path: '/a',
                  source: 'external',
                },
              ],
            },
          }
        )}
      />
    );

    const editor = screen.getByTestId('skill-dirs-editor');
    expect(editor.getAttribute('data-backend-id')).toBe('b1');
    expect(editor.getAttribute('data-dirs')).toBe('/a,/b');
    expect(editor.getAttribute('data-diagnostics')).toBe('1');
    expect(screen.getByText('External directories')).toBeTruthy();
    expect(screen.getByText('Backend 1')).toBeTruthy();
  });

  it('skill-dirs onSaved bumps the refresh nonce', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'skill-dirs' },
    });

    render(<AgentsContent backends={backends} data={makeData({})} skillsData={emptySkills} />);

    fireEvent.click(screen.getByText('dirs-stub-save'));
    expect(useTopLevelViewStore.getState().agentsRefreshNonce).toBe(1);
  });
});

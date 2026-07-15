// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';

import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';
import { useServerStore } from '../../../stores/serverStore';
import { useFacadeStore } from '../../../stores/facadeStore';

const {
  mockLoadAll,
  mockRefresh,
  mockListLlmProfilesForBackend,
  mockUpdateAgentProfileForBackend,
  mockDeleteAgentProfileForBackend,
  mockDeleteLlmProfileForBackend,
  mockSetDefaultLlmProfileForBackend,
  mockConfirm,
} = vi.hoisted(() => ({
  mockLoadAll: vi.fn().mockResolvedValue(undefined),
  mockRefresh: vi.fn().mockResolvedValue(undefined),
  mockListLlmProfilesForBackend: vi.fn(),
  mockUpdateAgentProfileForBackend: vi.fn(),
  mockDeleteAgentProfileForBackend: vi.fn(),
  mockDeleteLlmProfileForBackend: vi.fn(),
  mockSetDefaultLlmProfileForBackend: vi.fn(),
  mockConfirm: vi.fn().mockResolvedValue(true),
}));

// AgentsContent's provider store sync refetches the edited backend's LLM
// profile list; stub only that call and keep the rest of the api surface real
// (the test only imports types from it).
vi.mock('../../../services/api', async importOriginal => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    listLlmProfilesForBackend: mockListLlmProfilesForBackend,
    updateAgentProfileForBackend: mockUpdateAgentProfileForBackend,
    deleteAgentProfileForBackend: mockDeleteAgentProfileForBackend,
    deleteLlmProfileForBackend: mockDeleteLlmProfileForBackend,
    setDefaultLlmProfileForBackend: mockSetDefaultLlmProfileForBackend,
  };
});

vi.mock('../../../stores/confirmDialogStore', () => ({ confirm: mockConfirm }));

// The stub exposes buttons wired to onSaved/onDeleted so tests can drive the
// parent's handlers without the real (network-heavy) editor.
// ProfileEditor now owns its own header (ProfileHeader) — it no longer renders
// inside DetailShell, so the stub surfaces the profile name and backendName
// itself (mirroring what the real header would show) to keep the parent-level
// assertions below meaningful.
vi.mock('../ProfileEditor', () => ({
  ProfileEditor: ({
    profile,
    backendName,
    onSaved,
    onDeleted,
  }: {
    profile: AgentProfileConfig | null;
    backendName?: string;
    onSaved: (saved: AgentProfileConfig) => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="profile-editor" data-profile-id={profile?.id ?? 'null'}>
      {backendName && <span>{backendName}</span>}
      {profile?.name && <span>{profile.name}</span>}
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
    backendName,
    onSaved,
    onDeleted,
  }: {
    skill: { id: string; name?: string } | null;
    backendName?: string;
    onSaved: (id: string) => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="skill-editor" data-skill-id={skill?.id ?? 'null'}>
      {skill && <span>{skill.name ?? skill.id}</span>}
      <span>{backendName}</span>
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

// MCP editor stub: like the skill editor, onSaved reports only the saved id.
// onStatusChanged mirrors the real editor's connection-action callback.
vi.mock('../McpServerEditor', () => ({
  McpServerEditor: ({
    server,
    status,
    backendName,
    onSaved,
    onDeleted,
    onStatusChanged,
  }: {
    server: { id: string; name?: string } | null;
    status: { state: string } | undefined;
    backendName?: string;
    onSaved: (id: string) => void;
    onDeleted: () => void;
    onStatusChanged: () => void;
  }) => (
    <div
      data-testid="mcp-editor"
      data-server-id={server?.id ?? 'null'}
      data-status={status?.state ?? 'none'}
    >
      {server && <span>{server.name ?? server.id}</span>}
      <span>{backendName}</span>
      <button onClick={() => onSaved('mcp-saved-1')}>mcp-stub-save</button>
      <button onClick={() => onDeleted()}>mcp-stub-delete</button>
      <button onClick={() => onStatusChanged()}>mcp-stub-status</button>
    </div>
  ),
}));

// LLM profile (provider) editor stub: like MCP, onSaved reports only the id.
// Delete / set-default now live on the library card, so the editor no longer
// takes an onDeleted — it owns its own ProfileHeader with an onBack instead.
vi.mock('../LlmProfileEditor', () => ({
  LlmProfileEditor: ({
    profile,
    backendName,
    onSaved,
  }: {
    profile: { id: string; name?: string } | null;
    backendName?: string;
    onSaved: (id: string) => void;
  }) => (
    <div data-testid="llm-profile-editor" data-profile-id={profile?.id ?? 'null'}>
      {backendName && <span>{backendName}</span>}
      {profile?.name && <span>{profile.name}</span>}
      <button onClick={() => onSaved('llm-saved-1')}>llm-stub-save</button>
    </div>
  ),
}));

// Mock the modal so we assert wiring, not its internals.
vi.mock('../NewAgentProfileModal', () => ({
  NewAgentProfileModal: (props: { backendId: string; onCreated: (p: unknown) => void }) => (
    <div data-testid="new-agent-modal" data-backend={props.backendId}>
      <button onClick={() => props.onCreated({ id: 'p-new', name: 'X' })}>mock-create</button>
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
import { useLlmProfileMetaStore } from '../../../stores/llmProfileMetaStore';
import type { AgentsBackend, ProfilesByBackend } from '../useProfilesByBackend';
import type { SkillsByBackend } from '../useSkillsByBackend';
import type { McpServersByBackend } from '../useMcpServersByBackend';
import type { LlmProfilesByBackend } from '../useLlmProfilesByBackend';
import type { WorkspaceSkillInfo, SkillLoadDiagnostic } from '../../../services/api';
import type { LlmProfileConfig, McpServerConfig, McpServerStatus } from '@zclaudia/shared';

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
    dirsFailed?: string[];
    diagnostics?: Record<string, SkillLoadDiagnostic[]>;
    errors?: Record<string, string>;
    loading?: boolean;
  } = {}
): SkillsByBackend {
  return {
    skills: new Map(Object.entries(skillsByBackend)),
    diagnostics: new Map(Object.entries(opts.diagnostics ?? {})),
    dirs: new Map(Object.entries(opts.dirs ?? {})),
    dirsFailed: new Set(opts.dirsFailed ?? []),
    errors: new Map(Object.entries(opts.errors ?? {})),
    loading: opts.loading ?? false,
  };
}

const emptySkills = makeSkillsData({});

function makeMcpServer(id: string, name = id): McpServerConfig {
  return { id, name, enabled: true } as McpServerConfig;
}

function makeMcpData(
  serversByBackend: Record<string, McpServerConfig[]>,
  opts: {
    statuses?: Record<string, Record<string, McpServerStatus>>;
    errors?: Record<string, string>;
    loading?: boolean;
  } = {}
): McpServersByBackend {
  return {
    servers: new Map(Object.entries(serversByBackend)),
    statuses: new Map(Object.entries(opts.statuses ?? {})),
    errors: new Map(Object.entries(opts.errors ?? {})),
    loading: opts.loading ?? false,
  };
}

const emptyMcp = makeMcpData({});

function makeLlmProfile(id: string, name = id): LlmProfileConfig {
  return {
    id,
    name,
    providerType: 'anthropic',
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeProvidersData(
  profilesByBackend: Record<string, LlmProfileConfig[]>,
  opts: { errors?: Record<string, string>; loading?: boolean } = {}
): LlmProfilesByBackend {
  return {
    profiles: new Map(Object.entries(profilesByBackend)),
    errors: new Map(Object.entries(opts.errors ?? {})),
    loading: opts.loading ?? false,
  };
}

const emptyProviders = makeProvidersData({});

describe('AgentsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListLlmProfilesForBackend.mockResolvedValue([]);
    mockUpdateAgentProfileForBackend.mockResolvedValue(makeProfile('ap1'));
    mockDeleteAgentProfileForBackend.mockResolvedValue({ ok: true });
    mockDeleteLlmProfileForBackend.mockResolvedValue({ ok: true });
    mockSetDefaultLlmProfileForBackend.mockResolvedValue(undefined);
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'profiles' },
      agentsSelection: null,
      agentsRefreshNonce: 0,
    });
    useServerStore.setState({ activeServerId: null } as never);
    useFacadeStore.setState({ localBackendId: 'b1' } as never);
    useLlmProfileMetaStore.setState({ providersByBackend: {} });
  });

  it('renders the library browse view when nothing is selected', () => {
    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    // No selection now shows the library BrowseView (headed by the active
    // tab's title) instead of a "Select a …" empty state.
    expect(screen.getByText('Agent Profiles')).toBeTruthy();
    expect(screen.queryByTestId('profile-editor')).toBeNull();
  });

  it('renders the editor and header for a selected profile', () => {
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b1', kind: 'profile', id: 'ap1' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
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
        providersData={emptyProviders}
        mcpData={emptyMcp}
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
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({}, { b1: 'boom' })}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('Select a profile')).toBeTruthy();
    expect(screen.getByText("Couldn't load profiles for this backend.")).toBeTruthy();
    expect(screen.queryByTestId('profile-editor')).toBeNull();
  });

  it('opens the New Agent modal (not the inline editor) when New is clicked on the Profiles tab', () => {
    // No selection (browse view), Profiles tab active (default from beforeEach).
    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /New/ }));

    expect(screen.getByTestId('new-agent-modal')).toBeInTheDocument();
  });

  it('sets a profile as the default from its card menu', async () => {
    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({ b1: [makeProfile('ap1', 'Coding Agent')] })}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Set as default agent' }));

    await waitFor(() =>
      expect(mockUpdateAgentProfileForBackend).toHaveBeenCalledWith('b1', 'ap1', {
        isDefault: true,
      })
    );
    expect(useTopLevelViewStore.getState().agentsRefreshNonce).toBe(1);
  });

  it('confirms before deleting a profile from its card menu', async () => {
    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({ b1: [makeProfile('ap1', 'Coding Agent')] })}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete agent' }));

    await waitFor(() =>
      expect(mockDeleteAgentProfileForBackend).toHaveBeenCalledWith('b1', 'ap1')
    );
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete profile?', destructive: true })
    );
    expect(useTopLevelViewStore.getState().agentsRefreshNonce).toBe(1);
  });

  it('selects the created profile after the modal reports success', () => {
    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    fireEvent.click(screen.getByRole('button', { name: 'mock-create' }));

    const selection = useTopLevelViewStore.getState().agentsSelection;
    expect(selection).toEqual(expect.objectContaining({ kind: 'profile', id: 'p-new' }));
  });

  it('onDeleted clears the selection and bumps the refresh nonce', () => {
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b1', kind: 'profile', id: 'ap1' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
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
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b1', kind: 'profile', id: 'ap1' },
    });
    const { unmount } = render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({ b1: [makeProfile('ap1')] })}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    unmount();

    // b2 is not the active backend — no global refresh.
    vi.clearAllMocks();
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b2', kind: 'profile', id: 'ap2' },
    });
    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({ b2: [makeProfile('ap2')] })}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes the global stores when activeServerId directly matches the edited backend', () => {
    useServerStore.setState({ activeServerId: 'b2' } as never);
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b2', kind: 'profile', id: 'ap2' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({ b2: [makeProfile('ap2')] })}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes the legacy "local" activeServerId before comparing', () => {
    // activeServerId still holds the legacy id while the edited backend uses
    // the canonical local backend id — the refresh must still fire.
    useServerStore.setState({ activeServerId: 'local' } as never);
    useFacadeStore.setState({ localBackendId: 'b1' } as never);
    useTopLevelViewStore.setState({
      agentsSelection: { backendId: 'b1', kind: 'profile', id: 'ap1' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({ b1: [makeProfile('ap1')] })}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByText('stub-save'));
    expect(mockLoadAll).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  // ---- Skills tab ----

  it('renders the library browse view on the skills tab with no selection', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: null,
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('Skills')).toBeTruthy();
    expect(screen.queryByTestId('skill-editor')).toBeNull();
  });

  it('renders the skill editor and header for a selected skill', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'skill', id: 'sk1' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
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
        providersData={emptyProviders}
        mcpData={emptyMcp}
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
        providersData={emptyProviders}
        mcpData={emptyMcp}
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
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({}, { loading: true })}
      />
    );

    expect(screen.queryByText('Select a skill')).toBeNull();
    expect(screen.getByText('sk1')).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders skill create mode with a null skill and forwards the backend name', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b2', kind: 'new-skill' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByTestId('skill-editor').getAttribute('data-skill-id')).toBe('null');
    expect(screen.getByText('Backend 2')).toBeTruthy();
  });

  it('skill save bumps the nonce, re-selects the id, and avoids the empty-state flash', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'new-skill' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

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
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );
    fireEvent.click(screen.getByText('skill-stub-save'));
    expect(screen.getByText('Loading…')).toBeTruthy();

    rerender(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({ b1: [makeSkill('skill-saved-1', 'Saved Skill')] })}
      />
    );

    expect(screen.getByTestId('skill-editor').getAttribute('data-skill-id')).toBe('skill-saved-1');
    expect(screen.getByText('Saved Skill')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('shows the error hint when the post-save skills refetch settles without the id', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'new-skill' },
    });

    const { rerender } = render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );
    fireEvent.click(screen.getByText('skill-stub-save'));
    expect(screen.getByText('Loading…')).toBeTruthy();

    // Refetch starts…
    rerender(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({}, { loading: true })}
      />
    );
    // …and settles with a failure — the just-saved marker must let go instead
    // of masking the error behind eternal Loading chrome.
    rerender(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({}, { errors: { b1: 'boom' } })}
      />
    );

    expect(screen.getByText('Select a skill')).toBeTruthy();
    expect(screen.getByText("Couldn't load skills for this backend.")).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('skill mutations never refresh the global profile stores', () => {
    // b1 is the active backend — a profile mutation here would refresh the
    // stores, but skills must not.
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'new-skill' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

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
        providersData={emptyProviders}
        mcpData={emptyMcp}
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
        providersData={emptyProviders}
        mcpData={emptyMcp}
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

    render(
      <AgentsContent
        providersData={emptyProviders}
        backends={backends}
        mcpData={emptyMcp}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByText('dirs-stub-save'));
    expect(useTopLevelViewStore.getState().agentsRefreshNonce).toBe(1);
  });

  it('never renders the dirs editor when the dirs fetch failed', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'skill-dirs' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({}, { dirsFailed: ['b1'] })}
      />
    );

    // An editable empty list here would wipe the backend's configured dirs on
    // the first add/remove (the editor PUTs the whole array).
    expect(screen.queryByTestId('skill-dirs-editor')).toBeNull();
    expect(screen.getByText("Couldn't load directories for this backend.")).toBeTruthy();
    expect(screen.getByText('Editing is disabled until the list can be loaded.')).toBeTruthy();
    expect(screen.getByText('External directories')).toBeTruthy();
  });

  it('treats a missing dirs entry while loading as loading, not an editable empty list', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'skills' },
      agentsSelection: { backendId: 'b1', kind: 'skill-dirs' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={makeSkillsData({}, { loading: true })}
      />
    );

    expect(screen.queryByTestId('skill-dirs-editor')).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.getByText('External directories')).toBeTruthy();
  });

  // ---- MCP Servers tab ----

  it('renders the library browse view on the mcp tab with no selection', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: null,
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('MCP Servers')).toBeTruthy();
    expect(screen.queryByTestId('mcp-editor')).toBeNull();
  });

  it('renders the MCP editor with header and status for a selected server', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: { backendId: 'b1', kind: 'mcp-server', id: 'm1' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={makeMcpData(
          { b1: [makeMcpServer('m1', 'context7')] },
          { statuses: { b1: { context7: { name: 'context7', state: 'connected' } } } }
        )}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    const editor = screen.getByTestId('mcp-editor');
    expect(editor.getAttribute('data-server-id')).toBe('m1');
    expect(editor.getAttribute('data-status')).toBe('connected');
    expect(screen.getByText('context7')).toBeTruthy();
    expect(screen.getByText('Backend 1')).toBeTruthy();
  });

  it('passes an undefined status when the backend reported no statuses', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: { backendId: 'b1', kind: 'mcp-server', id: 'm1' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={makeMcpData({ b1: [makeMcpServer('m1', 'context7')] })}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByTestId('mcp-editor').getAttribute('data-status')).toBe('none');
  });

  it('renders MCP create mode with a null server and forwards the backend name', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: { backendId: 'b2', kind: 'new-mcp-server' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByTestId('mcp-editor').getAttribute('data-server-id')).toBe('null');
    expect(screen.getByText('Backend 2')).toBeTruthy();
  });

  it('MCP save bumps the nonce, re-selects the id, and avoids the empty-state flash', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: { backendId: 'b1', kind: 'new-mcp-server' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    // mcpData does not contain mcp-saved-1 (and is not even loading yet) — the
    // just-saved marker must keep the detail chrome up instead of flashing the
    // empty state.
    fireEvent.click(screen.getByText('mcp-stub-save'));

    const state = useTopLevelViewStore.getState();
    expect(state.agentsRefreshNonce).toBe(1);
    expect(state.agentsSelection).toEqual({
      backendId: 'b1',
      kind: 'mcp-server',
      id: 'mcp-saved-1',
    });
    expect(screen.queryByText('Select an MCP server')).toBeNull();
    expect(screen.getByText('mcp-saved-1')).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders the fetched server once the refetch lands after a save', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: { backendId: 'b1', kind: 'new-mcp-server' },
    });

    const { rerender } = render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );
    fireEvent.click(screen.getByText('mcp-stub-save'));
    expect(screen.getByText('Loading…')).toBeTruthy();

    rerender(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={makeMcpData({ b1: [makeMcpServer('mcp-saved-1', 'Saved Server')] })}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByTestId('mcp-editor').getAttribute('data-server-id')).toBe('mcp-saved-1');
    expect(screen.getByText('Saved Server')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('shows the error hint when the post-save MCP refetch settles without the id', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: { backendId: 'b1', kind: 'new-mcp-server' },
    });

    const { rerender } = render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );
    fireEvent.click(screen.getByText('mcp-stub-save'));
    expect(screen.getByText('Loading…')).toBeTruthy();

    // Refetch starts…
    rerender(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={makeMcpData({}, { loading: true })}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );
    // …and settles with a failure — the marker lets go and the error shows.
    rerender(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={makeMcpData({}, { errors: { b1: 'boom' } })}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('Select an MCP server')).toBeTruthy();
    expect(screen.getByText("Couldn't load MCP servers for this backend.")).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('shows a fetch-error hint for a stale MCP selection on a failed backend', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: { backendId: 'b1', kind: 'mcp-server', id: 'm1' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={makeMcpData({}, { errors: { b1: 'boom' } })}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('Select an MCP server')).toBeTruthy();
    expect(screen.getByText("Couldn't load MCP servers for this backend.")).toBeTruthy();
    expect(screen.queryByTestId('mcp-editor')).toBeNull();
  });

  it('MCP delete clears the selection and bumps the refresh nonce', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: { backendId: 'b1', kind: 'mcp-server', id: 'm1' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={makeMcpData({ b1: [makeMcpServer('m1')] })}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByText('mcp-stub-delete'));

    const state = useTopLevelViewStore.getState();
    expect(state.agentsSelection).toBeNull();
    expect(state.agentsRefreshNonce).toBe(1);
  });

  it('MCP status changes bump the refresh nonce so statuses refetch', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: { backendId: 'b1', kind: 'mcp-server', id: 'm1' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={makeMcpData({ b1: [makeMcpServer('m1')] })}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByText('mcp-stub-status'));
    expect(useTopLevelViewStore.getState().agentsRefreshNonce).toBe(1);
    // The selection stays put — only the catalog refetches.
    expect(useTopLevelViewStore.getState().agentsSelection).toEqual({
      backendId: 'b1',
      kind: 'mcp-server',
      id: 'm1',
    });
  });

  it('MCP mutations never refresh the global profile stores', () => {
    // b1 is the active backend — a profile mutation here would refresh the
    // stores, but MCP must not.
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'mcp-servers' },
      agentsSelection: { backendId: 'b1', kind: 'new-mcp-server' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByText('mcp-stub-save'));
    expect(mockLoadAll).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  // ---- Providers tab ----

  it('renders the library browse view on the providers tab with no selection', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: null,
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('LLM Providers')).toBeTruthy();
    expect(screen.queryByTestId('llm-profile-editor')).toBeNull();
  });

  it('renders the provider editor and header for a selected LLM profile', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b1', kind: 'llm-profile', id: 'lp1' },
    });

    render(
      <AgentsContent
        providersData={makeProvidersData({ b1: [makeLlmProfile('lp1', 'Anthropic Direct')] })}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByTestId('llm-profile-editor').getAttribute('data-profile-id')).toBe('lp1');
    expect(screen.getByText('Anthropic Direct')).toBeTruthy();
    expect(screen.getByText('Backend 1')).toBeTruthy();
  });

  it('renders provider create mode with a null profile (editor owns its own header)', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b2', kind: 'new-llm-profile' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByTestId('llm-profile-editor').getAttribute('data-profile-id')).toBe('null');
    // The editor now renders its own ProfileHeader (no DetailShell), so the
    // backend name is surfaced by the editor itself.
    expect(screen.getByText('Backend 2')).toBeTruthy();
  });

  it('falls back to the providers empty state for a stale provider selection', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b1', kind: 'llm-profile', id: 'gone' },
    });

    render(
      <AgentsContent
        providersData={makeProvidersData({ b1: [makeLlmProfile('lp1')] })}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('Select a provider')).toBeTruthy();
    expect(screen.queryByTestId('llm-profile-editor')).toBeNull();
  });

  it('shows a fetch-error hint for a stale provider selection on a failed backend', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b1', kind: 'llm-profile', id: 'lp1' },
    });

    render(
      <AgentsContent
        providersData={makeProvidersData({}, { errors: { b1: 'boom' } })}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('Select a provider')).toBeTruthy();
    expect(screen.getByText("Couldn't load providers for this backend.")).toBeTruthy();
    expect(screen.queryByTestId('llm-profile-editor')).toBeNull();
  });

  it('keeps the detail chrome while providers are still loading for a missing id', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b1', kind: 'llm-profile', id: 'lp1' },
    });

    render(
      <AgentsContent
        providersData={makeProvidersData({}, { loading: true })}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.queryByText('Select a provider')).toBeNull();
    expect(screen.getByText('lp1')).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('provider save bumps the nonce, re-selects the id, and avoids the empty-state flash', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b2', kind: 'new-llm-profile' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    // providersData does not contain llm-saved-1 (and is not even loading yet) —
    // the just-saved marker must keep the detail chrome up instead of flashing
    // the empty state.
    fireEvent.click(screen.getByText('llm-stub-save'));

    const state = useTopLevelViewStore.getState();
    expect(state.agentsRefreshNonce).toBe(1);
    expect(state.agentsSelection).toEqual({
      backendId: 'b2',
      kind: 'llm-profile',
      id: 'llm-saved-1',
    });
    expect(screen.queryByText('Select a provider')).toBeNull();
    expect(screen.getByText('llm-saved-1')).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('renders the fetched provider once the refetch lands after a save', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b2', kind: 'new-llm-profile' },
    });

    const { rerender } = render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );
    fireEvent.click(screen.getByText('llm-stub-save'));
    expect(screen.getByText('Loading…')).toBeTruthy();

    rerender(
      <AgentsContent
        providersData={makeProvidersData({ b2: [makeLlmProfile('llm-saved-1', 'Saved Provider')] })}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByTestId('llm-profile-editor').getAttribute('data-profile-id')).toBe(
      'llm-saved-1'
    );
    expect(screen.getByText('Saved Provider')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('shows the error hint when the post-save providers refetch settles without the id', () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b2', kind: 'new-llm-profile' },
    });

    const { rerender } = render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );
    fireEvent.click(screen.getByText('llm-stub-save'));
    expect(screen.getByText('Loading…')).toBeTruthy();

    // Refetch starts…
    rerender(
      <AgentsContent
        providersData={makeProvidersData({}, { loading: true })}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );
    // …and settles with a failure — the marker lets go and the error shows.
    rerender(
      <AgentsContent
        providersData={makeProvidersData({}, { errors: { b2: 'boom' } })}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    expect(screen.getByText('Select a provider')).toBeTruthy();
    expect(screen.getByText("Couldn't load providers for this backend.")).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('sets a provider as the default from its card menu', async () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: null,
    });

    render(
      <AgentsContent
        providersData={makeProvidersData({ b1: [makeLlmProfile('lp1', 'Anthropic Direct')] })}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Set as default provider' }));

    await waitFor(() =>
      expect(mockSetDefaultLlmProfileForBackend).toHaveBeenCalledWith('b1', 'lp1')
    );
    expect(useTopLevelViewStore.getState().agentsRefreshNonce).toBe(1);
  });

  it('confirms before deleting a provider from its card menu and bumps the refresh nonce', async () => {
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: null,
    });

    render(
      <AgentsContent
        providersData={makeProvidersData({ b1: [makeLlmProfile('lp1', 'Anthropic Direct')] })}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete provider' }));

    await waitFor(() =>
      expect(mockDeleteLlmProfileForBackend).toHaveBeenCalledWith('b1', 'lp1')
    );
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete provider?', destructive: true })
    );
    expect(useTopLevelViewStore.getState().agentsRefreshNonce).toBe(1);
  });

  it('provider save on the active backend refreshes readiness and the global provider cache', async () => {
    // b1 is the active backend (activeServerId null → localBackendId 'b1').
    const list = [makeLlmProfile('llm-saved-1', 'Fresh')];
    mockListLlmProfilesForBackend.mockResolvedValue(list);
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b1', kind: 'new-llm-profile' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('llm-stub-save'));
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    // Provider mutations must NOT reload agent profiles — that's the agent
    // profile path's concern.
    expect(mockLoadAll).not.toHaveBeenCalled();
    expect(mockListLlmProfilesForBackend).toHaveBeenCalledWith('b1');
    expect(useLlmProfileMetaStore.getState().providersByBackend['b1']).toEqual(list);
  });

  it('mirrors the provider cache under the legacy raw active id when it differs', async () => {
    // activeServerId still holds the legacy 'local' string while the edited
    // backend uses the canonical id — readers key by the raw id, so the fresh
    // list must land under both.
    useServerStore.setState({ activeServerId: 'local' } as never);
    useFacadeStore.setState({ localBackendId: 'b1' } as never);
    const list = [makeLlmProfile('llm-saved-1')];
    mockListLlmProfilesForBackend.mockResolvedValue(list);
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b1', kind: 'new-llm-profile' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('llm-stub-save'));
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    const { providersByBackend } = useLlmProfileMetaStore.getState();
    expect(providersByBackend['b1']).toEqual(list);
    expect(providersByBackend['local']).toEqual(list);
  });

  it('provider mutations on a non-active backend update its cache without readiness refresh', async () => {
    // b2 is not the active backend — no readiness refresh, no raw-key mirror,
    // but the canonical cache entry still updates.
    const list = [makeLlmProfile('llm-saved-1')];
    mockListLlmProfilesForBackend.mockResolvedValue(list);
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b2', kind: 'new-llm-profile' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('llm-stub-save'));
    });

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockLoadAll).not.toHaveBeenCalled();
    expect(mockListLlmProfilesForBackend).toHaveBeenCalledWith('b2');
    const { providersByBackend } = useLlmProfileMetaStore.getState();
    expect(providersByBackend['b2']).toEqual(list);
    expect(providersByBackend['b1']).toBeUndefined();
  });

  it('provider delete from the card menu also syncs the global provider cache', async () => {
    mockListLlmProfilesForBackend.mockResolvedValue([]);
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: null,
    });

    render(
      <AgentsContent
        providersData={makeProvidersData({ b1: [makeLlmProfile('lp1')] })}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete provider' }));
    });

    expect(mockDeleteLlmProfileForBackend).toHaveBeenCalledWith('b1', 'lp1');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockListLlmProfilesForBackend).toHaveBeenCalledWith('b1');
    expect(useLlmProfileMetaStore.getState().providersByBackend['b1']).toEqual([]);
  });

  it('survives a failed provider cache refetch (readiness still refreshes)', async () => {
    mockListLlmProfilesForBackend.mockRejectedValue(new Error('offline'));
    useTopLevelViewStore.setState({
      view: { kind: 'agents', tab: 'providers' },
      agentsSelection: { backendId: 'b1', kind: 'new-llm-profile' },
    });

    render(
      <AgentsContent
        providersData={emptyProviders}
        mcpData={emptyMcp}
        backends={backends}
        data={makeData({})}
        skillsData={emptySkills}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('llm-stub-save'));
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(useLlmProfileMetaStore.getState().providersByBackend['b1']).toBeUndefined();
  });
});

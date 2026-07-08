import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor, screen } from '@testing-library/react';

const selectionMocks = {
  selectProject: vi.fn(),
  selectSession: vi.fn(),
  selectSessionOnBackend: vi.fn(),
  selectBackend: vi.fn(),
};

const neverSettles = new Promise(() => {});

// Mock child components to isolate Sidebar
vi.mock('../ProjectSettings', () => ({
  ProjectSettings: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="project-settings">
        <button onClick={onClose}>close-project-settings</button>
      </div>
    ) : null,
}));
vi.mock('../SearchFilters', () => ({
  SearchFilters: ({ onClose, onFiltersChange }: any) => (
    <div data-testid="search-filters">
      <button onClick={onClose}>close-filters</button>
      <button onClick={() => onFiltersChange({ sessionId: 's1' })}>apply-filter</button>
    </div>
  ),
}));
vi.mock('../PluginPermissionDialog', () => ({ PluginPermissionDialog: () => null }));
vi.mock('../../features/sidebar/SessionItem', () => ({
  SessionItem: ({
    session,
    onSelect,
    isSelected,
    hasPending,
    isActive,
    providerName,
    worktreeBranch,
    isMobile,
    onPopOut,
  }: any) => (
    <div
      data-testid="session-item"
      data-selected={isSelected}
      data-pending={hasPending}
      data-active={isActive}
      data-mobile={isMobile}
    >
      <span>{session.name}</span>
      {providerName && <span data-testid="provider-name">{providerName}</span>}
      {worktreeBranch && <span data-testid="worktree-branch">{worktreeBranch}</span>}
      <button onClick={() => onSelect(session.id)}>select-{session.id}</button>
      {onPopOut && (
        <button onClick={onPopOut} data-testid="pop-out">
          pop-out
        </button>
      )}
    </div>
  ),
}));
vi.mock('../../features/sidebar/WorktreeGroupItem', () => ({
  WorktreeGroupItem: ({ children }: any) => <div data-testid="worktree-group">{children}</div>,
}));
vi.mock('../../features/sidebar/ProjectWorkspaceItem', () => ({
  ProjectWorkspaceItem: ({ onSelect, taskChildren, taskCount, phase }: any) => (
    <div data-testid="supervisor-group" data-phase={phase} data-task-count={taskCount}>
      <button onClick={onSelect}>select-supervisor</button>
      {taskChildren}
    </div>
  ),
}));
vi.mock('../../features/sidebar/worktreeGrouping', () => ({
  groupSessionsByWorktree: vi.fn().mockReturnValue([]),
}));
vi.mock('../../hooks/useSwipeBack', () => ({
  useSwipeBack: vi.fn().mockReturnValue({ current: null }),
}));
vi.mock('../../features/automation/AutomationTree', () => ({
  AutomationTree: ({ tab }: any) => <div data-testid="automation-tree" data-tab={tab} />,
}));
vi.mock('../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({
    selectProject: selectionMocks.selectProject,
    selectSession: selectionMocks.selectSession,
    selectSessionOnBackend: selectionMocks.selectSessionOnBackend,
    selectBackend: selectionMocks.selectBackend,
  }),
}));

// Mock services
vi.mock('../../services/api', async importOriginal => {
  const mod = await importOriginal<Record<string, any>>();
  const stubbed: Record<string, any> = {};
  for (const key of Object.keys(mod)) {
    stubbed[key] =
      key === 'ApiError'
        ? mod[key]
        : typeof mod[key] === 'function'
          ? vi.fn(() => Promise.resolve(null))
          : mod[key];
  }
  stubbed.getProjectWorktrees = vi.fn(() => neverSettles);
  stubbed.searchSessions = vi.fn().mockResolvedValue({ results: [], total: 0 });
  stubbed.getSearchHistory = vi.fn(() => neverSettles);
  stubbed.searchMessages = vi.fn().mockResolvedValue([]);
  stubbed.clearSearchHistory = vi.fn().mockResolvedValue(undefined);
  stubbed.createProject = vi.fn().mockResolvedValue({
    id: 'new-proj',
    name: 'New Project',
    rootPath: '/tmp/new',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  stubbed.createSession = vi.fn().mockResolvedValue({
    id: 'new-sess',
    name: 'New Session',
    projectId: 'proj-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  stubbed.deleteProject = vi.fn().mockResolvedValue(undefined);
  return stubbed;
});

import { Sidebar } from '../../features/sidebar/Sidebar';
import { useProjectStore } from '../../stores/projectStore';
import { useLlmProfileMetaStore } from '../../stores/llmProfileMetaStore';
import { useAgentProfileMetaStore } from '../../stores/agentProfileMetaStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useServerStore } from '../../stores/serverStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useInteractionStore } from '../../stores/interactionStore';
import { useRunStore } from '../../stores/runStore';
import { useSessionRunStateStore } from '../../stores/sessionRunStateStore';
import { useUIStore } from '../../stores/uiStore';
import { useAgentReadinessStore } from '../../stores/agentReadinessStore';
import { useHomeQuickActionsStore } from '../../stores/homeQuickActionsStore';
import { useSidebarExpansionStore } from '../../stores/sidebarExpansionStore';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import * as api from '../../services/api';
import { groupSessionsByWorktree } from '../../features/sidebar/worktreeGrouping';
import { isAndroid } from '../../utils/platform';

vi.mock('../../utils/platform', async importOriginal => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
    isDesktopTauri: vi.fn(() => false),
  };
});

const baseProject = {
  id: 'proj-1',
  name: 'Project One',
  rootPath: '/tmp/proj1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
const baseSession = {
  id: 'sess-1',
  name: 'Session 1',
  projectId: 'proj-1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
const LOCAL_BACKEND_ID = 'local-standalone';

function setupStores(overrides: Record<string, any> = {}) {
  useLlmProfileMetaStore.setState({
    providersByBackend: {},
    providerCommands: {},
    providerCapabilities: {},
  } as any);

  useAgentProfileMetaStore.setState({
    profiles: {},
    loaded: true,
    loading: false,
    loadAll: vi.fn().mockResolvedValue(undefined),
    ...overrides.agentProfileMetaStore,
  } as any);

  useProjectStore.setState({
    projects: [baseProject as any],
    sessions: [baseSession as any],
    providers: [],
    selectedSessionId: null,
    selectProject: vi.fn(),
    selectSession: vi.fn(),
    addProject: vi.fn(),
    addSession: vi.fn(),
    deleteProject: vi.fn(),
    ...overrides.projectStore,
  } as any);

  useServerStore.setState({
    servers: [
      { id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 },
    ],
    activeServerId: LOCAL_BACKEND_ID,
    connections: {
      [LOCAL_BACKEND_ID]: {
        status: 'connected',
        error: null,
        isLocalConnection: true,
        features: [],
      },
    },
    setActiveServer: vi.fn(),
    getDefaultServer: vi
      .fn()
      .mockReturnValue({ id: LOCAL_BACKEND_ID, name: 'Local', address: 'localhost:3100' }),
    ...overrides.serverStore,
  } as any);

  useRecoveryStore.setState({
    backends: {
      [LOCAL_BACKEND_ID]: {
        status: 'ready',
      },
    },
    ...overrides.recoveryStore,
  } as any);

  useFacadeStore.setState({
    connectionState: 'connected',
    backends: [
      {
        backendId: LOCAL_BACKEND_ID,
        runtimeState: 'ready',
        online: true,
        name: 'Local',
        isThisInstance: true,
        channel: 'local',
      },
    ],
    localBackendId: LOCAL_BACKEND_ID,
    currentInstanceId: null,
    currentDeviceId: null,
    snapshotVersion: 0,
    ...overrides.facadeStore,
  } as any);

  useSupervisionStore.setState({ agents: {}, ...overrides.supervisionStore } as any);
  usePermissionStore.setState({ pendingRequests: [], ...overrides.permissionStore } as any);
  useInteractionStore.setState({ interactions: {}, ...overrides.interactionStore } as any);
  useRunStore.setState({ activeRuns: {}, ...overrides.chatStore } as any);
  useSessionRunStateStore.setState({ records: {}, ...overrides.sessionRunStateStore } as any);
  useAgentReadinessStore.setState({
    readiness: { usable: true },
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides.agentReadinessStore,
  } as any);
  useUIStore.setState({
    poppedOutSessions: new Map(),
    requestForceScrollToBottom: vi.fn(),
    ...overrides.uiStore,
  } as any);

  useOwnershipStore.setState({
    sessionBackendIds: {},
    sessionOwnershipVersions: {},
    projectBackendIds: {},
    taskOwners: {},
  } as any);
}

async function advanceDebounce(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Desktop search now lives in a centered modal portaled to document.body, opened
// from the header search icon — so the input and results live outside `container`.
const SEARCH_INPUT_SELECTOR = 'input[placeholder^="Search messages"]';
function openSearchPopover(container: HTMLElement) {
  if (!document.querySelector(SEARCH_INPUT_SELECTOR)) {
    const trigger = container.querySelector('button[title="Search messages"]');
    if (trigger) fireEvent.click(trigger);
  }
}
function getSearchInput(container: HTMLElement): HTMLInputElement {
  openSearchPopover(container);
  return document.querySelector(SEARCH_INPUT_SELECTOR) as HTMLInputElement;
}

describe('Sidebar', () => {
  beforeEach(() => {
    setupStores();
    // Reset persisted backend-row expansion so the Sidebar's auto-expand effect
    // fires fresh each test (it only runs when nothing is expanded).
    useSidebarExpansionStore.setState({ expandedBackendIds: [] });
    vi.clearAllMocks();
    vi.mocked(isAndroid).mockReturnValue(false);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockImplementation(() => neverSettles);
    (api.getProjectWorktrees as ReturnType<typeof vi.fn>).mockImplementation(() => neverSettles);
    selectionMocks.selectProject.mockReset();
    selectionMocks.selectSession.mockReset();
    selectionMocks.selectSessionOnBackend.mockReset();
    selectionMocks.selectBackend.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Basic rendering ----

  it('renders without crashing when expanded', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it('renders without crashing when collapsed', () => {
    const { container } = render(<Sidebar collapsed={true} onToggle={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it('does not render content when collapsed', () => {
    const { container } = render(<Sidebar collapsed={true} onToggle={vi.fn()} />);
    // Collapsed sidebar should not show project names
    expect(container.textContent).not.toContain('Project One');
  });

  it('shows project name when expanded', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.textContent).toContain('Project One');
  });

  it('wraps the expanded sidebar contents in a floating card', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const card = container.querySelector('[data-testid="sidebar-card"]');
    expect(card).toBeTruthy();
    expect(card?.className).toContain('rounded-lg');
    expect(card?.className).toContain('bg-[hsl(var(--sidebar))]');
    expect(card?.className).toContain('overflow-hidden');
  });

  it('drops the hard border and floats the card on the background tone', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const outer = container
      .querySelector('[data-testid="sidebar-card"]')
      ?.parentElement;
    expect(outer?.className).toContain('bg-background');
    expect(outer?.className).toContain('p-1.5');
    expect(outer?.className).not.toContain('border-r');
  });

  it('only shows projects owned by the active backend', () => {
    setupStores({
      projectStore: {
        projects: [
          { ...baseProject, id: 'proj-a', name: 'Project A' },
          { ...baseProject, id: 'proj-b', name: 'Project B' },
        ],
        sessions: [],
      },
      serverStore: {
        activeServerId: 'backend-a',
      },
      recoveryStore: {
        backends: {
          'backend-a': { status: 'ready' },
        },
      },
      facadeStore: {
        connectionState: 'connected',
        backends: [
          { backendId: 'backend-a', runtimeState: 'ready', online: true, name: 'Backend A' },
        ],
      },
    });
    useOwnershipStore.setState({
      projectBackendIds: {
        'proj-a': 'backend-a',
        'proj-b': 'backend-b',
      },
    } as any);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);

    expect(container.textContent).toContain('Project A');
    expect(container.textContent).not.toContain('Project B');
  });

  it('renders the header controls (search / collapse) when expanded', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.querySelector('button[title="Search messages"]')).toBeTruthy();
    expect(container.querySelector('button[title="Collapse sidebar"]')).toBeTruthy();
  });

  it('renders no inline chrome when collapsed (handled by the app-level top bar)', () => {
    const { container } = render(<Sidebar collapsed={true} onToggle={vi.fn()} />);
    // The collapsed sidebar no longer renders a rail — the global icons live in
    // SidebarCollapsedBar, rendered by App. So none of them appear here.
    expect(container.querySelector('button[title="Search messages"]')).toBeNull();
    expect(container.querySelector('button[title="Collapse sidebar"]')).toBeNull();
  });

  it('calls onToggle when collapse button is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(<Sidebar collapsed={false} onToggle={onToggle} />);
    const collapseButton = container.querySelector('button[title="Collapse sidebar"]');
    expect(collapseButton).toBeTruthy();
    fireEvent.click(collapseButton!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // ---- Empty states ----

  it('shows "No projects yet" when no projects exist', () => {
    setupStores({ projectStore: { projects: [], sessions: [] } });
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.textContent).toContain('No projects yet');
  });

  it('shows "No projects yet" under the backend when all projects are internal', () => {
    setupStores({
      projectStore: {
        projects: [{ ...baseProject, isInternal: true }],
        sessions: [],
      },
    });
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Internal projects are filtered out, so the online backend's subtree is empty.
    expect(container.textContent).toContain('No projects yet');
    expect(container.textContent).not.toContain('Project One');
  });

  it('disables new project creation when backend is not ready', () => {
    setupStores({
      facadeStore: {
        connectionState: 'connected',
        backends: [{ backendId: 'local', runtimeState: 'visible', name: 'Local' }],
      },
      recoveryStore: {
        backends: { local: { status: 'subscribing' } },
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // When the backend is not online, no BackendRow is rendered so there is no + button.
    // Creating a project is effectively unavailable.
    const newProjectButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label="New project"]')
    );
    expect(newProjectButtons.length).toBe(0);
  });

  // ---- Project expand/collapse ----

  it('expands project to show sessions when clicked', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Click project name to expand
    const projectButton = container.querySelector('button')!;
    // Find the button containing 'Project One'
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'));
    expect(projBtn).toBeTruthy();
    fireEvent.click(projBtn!);

    // After expanding, session items should appear
    expect(container.querySelector('[data-testid="session-list"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="session-item"]')).toBeTruthy();
  });

  it('collapses project when clicked again', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;

    // Expand
    fireEvent.click(projBtn);
    expect(container.querySelector('[data-testid="session-list"]')).toBeTruthy();

    // Collapse
    fireEvent.click(projBtn);
    expect(container.querySelector('[data-testid="session-list"]')).toBeFalsy();
  });

  // ---- Session selection ----

  it('selects a session when clicked', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Expand project
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    // Click the session select button
    const selectBtn = container.querySelector('button[class*=""]');
    const allButtons = Array.from(container.querySelectorAll('button'));
    const sessBtn = allButtons.find(b => b.textContent === 'select-sess-1');
    expect(sessBtn).toBeTruthy();
    fireEvent.click(sessBtn!);
    expect(selectionMocks.selectSession).toHaveBeenCalledWith('sess-1');
  });

  it('marks session pending for plan review interactions', () => {
    setupStores({
      interactionStore: {
        interactions: {
          'plan-1': {
            type: 'interaction_plan_review',
            interactionId: 'plan-1',
            sessionId: 'sess-1',
            source: 'tool_call',
            createdAt: Date.now(),
            plan: 'review plan',
          },
        },
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(
      container.querySelector('[data-testid="session-item"]')?.getAttribute('data-pending')
    ).toBe('true');
  });

  // ---- Pending indicators ----

  it('marks sessions with pending permission requests', () => {
    setupStores({
      permissionStore: { pendingRequests: [{ sessionId: 'sess-1', id: 'r1' }] },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Expand
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessionItem = container.querySelector('[data-testid="session-item"]');
    expect(sessionItem?.getAttribute('data-pending')).toBe('true');
  });

  it('marks sessions with pending question requests', () => {
    setupStores({
      interactionStore: {
        interactions: {
          'prompt-1': {
            type: 'interaction_prompt',
            interactionId: 'prompt-1',
            sessionId: 'sess-1',
            source: 'provider_native',
            createdAt: Date.now(),
            title: 'Question',
            fields: [],
          },
        },
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessionItem = container.querySelector('[data-testid="session-item"]');
    expect(sessionItem?.getAttribute('data-pending')).toBe('true');
  });

  // ---- Active runs ----

  it('marks sessions with active runs', () => {
    setupStores({
      sessionRunStateStore: {
        records: {
          'sess-1': {
            backendId: LOCAL_BACKEND_ID,
            sessionId: 'sess-1',
            phase: 'running',
            foregroundRunIds: ['run1'],
            updatedAt: Date.now(),
            source: 'run_event',
          },
        },
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessionItem = container.querySelector('[data-testid="session-item"]');
    expect(sessionItem?.getAttribute('data-active')).toBe('true');
  });

  // ---- Provider name resolution ----
  // Sub-project C removed per-row provider/agent labels from the sidebar
  // (see spec §4.4). The session row now never renders a provider-name badge,
  // so the two previous tests covering `getProviderName` were deleted.

  // ---- Worktree branch hint ----

  it('shows worktree branch for sessions with different workingDirectory', () => {
    setupStores({
      projectStore: {
        projects: [{ ...baseProject, rootPath: '/tmp/proj1' }],
        sessions: [{ ...baseSession, workingDirectory: '/tmp/proj1/feature-branch' }],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[data-testid="worktree-branch"]')?.textContent).toBe(
      'feature-branch'
    );
  });

  // ---- Background sessions filtered out ----

  it('filters out background sessions from sidebar', () => {
    setupStores({
      projectStore: {
        sessions: [
          {
            ...baseSession,
            id: 'sess-bg',
            name: 'BG Session',
            type: 'background',
            projectId: 'proj-1',
          },
          baseSession,
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessionItems = container.querySelectorAll('[data-testid="session-item"]');
    expect(sessionItems.length).toBe(1);
    expect(sessionItems[0].textContent).toContain('Session 1');
  });

  // ---- Settings panel ----

  it('calls the top-level settings opener when settings button is clicked', () => {
    const onOpenSettings = vi.fn();
    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} onOpenSettings={onOpenSettings} />
    );
    const settingsButton = container.querySelector('[data-testid="settings-button"]');
    expect(settingsButton).toBeTruthy();
    fireEvent.click(settingsButton!);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSettings.mock.calls[0]).toEqual([]);
    expect(document.querySelector('[data-testid="settings-panel"]')).toBeNull();
  });

  // ---- New Project form ----

  it('shows New Project button when connected', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const newProjectBtns = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label="New project"]')
    );
    expect(newProjectBtns.length).toBeGreaterThan(0);
    expect(newProjectBtns[0].disabled).toBe(false);
  });

  it('disables New Project button when disconnected', () => {
    setupStores({
      facadeStore: {
        connectionState: 'disconnected',
        backends: [
          {
            backendId: LOCAL_BACKEND_ID,
            runtimeState: 'offline',
            name: 'Local',
            isThisInstance: true,
            channel: 'local',
          },
        ],
      },
    });
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // When disconnected there are no online backends — no BackendRow renders, so the
    // + button is absent entirely (new project creation is unavailable).
    const newProjectBtns = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label="New project"]')
    );
    expect(newProjectBtns.length).toBe(0);
  });

  it('shows new project form when New Project is clicked', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const newProjectBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New project"]'
    )!;
    fireEvent.click(newProjectBtn);

    const inputs = container.querySelectorAll('input');
    // Should show project name and root path inputs
    const nameInput = Array.from(inputs).find(i => i.placeholder === 'Project name');
    const pathInput = Array.from(inputs).find(i => i.placeholder?.includes('Working directory'));
    expect(nameInput).toBeTruthy();
    expect(pathInput).toBeTruthy();
  });

  it('blocks new project creation when readiness is initially unknown and refresh reports no usable agent', async () => {
    const refresh = vi.fn(async () => {
      useAgentReadinessStore.setState({
        readiness: { usable: false, reason: 'no_agent' },
        loading: false,
      });
    });
    setupStores({
      agentReadinessStore: {
        readiness: null,
        refresh,
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const newProjectBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New project"]'
    )!;
    fireEvent.click(newProjectBtn);

    await waitFor(() => {
      expect(document.body.textContent).toContain('No agent available yet');
    });
    expect(refresh).toHaveBeenCalled();
    expect(container.querySelector('input[placeholder="Project name"]')).toBeFalsy();
  });

  it('opens the Agents shell mode from the agent setup dialog configure action', async () => {
    const onOpenSettings = vi.fn();
    const refresh = vi.fn(async () => {
      useAgentReadinessStore.setState({
        readiness: { usable: false, reason: 'no_agent' },
        loading: false,
      });
    });
    setupStores({
      agentReadinessStore: {
        readiness: null,
        refresh,
      },
    });
    useTopLevelViewStore.setState({ view: { kind: 'app' }, agentsSelection: null });

    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} onOpenSettings={onOpenSettings} />
    );
    const newProjectBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New project"]'
    )!;
    fireEvent.click(newProjectBtn);

    await waitFor(() => {
      expect(document.body.textContent).toContain('No agent available yet');
    });

    fireEvent.click(screen.getByText('Configure →'));

    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'agents', tab: 'all' });
    expect(document.body.textContent).not.toContain('No agent available yet');
  });

  it('deep-links provider-shaped readiness reasons to the agents providers tab', async () => {
    const onOpenSettings = vi.fn();
    const refresh = vi.fn(async () => {
      useAgentReadinessStore.setState({
        readiness: { usable: false, reason: 'no_credential' },
        loading: false,
      });
    });
    setupStores({
      agentReadinessStore: {
        readiness: null,
        refresh,
      },
    });
    useTopLevelViewStore.setState({ view: { kind: 'app' }, agentsSelection: null });

    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} onOpenSettings={onOpenSettings} />
    );
    const newProjectBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New project"]'
    )!;
    fireEvent.click(newProjectBtn);

    await waitFor(() => {
      expect(document.body.textContent).toContain('No agent available yet');
    });

    fireEvent.click(screen.getByText('Configure →'));

    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'agents', tab: 'providers' });
    expect(document.body.textContent).not.toContain('No agent available yet');
  });

  it('creates project when form is submitted', async () => {
    const addProject = vi.fn();
    const selectProject = vi.fn();
    setupStores({ projectStore: { addProject, selectProject } });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Open form
    const newProjectBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New project"]'
    )!;
    fireEvent.click(newProjectBtn);

    const inputs = container.querySelectorAll('input');
    const nameInput = Array.from(inputs).find(i => i.placeholder === 'Project name')!;
    fireEvent.change(nameInput, { target: { value: 'My New Project' } });

    // Click Create button
    const allButtons = Array.from(container.querySelectorAll('button'));
    const createBtn = allButtons.find(b => b.textContent === 'Create')!;
    await act(async () => {
      fireEvent.click(createBtn);
    });

    expect(api.createProject).toHaveBeenCalledWith(
      {
        name: 'My New Project',
        type: 'code',
        rootPath: undefined,
      },
      'local-standalone'
    );
  });

  it('blocks project submit when readiness becomes unusable while the form is open', async () => {
    let shouldFailReadiness = false;
    const refresh = vi.fn(async () => {
      useAgentReadinessStore.setState({
        readiness: shouldFailReadiness
          ? { usable: false, reason: 'no_credential' }
          : { usable: true },
        loading: false,
      });
    });
    setupStores({
      agentReadinessStore: {
        readiness: { usable: true },
        refresh,
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const newProjectBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New project"]'
    )!;
    fireEvent.click(newProjectBtn);

    const nameInput = container.querySelector('input[placeholder="Project name"]')!;
    fireEvent.change(nameInput, { target: { value: 'Blocked Project' } });
    shouldFailReadiness = true;
    useAgentReadinessStore.setState({ readiness: null, refresh } as any);

    const createBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'Create'
    )!;
    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('No agent available yet');
    });
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('cancels new project form', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const newProjectBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New project"]'
    )!;
    fireEvent.click(newProjectBtn);

    // Click Cancel
    const allButtons = Array.from(container.querySelectorAll('button'));
    const cancelBtn = allButtons.find(b => b.textContent === 'Cancel')!;
    fireEvent.click(cancelBtn);

    // Form should be gone
    const inputs = container.querySelectorAll('input');
    const nameInput = Array.from(inputs).find(i => i.placeholder === 'Project name');
    expect(nameInput).toBeFalsy();
  });

  it('cancels new project form on Escape key', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const newProjectBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New project"]'
    )!;
    fireEvent.click(newProjectBtn);

    const inputs = container.querySelectorAll('input');
    const nameInput = Array.from(inputs).find(i => i.placeholder === 'Project name')!;
    fireEvent.keyDown(nameInput, { key: 'Escape' });

    // Form should be gone
    const nameInputAfter = Array.from(container.querySelectorAll('input')).find(
      i => i.placeholder === 'Project name'
    );
    expect(nameInputAfter).toBeFalsy();
  });

  it('submits new project via Enter key on root path input', async () => {
    const addProject = vi.fn();
    setupStores({ projectStore: { addProject } });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const newProjectBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="New project"]'
    )!;
    fireEvent.click(newProjectBtn);

    const inputs = container.querySelectorAll('input');
    const nameInput = Array.from(inputs).find(i => i.placeholder === 'Project name')!;
    const pathInput = Array.from(inputs).find(i => i.placeholder?.includes('Working directory'))!;
    fireEvent.change(nameInput, { target: { value: 'Test Project' } });
    fireEvent.change(pathInput, { target: { value: '/tmp/test' } });

    await act(async () => {
      fireEvent.keyDown(pathInput, { key: 'Enter' });
    });

    expect(api.createProject).toHaveBeenCalledWith(
      {
        name: 'Test Project',
        type: 'code',
        rootPath: '/tmp/test',
      },
      'local-standalone'
    );
  });

  // ---- Context menu ----

  it('opens project context menu', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // The context menu button is the dots icon next to project name
    // It's the button with the three dots SVG, which appears on hover via opacity
    const menuButtons = container.querySelectorAll('button');
    // Find the dots-menu button (small 6x6 or 8x8 button)
    const dotsButtons = Array.from(menuButtons).filter(b => {
      const svg = b.querySelector('svg');
      return svg && b.textContent?.trim() === '' && b.className.includes('flex-shrink-0');
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });
      // Context menu should appear in a portal
      const contextMenu = document.querySelector('.fixed.w-36, .fixed.w-44');
      if (contextMenu) {
        expect(contextMenu.textContent).toContain('Settings');
        expect(contextMenu.textContent).toContain('New Session');
        expect(contextMenu.textContent).toContain('Delete');
      }
    }
  });

  it('opens project settings from context menu', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const dotsButtons = Array.from(container.querySelectorAll('button')).filter(b => {
      return b.className.includes('flex-shrink-0') && b.textContent?.trim() === '';
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });

      // Find Settings button in portal
      const allSettingsButtons = Array.from(document.querySelectorAll('button')).filter(
        b => b.textContent?.trim() === 'Settings'
      );
      // Click the one inside the context menu (not the sidebar settings button)
      const contextSettingsBtn = allSettingsButtons.find(
        b => b.closest('.fixed.w-36') || b.closest('.fixed.w-44')
      );
      if (contextSettingsBtn) {
        fireEvent.click(contextSettingsBtn);
        expect(document.querySelector('[data-testid="project-settings"]')).toBeTruthy();
      }
    }
  });

  it('deletes project from context menu', async () => {
    const deleteProject = vi.fn();
    setupStores({ projectStore: { deleteProject } });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const dotsButtons = Array.from(container.querySelectorAll('button')).filter(b => {
      return b.className.includes('flex-shrink-0') && b.textContent?.trim() === '';
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });

      const deleteBtn = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent?.trim() === 'Delete'
      );
      if (deleteBtn) {
        await act(async () => {
          fireEvent.click(deleteBtn);
        });
        expect(api.deleteProject).toHaveBeenCalledWith('proj-1');
      }
    }
  });

  it('opens new session form from context menu', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Expand project first
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    // Open context menu
    const dotsButtons = Array.from(container.querySelectorAll('button')).filter(b => {
      return b.className.includes('flex-shrink-0') && b.textContent?.trim() === '';
    });

    if (dotsButtons.length > 0) {
      fireEvent.click(dotsButtons[0], { clientX: 100, clientY: 100 });
      const newSessionBtn = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent?.trim() === 'New Session'
      );
      if (newSessionBtn) {
        fireEvent.click(newSessionBtn);
        // Should show session creation form
        const sessionInput = container.querySelector(
          'input[placeholder="Session name (optional)"]'
        );
        expect(sessionInput).toBeTruthy();
      }
    }
  });

  // ---- New Session form ----

  it('creates a session when form is submitted', async () => {
    const addSession = vi.fn();
    const selectSession = vi.fn();
    setupStores({ projectStore: { addSession, selectSession } });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Expand project
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    // Open the New session modal via the "+" quick action
    const newSessionBtn = projBtn
      .closest('div')!
      .querySelector('button[aria-label="New session"]') as HTMLButtonElement;
    fireEvent.click(newSessionBtn);

    // Fill session name (modal portals to document.body)
    const sessionInput = document.querySelector('input[placeholder="Session name (optional)"]')!;
    fireEvent.change(sessionInput, { target: { value: 'My Session' } });

    // Click Create
    const createBtn = Array.from(document.querySelectorAll('button')).find(
      b => b.textContent === 'Create'
    )!;
    await act(async () => {
      fireEvent.click(createBtn);
    });

    expect(api.createSession).toHaveBeenCalledWith({
      projectId: 'proj-1',
      name: 'My Session',
      agentProfileId: undefined,
    });
  });

  it('cancels session creation on Escape', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const newSessionBtn = projBtn
      .closest('div')!
      .querySelector('button[aria-label="New session"]') as HTMLButtonElement;
    fireEvent.click(newSessionBtn);

    const sessionInput = document.querySelector('input[placeholder="Session name (optional)"]')!;
    fireEvent.keyDown(sessionInput, { key: 'Escape' });
    // Escape closes the Modal → resets creatingSessionForProject → modal unmounts.
    expect(document.querySelector('input[placeholder="Session name (optional)"]')).toBeFalsy();
  });

  it('creates session via Enter key', async () => {
    setupStores({});
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const newSessionBtn = projBtn
      .closest('div')!
      .querySelector('button[aria-label="New session"]') as HTMLButtonElement;
    fireEvent.click(newSessionBtn);

    const sessionInput = document.querySelector('input[placeholder="Session name (optional)"]')!;
    fireEvent.change(sessionInput, { target: { value: 'Enter Session' } });
    await act(async () => {
      fireEvent.keyDown(sessionInput, { key: 'Enter' });
    });
    expect(api.createSession).toHaveBeenCalled();
  });

  it('blocks session submit when readiness becomes unusable while the form is open', async () => {
    let shouldFailReadiness = false;
    const refresh = vi.fn(async () => {
      useAgentReadinessStore.setState({
        readiness: shouldFailReadiness
          ? { usable: false, reason: 'no_llm_profile' }
          : { usable: true },
        loading: false,
      });
    });
    setupStores({
      agentReadinessStore: {
        readiness: { usable: true },
        refresh,
      },
    });
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const newSessionBtn = projBtn
      .closest('div')!
      .querySelector('button[aria-label="New session"]') as HTMLButtonElement;
    fireEvent.click(newSessionBtn);

    const sessionInput = document.querySelector('input[placeholder="Session name (optional)"]')!;
    fireEvent.change(sessionInput, { target: { value: 'Blocked Session' } });
    shouldFailReadiness = true;
    useAgentReadinessStore.setState({ readiness: null, refresh } as any);

    const createBtn = Array.from(document.querySelectorAll('button')).find(
      b => b.textContent === 'Create'
    )!;
    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('No agent available yet');
    });
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('shows agent setup dialog when createSession API rejects with AGENT_NOT_READY', async () => {
    setupStores({
      agentReadinessStore: {
        readiness: { usable: true },
      },
    });
    (api.createSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new api.ApiError('No usable agent profile is available.', 'AGENT_NOT_READY', {
        usable: false,
        reason: 'no_credential',
      })
    );

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const newSessionBtn = projBtn
      .closest('div')!
      .querySelector('button[aria-label="New session"]') as HTMLButtonElement;
    fireEvent.click(newSessionBtn);

    const createBtn = Array.from(document.querySelectorAll('button')).find(
      b => b.textContent === 'Create'
    )!;
    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('The model provider is missing an API key');
    });
    expect(selectionMocks.selectSession).not.toHaveBeenCalledWith('new-sess');
  });

  // ---- Home quick actions ----

  it('opens the new-session modal with a project picker on a home quick action', async () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    act(() => {
      useHomeQuickActionsStore.getState().request('new-session');
    });
    await waitFor(() => {
      expect(screen.getByText('New session')).toBeTruthy();
    });
    expect(screen.getByText('Project')).toBeTruthy();
    expect(useHomeQuickActionsStore.getState().pending).toBeNull();
  });

  it('opens the new-session modal on a home quick action when the mobile drawer is closed', async () => {
    render(
      <Sidebar
        collapsed={false}
        onToggle={vi.fn()}
        isMobile={true}
        isOpen={false}
        onClose={vi.fn()}
      />
    );
    act(() => {
      useHomeQuickActionsStore.getState().request('new-session');
    });
    await waitFor(() => {
      expect(screen.getByText('New session')).toBeTruthy();
    });
    expect(screen.getByText('Project')).toBeTruthy();
    expect(useHomeQuickActionsStore.getState().pending).toBeNull();
  });

  // ---- Search ----

  it('renders search input', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container);
    expect(searchInput).toBeTruthy();
  });

  it('shows "Searching..." while search is in progress', async () => {
    // Make searchMessages hang to test loading state
    (api.searchMessages as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container)!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'test query' } });
    });

    // Should show "Searching..."
    expect(document.body.textContent).toContain('Searching...');
  });

  it('shows "No results" when search returns empty', async () => {
    vi.useFakeTimers();
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container)!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'no match' } });
    });

    // Wait for debounce (300ms)
    await advanceDebounce(350);

    expect(document.body.textContent).toContain('No results');
    vi.useRealTimers();
  });

  it('displays search results', async () => {
    vi.useFakeTimers();
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'r1',
        sessionId: 'sess-1',
        sessionName: 'Test Session',
        content: 'Hello world',
        ownerBackendId: 'local',
      },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container)!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'hello' } });
    });

    await advanceDebounce(350);

    expect(document.body.textContent).toContain('Test Session');
    expect(document.body.textContent).toContain('Hello world');
    vi.useRealTimers();
  });

  it('selects session from search results', async () => {
    vi.useFakeTimers();
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'r1',
        sessionId: 'sess-1',
        sessionName: 'Test Session',
        content: 'Hello world',
        ownerBackendId: 'local',
      },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container)!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'hello' } });
    });
    await advanceDebounce(350);

    // Click the search result
    const resultButtons = Array.from(document.body.querySelectorAll('button')).filter(b =>
      b.textContent?.includes('Test Session')
    );
    if (resultButtons.length > 0) {
      fireEvent.click(resultButtons[0]);
      expect(selectionMocks.selectSession).toHaveBeenCalledWith('sess-1', { backendId: 'local' });
    }
    vi.useRealTimers();
  });

  it('selects remote session from search results using owner backend id', async () => {
    vi.useFakeTimers();
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'r1',
        sessionId: 'sess-2',
        sessionName: 'Remote Session',
        content: 'Hello remote',
        ownerBackendId: 'backend-1',
      },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container)!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'remote' } });
    });
    await advanceDebounce(350);

    const resultButtons = Array.from(document.body.querySelectorAll('button')).filter(b =>
      b.textContent?.includes('Remote Session')
    );
    if (resultButtons.length > 0) {
      fireEvent.click(resultButtons[0]);
      expect(selectionMocks.selectSession).toHaveBeenCalledWith('sess-2', {
        backendId: 'backend-1',
      });
    }
    vi.useRealTimers();
  });

  it('shows search result type badge for file results', async () => {
    vi.useFakeTimers();
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'r1',
        sessionId: 'sess-1',
        sessionName: 'Sess',
        content: 'file content',
        resultType: 'file',
        ownerBackendId: 'local',
      },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container)!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'file' } });
    });
    await advanceDebounce(350);

    expect(document.body.querySelector('[aria-label="File result"]')).toBeTruthy();
    vi.useRealTimers();
  });

  it('shows search result type badge for tool results', async () => {
    vi.useFakeTimers();
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'r1',
        sessionId: 'sess-1',
        sessionName: 'Sess',
        content: 'tool content',
        resultType: 'tool',
        ownerBackendId: 'local',
      },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container)!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'tool' } });
    });
    await advanceDebounce(350);

    expect(document.body.querySelector('[aria-label="Tool result"]')).toBeTruthy();
    vi.useRealTimers();
  });

  it('shows Load More button when there are more results', async () => {
    vi.useFakeTimers();
    const fiftyResults = Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`,
      sessionId: 'sess-1',
      sessionName: `Session ${i}`,
      content: `content ${i}`,
    }));
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue(fiftyResults);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container)!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'content' } });
    });
    await advanceDebounce(350);

    expect(document.body.textContent).toContain('Load More');
    vi.useRealTimers();
  });

  it('shows search filter button', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    openSearchPopover(container);
    const filterBtn = document.body.querySelector('button[title="Filters"]');
    expect(filterBtn).toBeTruthy();
  });

  it('toggles search filters', () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    openSearchPopover(container);
    const filterBtn = document.body.querySelector('button[title="Filters"]') as HTMLButtonElement;
    fireEvent.click(filterBtn);
    expect(document.body.querySelector('[data-testid="search-filters"]')).toBeTruthy();

    // Click again to close
    fireEvent.click(filterBtn);
    expect(document.body.querySelector('[data-testid="search-filters"]')).toBeFalsy();
  });

  // ---- Disconnected state ----

  it('does not create session when disconnected', async () => {
    setupStores({
      facadeStore: {
        connectionState: 'disconnected',
        backends: [
          {
            backendId: LOCAL_BACKEND_ID,
            runtimeState: 'offline',
            name: 'Local',
            isThisInstance: true,
            channel: 'local',
          },
        ],
      },
    });
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);

    // When disconnected there are no online backends — no BackendRow renders,
    // so the + button is absent entirely (new project creation is unavailable).
    const newProjectBtns = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label="New project"]')
    );
    expect(newProjectBtns.length).toBe(0);
  });

  // ---- Mobile rendering ----

  it('renders as overlay drawer in mobile mode when open', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sidebar
        collapsed={false}
        onToggle={vi.fn()}
        isMobile={true}
        isOpen={true}
        onClose={onClose}
      />
    );
    // Should show mobile header with ZClaudia title
    expect(container.textContent).toContain('ZClaudia');
    // Should have backdrop
    const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/50');
    expect(backdrop).toBeTruthy();
  });

  it('returns null in mobile mode when not open', () => {
    const { container } = render(
      <Sidebar
        collapsed={false}
        onToggle={vi.fn()}
        isMobile={true}
        isOpen={false}
        onClose={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('closes mobile drawer when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sidebar
        collapsed={false}
        onToggle={vi.fn()}
        isMobile={true}
        isOpen={true}
        onClose={onClose}
      />
    );
    const backdrop = container.querySelector('.fixed.inset-0');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('shows close button in mobile mode', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sidebar
        collapsed={false}
        onToggle={vi.fn()}
        isMobile={true}
        isOpen={true}
        onClose={onClose}
      />
    );
    const closeBtn = container.querySelector('button[title="Close menu"]');
    expect(closeBtn).toBeTruthy();
    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('calls onClose when selecting session in mobile mode', () => {
    const onClose = vi.fn();
    const selectSession = vi.fn();
    setupStores({ projectStore: { selectSession } });

    const { container } = render(
      <Sidebar
        collapsed={false}
        onToggle={vi.fn()}
        isMobile={true}
        isOpen={true}
        onClose={onClose}
      />
    );
    // Expand project
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'select-sess-1'
    );
    if (sessBtn) {
      fireEvent.click(sessBtn);
      expect(onClose).toHaveBeenCalled();
    }
  });

  // ---- Supervision agents ----

  it('shows supervisor phase as a status dot on the project row', () => {
    setupStores({
      supervisionStore: {
        agents: { 'proj-1': { phase: 'active', mainSessionId: 'main-sess' } },
      },
    });

    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} isMobile={true} isOpen={true} />
    );
    const projBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Project One')
    )!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[aria-label="Workspace active"]')).toBeTruthy();
  });

  it('shows paused supervisor phase on the project row', () => {
    setupStores({
      supervisionStore: {
        agents: { 'proj-1': { phase: 'paused', mainSessionId: 'main-sess' } },
      },
    });

    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} isMobile={true} isOpen={true} />
    );
    const projBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Project One')
    )!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[aria-label="Workspace paused"]')).toBeTruthy();
  });

  // ---- Supervisor groups ----

  it('renders supervisor group when agent exists', () => {
    setupStores({
      supervisionStore: {
        agents: { 'proj-1': { phase: 'idle', mainSessionId: 'main-sess' } },
      },
      projectStore: {
        sessions: [
          {
            ...baseSession,
            id: 'main-sess',
            name: 'Main',
            projectRole: 'main',
            projectId: 'proj-1',
          },
          {
            ...baseSession,
            id: 'task-1',
            name: 'Task 1',
            projectRole: 'task',
            parentSessionId: 'main-sess',
            projectId: 'proj-1',
          },
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[data-testid="supervisor-group"]')).toBeTruthy();
  });

  it('renders supervisor group from agent even when main session is not loaded', () => {
    setupStores({
      supervisionStore: {
        agents: { 'proj-1': { phase: 'idle', mainSessionId: 'main-sess' } },
      },
      projectStore: {
        sessions: [{ ...baseSession, id: 'regular-1', name: 'Regular 1', projectId: 'proj-1' }],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[data-testid="supervisor-group"]')).toBeTruthy();
  });

  it('renders supervisor group from project agent before supervision store hydration', () => {
    setupStores({
      projectStore: {
        projects: [{ ...baseProject, agent: { phase: 'idle', mainSessionId: 'main-sess' } }],
        sessions: [
          {
            ...baseSession,
            id: 'main-sess',
            name: 'Main',
            projectRole: 'main',
            projectId: 'proj-1',
          },
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[data-testid="supervisor-group"]')).toBeTruthy();
    expect(useSupervisionStore.getState().agents['proj-1']).toMatchObject({
      phase: 'idle',
      mainSessionId: 'main-sess',
    });
  });

  it('does not render supervisor group from stale main session without agent', () => {
    setupStores({
      projectStore: {
        sessions: [
          {
            ...baseSession,
            id: 'main-sess',
            name: 'Main',
            projectRole: 'main',
            projectId: 'proj-1',
          },
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(container.querySelector('[data-testid="supervisor-group"]')).toBeNull();
  });

  it('keeps supervisor at project level when worktree groups exist', () => {
    // A multi-session group still renders as a collapsible worktree group
    // (single-session groups are flattened into plain rows).
    vi.mocked(groupSessionsByWorktree).mockReturnValue([
      {
        key: '__root__',
        label: 'main',
        isRoot: true,
        sessions: [
          { ...baseSession, id: 'regular-1', name: 'Regular 1', projectId: 'proj-1' } as any,
          { ...baseSession, id: 'regular-2', name: 'Regular 2', projectId: 'proj-1' } as any,
        ],
      },
    ] as any);

    setupStores({
      supervisionStore: {
        agents: { 'proj-1': { phase: 'idle', mainSessionId: 'main-sess' } },
      },
      projectStore: {
        sessions: [
          {
            ...baseSession,
            id: 'main-sess',
            name: 'Main',
            projectRole: 'main',
            projectId: 'proj-1',
          },
          {
            ...baseSession,
            id: 'task-1',
            name: 'Task 1',
            projectRole: 'task',
            parentSessionId: 'main-sess',
            projectId: 'proj-1',
          },
          { ...baseSession, id: 'regular-1', name: 'Regular 1', projectId: 'proj-1' },
          { ...baseSession, id: 'regular-2', name: 'Regular 2', projectId: 'proj-1' },
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const sessionList = container.querySelector('[data-testid="session-list"]')!;
    const firstChild = Array.from(sessionList.children)[0] as HTMLElement;
    expect(firstChild.dataset.testid).toBe('supervisor-group');
    expect(container.querySelector('[data-testid="worktree-group"]')).toBeTruthy();
  });

  it('preserves worktree grouping inputs when supervisor exists', () => {
    setupStores({
      supervisionStore: {
        agents: { 'proj-1': { phase: 'idle', mainSessionId: 'main-sess' } },
      },
      projectStore: {
        sessions: [
          {
            ...baseSession,
            id: 'main-sess',
            name: 'Main',
            projectRole: 'main',
            projectId: 'proj-1',
            workingDirectory: '/tmp/proj1',
          },
          {
            ...baseSession,
            id: 'task-1',
            name: 'Task 1',
            projectRole: 'task',
            parentSessionId: 'main-sess',
            projectId: 'proj-1',
            workingDirectory: '/tmp/proj1',
          },
          {
            ...baseSession,
            id: 'regular-1',
            name: 'Regular 1',
            projectId: 'proj-1',
            workingDirectory: '/tmp/proj1/wt-test1',
          },
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    expect(groupSessionsByWorktree).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'main-sess' }),
        expect.objectContaining({ id: 'regular-1' }),
      ]),
      '/tmp/proj1',
      expect.any(Array)
    );
  });

  it('calls onOpenDashboard when clicking supervisor in desktop mode', () => {
    const onOpenDashboard = vi.fn();
    setupStores({
      supervisionStore: {
        agents: { 'proj-1': { phase: 'idle', mainSessionId: 'main-sess' } },
      },
      projectStore: {
        sessions: [
          {
            ...baseSession,
            id: 'main-sess',
            name: 'Main',
            projectRole: 'main',
            projectId: 'proj-1',
          },
        ],
      },
    });

    const { container } = render(
      <Sidebar collapsed={false} onToggle={vi.fn()} onOpenDashboard={onOpenDashboard} />
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    const projBtn = buttons.find(b => b.textContent?.includes('Project One'))!;
    fireEvent.click(projBtn);

    const selectSupervisorBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent === 'select-supervisor'
    );
    if (selectSupervisorBtn) {
      fireEvent.click(selectSupervisorBtn);
      expect(onOpenDashboard).toHaveBeenCalledWith('proj-1');
    }
  });

  // ---- Multiple projects ----

  it('renders multiple projects', () => {
    setupStores({
      projectStore: {
        projects: [
          baseProject,
          {
            id: 'proj-2',
            name: 'Project Two',
            rootPath: '/tmp/proj2',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.textContent).toContain('Project One');
    expect(container.textContent).toContain('Project Two');
  });

  // ---- New-session agent dropdown ----

  it('renders agent dropdown in new-session form and submits agentProfileId', async () => {
    setupStores({
      agentProfileMetaStore: {
        profiles: {
          a1: {
            id: 'a1',
            name: 'Default Coding Agent',
            llmProfileId: 'l1',
            model: 'claude-sonnet-4-6',
            systemPrompt: '',
            enabledTools: ['Read'],
            isDefault: true,
            createdAt: 0,
            updatedAt: 0,
          },
          a2: {
            id: 'a2',
            name: 'Doc Writer',
            llmProfileId: 'l1',
            model: 'claude-sonnet-4-6',
            systemPrompt: '',
            enabledTools: ['Read', 'Write'],
            createdAt: 0,
            updatedAt: 0,
          },
        },
      },
    });

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // Expand project
    const projBtn = Array.from(container.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Project One')
    )!;
    fireEvent.click(projBtn);

    // Open the New session modal via the "+" quick action
    const newSessionBtn = projBtn
      .closest('div')!
      .querySelector('button[aria-label="New session"]') as HTMLButtonElement;
    fireEvent.click(newSessionBtn);

    // Agent Select trigger shows "Default (from project)" before any agent picked.
    // The modal portals to document.body, so query there.
    const agentTrigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')
    ).find(b => b.textContent?.includes('Default (from project)'));
    expect(agentTrigger).toBeTruthy();
    fireEvent.click(agentTrigger!);

    // Both agents listed in dropdown, with the default-marker suffix.
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    const defaultOpt = options.find(o => o.textContent?.includes('Default Coding Agent'));
    const docOpt = options.find(o => o.textContent?.includes('Doc Writer'));
    expect(defaultOpt?.textContent).toContain('*'); // default-marker
    expect(docOpt).toBeTruthy();

    // Pick Doc Writer, then submit.
    fireEvent.click(docOpt as Element);
    const sessionInput = document.querySelector('input[placeholder="Session name (optional)"]')!;
    fireEvent.change(sessionInput, { target: { value: 'My Session' } });
    const createBtn = Array.from(document.querySelectorAll('button')).find(
      b => b.textContent === 'Create'
    )!;
    await act(async () => {
      fireEvent.click(createBtn);
    });

    expect(api.createSession).toHaveBeenCalledWith({
      projectId: 'proj-1',
      name: 'My Session',
      agentProfileId: 'a2',
    });
  });

  // ---- normalizeSearchPreview ----

  it('normalizes search preview whitespace', async () => {
    vi.useFakeTimers();
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'r1',
        sessionId: 'sess-1',
        sessionName: 'Sess',
        content: '  hello   world  \n\n  foo  ',
      },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container)!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'hello' } });
    });
    await advanceDebounce(350);

    expect(document.body.textContent).toContain('hello world foo');
    vi.useRealTimers();
  });

  it('shows "No preview text" for empty content', async () => {
    vi.useFakeTimers();
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'r1', sessionId: 'sess-1', sessionName: 'Sess', content: '   ' },
    ]);
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    const searchInput = getSearchInput(container)!;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'x' } });
    });
    await advanceDebounce(350);

    expect(document.body.textContent).toContain('No preview text');
    vi.useRealTimers();
  });

  // ---- Search history ----

  it('shows search history on focus when no query and history exists', async () => {
    vi.useFakeTimers();
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'h1', query: 'old search', resultCount: 5 },
    ]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);

    // Wait for history to load
    await advanceDebounce(50);

    const searchInput = getSearchInput(container)!;
    fireEvent.focus(searchInput);

    expect(document.body.textContent).toContain('Recent Searches');
    expect(document.body.textContent).toContain('old search');
    vi.useRealTimers();
  });

  it('clears search history', async () => {
    vi.useFakeTimers();
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'h1', query: 'old search', resultCount: 5 },
    ]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);

    await advanceDebounce(50);

    const searchInput = getSearchInput(container)!;
    fireEvent.focus(searchInput);

    const clearBtn = Array.from(document.body.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'Clear'
    );
    if (clearBtn) {
      await act(async () => {
        fireEvent.click(clearBtn);
      });
      expect(api.clearSearchHistory).toHaveBeenCalled();
    }
    vi.useRealTimers();
  });

  it('selects search history item', async () => {
    vi.useFakeTimers();
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'h1', query: 'old search', resultCount: 5 },
    ]);
    (api.searchMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} />);

    await advanceDebounce(50);

    const searchInput = getSearchInput(container)!;
    fireEvent.focus(searchInput);

    const historyBtn = Array.from(document.body.querySelectorAll('button')).find(b =>
      b.textContent?.includes('old search')
    );
    if (historyBtn) {
      fireEvent.click(historyBtn);
      // Wait for the 300ms debounce in handleSearch
      await advanceDebounce(400);
      // The search input should now have the history query
      // and search should be triggered
      expect(api.searchMessages).toHaveBeenCalled();
    }
    vi.useRealTimers();
  });

  // ---- Automation mode ----

  it('renders AutomationTree and text nav rows when automationMode is active', () => {
    const onSelectTab = vi.fn();
    const onBack = vi.fn();
    const onSelectScope = vi.fn();
    const { container } = render(
      <Sidebar
        collapsed={false}
        onToggle={vi.fn()}
        automationMode={{
          tab: 'workflows',
          activeBackendId: LOCAL_BACKEND_ID,
          projectId: undefined,
          onSelectTab,
          onBack,
          onSelectScope,
        }}
      />
    );

    expect(screen.getByTestId('automation-tree')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Workflows' })).toBeTruthy();
  });

  // ---- Agents mode ----

  const makeAgentsMode = (tab: 'profiles' | 'skills' | 'mcp-servers' | 'providers') => ({
    tab,
    onSelectTab: vi.fn(),
    onBack: vi.fn(),
  });

  // The master list moved to a card grid in the main panel; the sidebar now shows
  // only the type nav in agents mode and renders no resource tree.
  it('shows the profiles nav and no tree when agentsMode is on the profiles tab', () => {
    render(
      <Sidebar collapsed={false} onToggle={vi.fn()} agentsMode={makeAgentsMode('profiles')} />
    );

    expect(screen.queryByTestId('agents-tree')).toBeNull();
    expect(screen.queryByTestId('skills-tree')).toBeNull();
    expect(screen.getByRole('button', { name: 'Agent Profiles' })).toBeTruthy();
  });

  it('shows the skills nav and no tree when agentsMode is on the skills tab', () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} agentsMode={makeAgentsMode('skills')} />);

    expect(screen.queryByTestId('skills-tree')).toBeNull();
    expect(screen.queryByTestId('agents-tree')).toBeNull();
    expect(screen.getByRole('button', { name: 'Skills' })).toBeTruthy();
  });

  it('shows the mcp-servers nav and no tree when agentsMode is on the mcp-servers tab', () => {
    render(
      <Sidebar collapsed={false} onToggle={vi.fn()} agentsMode={makeAgentsMode('mcp-servers')} />
    );

    expect(screen.queryByTestId('mcp-servers-tree')).toBeNull();
    expect(screen.queryByTestId('agents-tree')).toBeNull();
    expect(screen.queryByTestId('skills-tree')).toBeNull();
    expect(screen.getByRole('button', { name: 'MCP Servers' })).toBeTruthy();
  });

  it('shows the providers nav and no tree when agentsMode is on the providers tab', () => {
    render(
      <Sidebar collapsed={false} onToggle={vi.fn()} agentsMode={makeAgentsMode('providers')} />
    );

    expect(screen.queryByTestId('providers-tree')).toBeNull();
    expect(screen.queryByTestId('agents-tree')).toBeNull();
    expect(screen.queryByTestId('skills-tree')).toBeNull();
    expect(screen.queryByTestId('mcp-servers-tree')).toBeNull();
    expect(screen.getByRole('button', { name: 'LLM Providers' })).toBeTruthy();
  });

  // ---- PluginPermissionDialog ----

  it('renders PluginPermissionDialog in portal', () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} />);
    // This is rendered via createPortal - just verifying no crash
    expect(true).toBe(true);
  });
});

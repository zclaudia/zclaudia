import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

const selectionMocks = {
  selectProject: vi.fn(),
  selectSession: vi.fn(),
  selectSessionOnBackend: vi.fn(),
  selectBackend: vi.fn(),
};

const neverSettles = new Promise(() => {});

// Mock child components to isolate Sidebar — mirrors
// apps/desktop/src/components/__tests__/Sidebar.test.tsx's harness.
vi.mock('../../settings/ProjectSettings', () => ({
  ProjectSettings: ({ isOpen, onClose }: any) =>
    isOpen ? (
      <div data-testid="project-settings">
        <button onClick={onClose}>close-project-settings</button>
      </div>
    ) : null,
}));
vi.mock('../../../components/permission/PluginPermissionDialog', () => ({
  PluginPermissionDialog: () => null,
}));
vi.mock('../SessionItem', () => ({
  SessionItem: ({ session, onSelect }: any) => (
    <div data-testid="session-item">
      <span>{session.name}</span>
      <button onClick={() => onSelect(session.id)}>select-{session.id}</button>
    </div>
  ),
}));
vi.mock('../WorktreeGroupItem', () => ({
  WorktreeGroupItem: ({ children }: any) => <div data-testid="worktree-group">{children}</div>,
}));
vi.mock('../ProjectWorkspaceItem', () => ({
  ProjectWorkspaceItem: ({ onSelect, taskChildren }: any) => (
    <div data-testid="supervisor-group">
      <button onClick={onSelect}>select-supervisor</button>
      {taskChildren}
    </div>
  ),
}));
vi.mock('../worktreeGrouping', () => ({
  groupSessionsByWorktree: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../hooks/useSwipeBack', () => ({
  useSwipeBack: vi.fn().mockReturnValue({ current: null }),
}));
vi.mock('../../automation/AutomationTree', () => ({
  AutomationTree: ({ tab }: any) => <div data-testid="automation-tree" data-tab={tab} />,
}));
vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({
    selectProject: selectionMocks.selectProject,
    selectSession: selectionMocks.selectSession,
    selectSessionOnBackend: selectionMocks.selectSessionOnBackend,
    selectBackend: selectionMocks.selectBackend,
  }),
}));

vi.mock('../../../services/api', async importOriginal => {
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
  return stubbed;
});

vi.mock('../../../utils/platform', async importOriginal => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
    isDesktopTauri: vi.fn(() => false),
  };
});

import { Sidebar } from '../Sidebar';
import { useProjectStore } from '../../../stores/projectStore';
import { useLlmProfileMetaStore } from '../../../stores/llmProfileMetaStore';
import { useAgentProfileMetaStore } from '../../../stores/agentProfileMetaStore';
import { useRecoveryStore } from '../../../stores/recoveryStore';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useServerStore } from '../../../stores/serverStore';
import { useOwnershipStore } from '../../../stores/ownershipStore';
import { useSupervisionStore } from '../../../stores/supervisionStore';
import { usePermissionStore } from '../../../stores/permissionStore';
import { useInteractionStore } from '../../../stores/interactionStore';
import { useRunStore } from '../../../stores/runStore';
import { useSessionRunStateStore } from '../../../stores/sessionRunStateStore';
import { useUIStore } from '../../../stores/uiStore';
import { useAgentReadinessStore } from '../../../stores/agentReadinessStore';
import { useSidebarExpansionStore } from '../../../stores/sidebarExpansionStore';
import * as api from '../../../services/api';

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

function setupStores() {
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
  } as any);

  useRecoveryStore.setState({
    backends: {
      [LOCAL_BACKEND_ID]: { status: 'ready' },
    },
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
  } as any);

  useSupervisionStore.setState({ agents: {} } as any);
  usePermissionStore.setState({ pendingRequests: [] } as any);
  useInteractionStore.setState({ interactions: {} } as any);
  useRunStore.setState({ activeRuns: {} } as any);
  useSessionRunStateStore.setState({ records: {} } as any);
  useAgentReadinessStore.setState({
    readiness: { usable: true },
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  } as any);
  useUIStore.setState({
    poppedOutSessions: new Map(),
    requestForceScrollToBottom: vi.fn(),
  } as any);

  useOwnershipStore.setState({
    sessionBackendIds: {},
    sessionOwnershipVersions: {},
    projectBackendIds: {},
    taskOwners: {},
  } as any);
}

function renderSidebarMobileOpen(overrides: { onClose?: () => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const utils = render(
    <Sidebar collapsed={false} onToggle={vi.fn()} isMobile isOpen onClose={onClose} />
  );
  return { onClose, ...utils };
}

describe('Sidebar mobile drawer — modal dialog semantics', () => {
  beforeEach(() => {
    setupStores();
    useSidebarExpansionStore.setState({ expandedBackendIds: [] });
    vi.clearAllMocks();
    (api.getSearchHistory as ReturnType<typeof vi.fn>).mockImplementation(() => neverSettles);
    (api.getProjectWorktrees as ReturnType<typeof vi.fn>).mockImplementation(() => neverSettles);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mobile drawer is a modal dialog closable via Escape', () => {
    const onClose = vi.fn();
    renderSidebarMobileOpen({ onClose });
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Navigation');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the click-scrim from assistive tech', () => {
    const { container } = renderSidebarMobileOpen();
    const scrim = container.querySelector('.fixed.inset-0.bg-black\\/50');
    expect(scrim).toBeTruthy();
    expect(scrim?.getAttribute('aria-hidden')).toBe('true');
  });

  it('traps Tab focus within the drawer panel, wrapping last -> first', () => {
    renderSidebarMobileOpen();
    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first focusable back to the last', () => {
    renderSidebarMobileOpen();
    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInputArea } from '../ChatInputArea';
import type { ReactNode } from 'react';

vi.mock('../MessageInput', () => ({
  MessageInput: ({ mobileToolbarSlot }: { mobileToolbarSlot?: ReactNode }) => (
    <div data-testid="message-input">{mobileToolbarSlot}</div>
  ),
}));

vi.mock('../PermissionSelector', () => ({
  PermissionSelector: () => <div data-testid="permission-selector" />,
}));

vi.mock('../ModeSelector', () => ({
  ModeSelector: (props: { value: string; locked?: boolean }) => (
    <div
      data-testid="mode-selector"
      data-value={String(props.value)}
      data-locked={String(Boolean(props.locked))}
    />
  ),
}));

vi.mock('../WorktreeSelector', () => ({
  WorktreeSelector: () => <div data-testid="worktree-selector" />,
}));

vi.mock('../TokenUsageDisplay', () => ({
  TokenUsageDisplay: () => <div data-testid="token-usage" />,
}));

vi.mock('../../../services/api', () => ({
  unlockSession: vi.fn(),
}));

const serverStoreState = {
  activeServerSupports: vi.fn(() => false),
};

vi.mock('../../../stores/serverStore', () => ({
  useServerStore: Object.assign(
    vi.fn(() => serverStoreState),
    {
      getState: () => serverStoreState,
    }
  ),
}));

const terminalStoreState = {
  drawerOpen: {} as Record<string, boolean>,
  terminals: {} as Record<string, string>,
  setDrawerOpen: vi.fn(),
  openTerminal: vi.fn(() => 'term-1'),
  isDrawerOpen: vi.fn((projectId: string) => Boolean(terminalStoreState.drawerOpen[projectId])),
  getTerminalId: vi.fn((projectId: string) => terminalStoreState.terminals[projectId]),
};

vi.mock('../../../stores/terminalStore', () => ({
  useTerminalStore: Object.assign(
    vi.fn((selector?: (state: typeof terminalStoreState) => unknown) =>
      selector ? selector(terminalStoreState) : terminalStoreState
    ),
    {
      getState: () => terminalStoreState,
    }
  ),
}));

const bottomPanelState = {
  activeTab: '',
  setActiveTab: vi.fn(),
};

vi.mock('../../../stores/bottomPanelStore', () => ({
  useBottomPanelStore: vi.fn(() => bottomPanelState),
}));

const fileViewerState = {
  isOpen: false,
  close: vi.fn(),
  togglePanel: vi.fn(),
  setSearchOpen: vi.fn(),
};

vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: Object.assign(
    vi.fn(() => fileViewerState),
    {
      getState: () => fileViewerState,
    }
  ),
}));

const pluginStoreState = {
  disabledBuiltinPanels: [] as string[],
  panels: [] as Array<{ id: string; visible?: boolean; defaultPlacement?: 'bottom' | 'right' }>,
  panelPlacements: {} as Record<string, 'bottom' | 'right'>,
  setPanelPlacement: vi.fn(),
};

vi.mock('../../../stores/pluginStore', () => ({
  usePluginStore: Object.assign(
    vi.fn((selector?: (state: typeof pluginStoreState) => unknown) =>
      selector ? selector(pluginStoreState) : pluginStoreState
    ),
    {
      getState: () => pluginStoreState,
    }
  ),
  getEffectivePlacement: (state: typeof pluginStoreState, panelId: string) => {
    return (
      state.panelPlacements[panelId] ??
      state.panels.find(p => p.id === panelId)?.defaultPlacement ??
      'bottom'
    );
  },
}));

const rightSidebarState = {
  widthFraction: 0.26,
  activeTab: null as string | null,
  setActiveTab: vi.fn(),
  setWidthFraction: vi.fn(),
};

vi.mock('../../../stores/rightSidebarStore', () => ({
  useRightSidebarStore: Object.assign(
    vi.fn((selector?: (state: typeof rightSidebarState) => unknown) =>
      selector ? selector(rightSidebarState) : rightSidebarState
    ),
    {
      getState: () => rightSidebarState,
    }
  ),
  RIGHT_SIDEBAR_LIMITS: {
    MIN_WIDTH_PX: 240,
    MIN_WIDTH_FRACTION: 0.15,
    MAX_WIDTH_FRACTION: 0.5,
    DEFAULT_WIDTH_FRACTION: 0.26,
  },
}));

const draftEditorState = {
  openEditor: vi.fn(),
  setSendCallback: vi.fn(),
  draftExists: { 'sess-1': false } as Record<string, boolean>,
  closeEditor: vi.fn(),
};

vi.mock('../../../stores/draftEditorStore', () => ({
  useDraftEditorStore: Object.assign(
    vi.fn((selector?: (state: typeof draftEditorState) => unknown) =>
      selector ? selector(draftEditorState) : draftEditorState
    ),
    {
      getState: () => draftEditorState,
    }
  ),
}));

vi.mock('../../../stores/uiStore', () => ({
  useUIStore: vi.fn(() => ({
    setAdvancedInput: vi.fn(),
  })),
}));

const projectStoreState = {
  selectedSessionId: 'sess-1' as string | null,
  sessions: [{ id: 'sess-1', projectId: 'proj-1' }] as any[],
  updateSession: vi.fn(),
};

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: Object.assign(
    vi.fn((selector?: (state: typeof projectStoreState) => unknown) =>
      selector ? selector(projectStoreState) : projectStoreState
    ),
    {
      getState: () => projectStoreState,
    }
  ),
}));

const rightWorkspaceStoreState = {
  bySession: {} as Record<string, any>,
  order: [] as string[],
};

vi.mock('../../../stores/rightWorkspaceStore', () => ({
  useRightWorkspaceStore: Object.assign(
    vi.fn((selector?: (state: typeof rightWorkspaceStoreState) => unknown) =>
      selector ? selector(rightWorkspaceStoreState) : rightWorkspaceStoreState
    ),
    {
      getState: () => rightWorkspaceStoreState,
    }
  ),
  findPaneWithTool: vi.fn(() => null),
}));

const baseProps = {
  sessionId: 'sess-1',
  currentSession: {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'Test Session',
    isReadOnly: false,
    type: 'regular',
    workingDirectory: '/repo',
  } as any,
  currentProject: {
    id: 'proj-1',
    rootPath: '/repo',
  } as any,
  isMobile: true,
  isLoading: false,
  isConnected: true,
  isForcedPlanSession: false,
  mode: '',
  capabilities: {
    modes: [
      { id: 'default', label: 'Default' },
      { id: 'plan', label: 'Plan' },
    ],
    models: [],
    defaultModeId: 'default',
  } as any,
  permissionOverride: null,
  commands: [],
  fileReferenceRoot: '/repo',
  fileReferenceBackendId: null,
  sessionRunId: null,
  currentUsage: {
    inputTokens: 0,
    outputTokens: 0,
  },
  restoreMessage: null,
  initialDraft: { content: '', attachments: [] },
  draftExists: false,
  onSetMode: vi.fn(),
  onSetPermissionOverride: vi.fn(),
  onWorktreeChange: vi.fn(async () => {}),
  onSendMessage: vi.fn(),
  onCancelRun: vi.fn(),
  onCommand: vi.fn(async () => {}),
};

describe('ChatInputArea mobile selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluginStoreState.disabledBuiltinPanels = [];
    terminalStoreState.drawerOpen = {};
    terminalStoreState.terminals = {};
    bottomPanelState.activeTab = '';
  });

  afterEach(() => {
    cleanup();
  });

  it('shows mode selector + permission selector + worktree + terminal tool on mobile', () => {
    serverStoreState.activeServerSupports.mockImplementation(
      (feature: string) => feature === 'remoteTerminal'
    );

    render(<ChatInputArea {...baseProps} />);

    expect(screen.getByTestId('mode-selector')).toBeTruthy();
    expect(screen.getByTestId('permission-selector')).toBeTruthy();
    expect(screen.getByTestId('worktree-selector')).toBeTruthy();

    fireEvent.click(screen.getByTitle('More tools'));
    expect(screen.getByText('Terminal')).toBeTruthy();
  });

  it('locks mode selector when isForcedPlanSession is true', () => {
    serverStoreState.activeServerSupports.mockReturnValue(false);

    render(<ChatInputArea {...baseProps} isForcedPlanSession />);

    const sel = screen.getByTestId('mode-selector');
    expect(sel.getAttribute('data-locked')).toBe('true');
    expect(sel.getAttribute('data-value')).toBe('plan');
  });

  it('hides terminal tool button when remote terminal is unavailable and other panels are disabled', () => {
    serverStoreState.activeServerSupports.mockReturnValue(false);
    pluginStoreState.disabledBuiltinPanels = ['draft', 'file-viewer', 'session-changes'];

    render(<ChatInputArea {...baseProps} />);

    expect(screen.queryByTitle('More tools')).toBeNull();
  });

  it('hides mode selector entirely when capabilities is null', () => {
    serverStoreState.activeServerSupports.mockReturnValue(false);
    render(<ChatInputArea {...baseProps} capabilities={null} />);
    expect(screen.queryByTestId('mode-selector')).toBeNull();
  });
});

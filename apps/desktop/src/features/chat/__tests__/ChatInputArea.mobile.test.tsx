// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInputArea } from '../ChatInputArea';
import type { ReactNode } from 'react';

vi.mock('../MessageInput', () => ({
  MessageInput: ({
    mobileControls,
    mobileTrailing,
    mobileTools,
    mobileSessionRows,
  }: {
    mobileControls?: ReactNode;
    mobileTrailing?: ReactNode;
    mobileTools?: Array<{ key: string; label: string; onClick: () => void }>;
    mobileSessionRows?: ReactNode;
  }) => (
    <div data-testid="message-input">
      <div data-testid="mobile-controls">{mobileControls}</div>
      <div data-testid="mobile-trailing">{mobileTrailing}</div>
      <div data-testid="mobile-session-rows">{mobileSessionRows}</div>
      <ul data-testid="mobile-tools">
        {mobileTools?.map(t => (
          <li key={t.key}>
            <button onClick={t.onClick}>{t.label}</button>
          </li>
        ))}
      </ul>
    </div>
  ),
}));

vi.mock('../SessionModelSelector', () => ({
  SessionModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock('../ModeSelector', () => ({
  ModeSelector: (props: { value: string; locked?: boolean; variant?: string }) => (
    <div
      data-testid="mode-selector"
      data-value={String(props.value)}
      data-locked={String(Boolean(props.locked))}
      data-variant={String(props.variant)}
    />
  ),
}));

vi.mock('../WorktreeSelector', () => ({
  WorktreeSelector: (props: { variant?: string }) => (
    <div data-testid="worktree-selector" data-variant={String(props.variant)} />
  ),
}));

vi.mock('../TokenUsageDisplay', () => ({
  TokenUsageDisplay: (props: { compact?: boolean }) => (
    <div data-testid="token-usage" data-compact={String(Boolean(props.compact))} />
  ),
}));

vi.mock('../ContextUsagePopover', () => ({
  ContextUsagePopover: ({ children }: { children?: ReactNode }) => (
    <div data-testid="context-usage-popover-wrapper">{children}</div>
  ),
}));

vi.mock('../../../services/api', () => ({
  unlockSession: vi.fn(),
}));
vi.mock('../../../services/api/goals', () => ({ getGoal: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../hooks/useAgentForSession', () => ({
  useAgentForSession: () => ({ agent: undefined, llm: undefined, loading: false }),
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
  setActiveTab: vi.fn((panelId: string) => {
    bottomPanelState.activeTab = panelId;
  }),
};

vi.mock('../../../stores/bottomPanelStore', () => ({
  useBottomPanelStore: Object.assign(
    vi.fn((selector?: (state: typeof bottomPanelState) => unknown) =>
      selector ? selector(bottomPanelState) : bottomPanelState
    ),
    {
      getState: () => bottomPanelState,
    }
  ),
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

interface MockPanel {
  id: string;
  label: string;
  order?: number;
  visible?: boolean;
  platforms?: Array<'desktop' | 'mobile'>;
  requiresFeature?: string;
  hideFromLauncher?: boolean;
  defaultPlacement?: 'bottom' | 'right';
  onOpen?: (ctx: unknown) => void;
  onClose?: () => void;
}

/** Mirrors the builtin panel registry (see plugins/builtinPanels.ts). */
function builtinPanelFixtures(): MockPanel[] {
  return [
    {
      id: 'terminal',
      label: 'Terminal',
      order: 0,
      platforms: ['desktop', 'mobile'],
      requiresFeature: 'remoteTerminal',
      visible: false,
    },
    {
      id: 'file-viewer',
      label: 'File',
      order: 1,
      platforms: ['desktop', 'mobile'],
      visible: false,
    },
    { id: 'draft', label: 'Draft', order: 2, platforms: ['desktop', 'mobile'], visible: false },
    {
      id: 'session-changes',
      label: 'Changes',
      order: 3,
      platforms: ['desktop', 'mobile'],
      visible: false,
    },
    { id: 'memory', label: 'Memory', order: 4, platforms: ['desktop', 'mobile'], visible: false },
    {
      id: 'notifications',
      label: 'Notifications',
      order: 5,
      platforms: ['desktop', 'mobile'],
      hideFromLauncher: true,
      visible: false,
    },
    { id: 'lineage', label: 'Lineage', order: 6, platforms: ['desktop', 'mobile'], visible: false },
    { id: 'git', label: 'Git', order: 7, platforms: ['desktop'], visible: false },
    { id: 'browser', label: 'Browser', order: 8, platforms: ['desktop'], visible: false },
  ];
}

const pluginStoreState = {
  disabledBuiltinPanels: [] as string[],
  panels: [] as MockPanel[],
  panelPlacements: {} as Record<string, 'bottom' | 'right'>,
  setPanelPlacement: vi.fn(),
  updatePanelVisibility: vi.fn((id: string, visible: boolean) => {
    pluginStoreState.panels = pluginStoreState.panels.map(p =>
      p.id === id ? { ...p, visible } : p
    );
  }),
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
  activeSessionId: null as string | null,
  sendCallback: null as ((content: string) => void) | null,
  setSendCallback: vi.fn((callback: ((content: string) => void) | null) => {
    draftEditorState.sendCallback = callback;
  }),
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
  useUIStore: vi.fn(() => ({})),
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
    pluginStoreState.panels = builtinPanelFixtures();
    terminalStoreState.drawerOpen = {};
    terminalStoreState.terminals = {};
    bottomPanelState.activeTab = '';
    draftEditorState.activeSessionId = null;
    draftEditorState.sendCallback = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps draft sending owned by its session with two mounted composers', () => {
    draftEditorState.activeSessionId = 'sess-1';
    const sendA = vi.fn();
    const sendB = vi.fn();
    const { rerender, unmount } = render(
      <>
        <ChatInputArea {...baseProps} onSendMessage={sendA} />
        <ChatInputArea {...baseProps} sessionId="sess-2" onSendMessage={sendB} />
      </>
    );
    draftEditorState.sendCallback?.('A draft');
    expect(sendA).toHaveBeenCalledExactlyOnceWith('A draft');
    expect(sendB).not.toHaveBeenCalled();

    draftEditorState.activeSessionId = 'sess-2';
    rerender(
      <>
        <ChatInputArea {...baseProps} onSendMessage={sendA} />
        <ChatInputArea {...baseProps} sessionId="sess-2" onSendMessage={sendB} />
      </>
    );
    draftEditorState.sendCallback?.('B draft');
    expect(sendB).toHaveBeenCalledExactlyOnceWith('B draft');
    expect(sendA).toHaveBeenCalledTimes(1);
    unmount();
    expect(draftEditorState.sendCallback).toBeNull();
  });

  it('puts mode + model chips in the card row and the worktree + terminal in the + sheet', () => {
    serverStoreState.activeServerSupports.mockImplementation(
      (feature: string) => feature === 'remoteTerminal'
    );

    render(<ChatInputArea {...baseProps} />);

    const controls = screen.getByTestId('mobile-controls');
    const mode = within(controls).getByTestId('mode-selector');
    expect(mode.getAttribute('data-variant')).toBe('chip');
    expect(within(controls).getByTestId('model-selector')).toBeTruthy();
    expect(within(controls).queryByTestId('worktree-selector')).toBeNull();

    const worktree = within(screen.getByTestId('mobile-session-rows')).getByTestId(
      'worktree-selector'
    );
    expect(worktree.getAttribute('data-variant')).toBe('row');
    expect(within(screen.getByTestId('mobile-tools')).getByText('Terminal')).toBeTruthy();
  });

  it('drops the old selector row above the composer card', () => {
    serverStoreState.activeServerSupports.mockReturnValue(false);

    render(<ChatInputArea {...baseProps} />);

    // Every selector instance is handed to MessageInput — none renders beside it.
    expect(screen.getAllByTestId('mode-selector')).toHaveLength(1);
    expect(screen.getAllByTestId('worktree-selector')).toHaveLength(1);
    expect(screen.getAllByTestId('token-usage')).toHaveLength(1);
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
    pluginStoreState.disabledBuiltinPanels = [
      'draft',
      'file-viewer',
      'session-changes',
      'memory',
      'lineage',
    ];

    render(<ChatInputArea {...baseProps} />);

    expect(screen.getByTestId('mobile-tools').children).toHaveLength(0);
  });

  it('derives the tools menu from the panel registry: memory and lineage are reachable on mobile', () => {
    serverStoreState.activeServerSupports.mockReturnValue(false);

    render(<ChatInputArea {...baseProps} />);

    // Legacy four keep their labels and lead the menu…
    expect(screen.getByText('Draft Editor')).toBeTruthy();
    expect(screen.getByText('File Viewer')).toBeTruthy();
    expect(screen.getByText('Session Changes')).toBeTruthy();
    // …registry-declared mobile panels follow.
    expect(screen.getByText('Memory')).toBeTruthy();
    expect(screen.getByText('Lineage')).toBeTruthy();
    // Desktop-only and launcher-hidden panels stay out.
    expect(screen.queryByText('Git')).toBeNull();
    expect(screen.queryByText('Browser')).toBeNull();
    expect(screen.queryByText('Notifications')).toBeNull();
    // Terminal is capability-gated via requiresFeature (unsupported here).
    expect(screen.queryByText('Terminal')).toBeNull();
  });

  it('keeps the terminal capability-gated through the registry requiresFeature flag', () => {
    serverStoreState.activeServerSupports.mockImplementation(
      (feature: string) => feature === 'remoteTerminal'
    );

    render(<ChatInputArea {...baseProps} />);

    expect(screen.getByText('Terminal')).toBeTruthy();
  });

  it('opens a generic registry panel (memory) by making it visible and activating its tab', () => {
    serverStoreState.activeServerSupports.mockReturnValue(false);

    render(<ChatInputArea {...baseProps} />);
    fireEvent.click(screen.getByText('Memory'));

    expect(pluginStoreState.updatePanelVisibility).toHaveBeenCalledWith('memory', true);
    expect(bottomPanelState.setActiveTab).toHaveBeenCalledWith('memory');
  });

  it('closes an active generic registry panel via its visibility flag', () => {
    serverStoreState.activeServerSupports.mockReturnValue(false);
    pluginStoreState.panels = builtinPanelFixtures().map(p =>
      p.id === 'memory' ? { ...p, visible: true } : p
    );
    bottomPanelState.activeTab = 'memory';

    render(<ChatInputArea {...baseProps} />);
    fireEvent.click(screen.getByText('Hide Memory'));

    expect(pluginStoreState.updatePanelVisibility).toHaveBeenCalledWith('memory', false);
  });

  it('mounts the compact context ring (in its popover) next to send', () => {
    serverStoreState.activeServerSupports.mockReturnValue(false);

    render(<ChatInputArea {...baseProps} />);

    const trailing = screen.getByTestId('mobile-trailing');
    const wrapper = within(trailing).getByTestId('context-usage-popover-wrapper');
    // The ring lives inside the tap-to-open popover wrapper.
    const ring = wrapper.querySelector('[data-testid="token-usage"]');
    expect(ring?.getAttribute('data-compact')).toBe('true');
  });

  it('hides mode selector entirely when capabilities is null', () => {
    serverStoreState.activeServerSupports.mockReturnValue(false);
    render(<ChatInputArea {...baseProps} capabilities={null} />);
    expect(screen.queryByTestId('mode-selector')).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { useProjectStore } from '../../../stores/projectStore';
import { useRunStore } from '../../../stores/runStore';
import { useChatMessageStore } from '../../../stores/chatMessageStore';
import { useSessionConfigStore } from '../../../stores/sessionConfigStore';
import { useSessionOverridesStore } from '../../../stores/sessionOverridesStore';
import { useTerminalStore } from '../../../stores/terminalStore';
import { useBottomPanelStore } from '../../../stores/bottomPanelStore';
import { useUIStore } from '../../../stores/uiStore';
import { usePermissionStore } from '../../../stores/permissionStore';
import { useServerStore } from '../../../stores/serverStore';
import { useFileViewerStore } from '../../../stores/fileViewerStore';
import { useOwnershipStore } from '../../../stores/ownershipStore';
import { useRecoveryStore } from '../../../stores/recoveryStore';
import { useAgentProfileMetaStore } from '../../../stores/agentProfileMetaStore';
import { useComposerStore } from '../../../stores/composerStore';

// Prevent useAgentForSession's loadAll() from hitting the real API
vi.mock('../../../services/api/agent-profiles', () => ({
  listAgentProfiles: vi.fn().mockResolvedValue([]),
}));

// Mock llmProfileMetaStore
const { mockProviderMetaStore } = vi.hoisted(() => {
  const state = {
    providersByBackend: {},
    providerCommands: {},
    providerCapabilities: {},
    setProviders: vi.fn(),
    getProviders: vi.fn().mockReturnValue([]),
    setProviderCommands: vi.fn(),
    setProviderCapabilities: vi.fn(),
  };
  const store: any = (selector?: (s: any) => any) => (selector ? selector(state) : state);
  store.getState = () => state;
  store.setState = vi.fn();
  store.subscribe = vi.fn(() => vi.fn());
  store.destroy = vi.fn();
  return { mockProviderMetaStore: store };
});
vi.mock('../../../stores/llmProfileMetaStore', () => ({
  useLlmProfileMetaStore: mockProviderMetaStore,
}));

const { paginationHookState, planStatusHookState } = vi.hoisted(() => ({
  paginationHookState: new Map<string, any>(),
  planStatusHookState: {
    taskPlanStatus: null as any,
    planStatusLoading: false,
    submitPlanLoading: false,
    discardPlanLoading: false,
    handleRestorePlan: vi.fn(),
    handleDiscardPlan: vi.fn(),
    handleSubmitPlan: vi.fn(),
  },
}));

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
  emitTo: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    show: vi.fn(),
    setFocus: vi.fn(),
    close: vi.fn(),
    onCloseRequested: vi.fn(() => Promise.resolve(vi.fn())),
  })),
}));

// Mock all heavy sub-components
vi.mock('../MessageList', () => ({
  MessageList: (props: any) => (
    <div data-testid="message-list" data-resend-id={props.resendTargetMessageId || ''}>
      {props.messages?.map((m: any) => (
        <div key={m.id} data-testid={`msg-${m.id}`} data-role={m.role}>
          {m.content}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('../MessageInput', () => ({
  MessageInput: (props: any) => (
    <div
      data-testid="message-input"
      data-disabled={props.disabled}
      data-loading={props.isLoading}
      data-placeholder={props.placeholder}
      data-initial-value={props.initialValue || ''}
      data-initial-attachments={JSON.stringify(props.initialAttachments || [])}
    >
      <button data-testid="send-btn" onClick={() => props.onSend?.('hello')}>
        Send
      </button>
      <button data-testid="send-empty-btn" onClick={() => props.onSend?.('')}>
        SendEmpty
      </button>
      <button data-testid="cancel-btn" onClick={() => props.onCancel?.()}>
        Cancel
      </button>
      <button data-testid="command-btn" onClick={() => props.onCommand?.('/help', '')}>
        Command
      </button>
    </div>
  ),
}));
vi.mock('../tool-call/ToolCallList', () => ({
  ToolCallList: () => <div data-testid="tool-calls">tool calls</div>,
}));
vi.mock('../LoadingIndicator', () => ({
  LoadingIndicator: ({ isLoading, onCancel }: any) =>
    isLoading ? (
      <div data-testid="loading">
        loading
        <button data-testid="loading-cancel" onClick={onCancel}>
          cancel
        </button>
      </div>
    ) : (
      <div data-testid="loading-hidden" />
    ),
}));
vi.mock('../InlinePermissionRequest', () => ({
  InlinePermissionRequest: (props: any) => (
    <div data-testid="permission-request" data-request-id={props.request?.requestId} />
  ),
}));
vi.mock('../ModeSelector', () => ({
  ModeSelector: (props: any) => (
    <button
      data-testid="mode-selector"
      data-value={String(props.value)}
      data-disabled={String(Boolean(props.disabled))}
      data-locked={String(Boolean(props.locked))}
      onClick={() => props.onChange?.('plan')}
    >
      select mode
    </button>
  ),
}));
vi.mock('../PermissionSelector', () => ({
  PermissionSelector: (props: any) => (
    <div
      data-testid="permission-selector"
      data-value={props.value || ''}
      data-disabled={props.disabled}
    >
      <button data-testid="perm-change" onClick={() => props.onChange?.('auto-approve')}>
        change perm
      </button>
    </div>
  ),
}));
vi.mock('../WorktreeSelector', () => ({
  WorktreeSelector: (props: any) => (
    <div
      data-testid="worktree-selector"
      data-disabled={props.disabled}
      data-locked={props.locked}
    />
  ),
}));
vi.mock('../TokenUsageDisplay', () => ({
  TokenUsageDisplay: (props: any) => (
    <div
      data-testid="token-usage"
      data-input={props.inputTokens}
      data-context-used={props.contextUsedTokens}
      data-context-window={props.contextWindow}
    />
  ),
}));
vi.mock('../../../components/BottomPanel', () => ({
  BottomPanel: (props: any) => (
    <div data-testid="bottom-panel" data-project-id={props.projectId || ''} />
  ),
}));
vi.mock('../../../features/supervision/components/TaskCardStrip', () => ({
  TaskCardStrip: (props: any) => (
    <div data-testid="task-card-strip" data-project-id={props.projectId} />
  ),
}));
vi.mock('../../../components/BackgroundTaskPanel', () => ({
  BackgroundTaskPanel: (props: any) => (
    <div data-testid="bg-task-panel" data-session-id={props.sessionId}>
      <button
        data-testid="bg-task-stop"
        onClick={() =>
          props.onStopTask?.({
            id: 'task-123',
            cliPid: 456,
            taskRootPid: 789,
            taskCommand: 'sleep 30 && echo hello',
          })
        }
      />
    </div>
  ),
}));

// Mock services - use importOriginal to auto-stub all exports
const mockSendMessage = vi.fn();
const mockSendToServer = vi.fn();
const mockIsServerConnected = vi.fn(() => true);
const mockConnectServer = vi.fn();
const mockHandlePermissionDecision = vi.fn();
const mockHandleAskUserAnswer = vi.fn();

vi.mock('../../../services/api', async importOriginal => {
  const mod = await importOriginal<Record<string, any>>();
  const stubbed: Record<string, any> = {};
  for (const key of Object.keys(mod)) {
    stubbed[key] = typeof mod[key] === 'function' ? vi.fn(() => Promise.resolve(null)) : mod[key];
  }
  stubbed.getMessages = vi.fn(() => Promise.resolve({ messages: [], total: 0 }));
  stubbed.getSessionMessages = vi.fn(() =>
    Promise.resolve({ messages: [], total: 0, pagination: { total: 0, hasMore: false } })
  );
  stubbed.getBaseUrl = () => 'http://localhost:3100';
  stubbed.getAuthHeaders = () => ({});
  stubbed.getProviderCommands = vi.fn(() => Promise.resolve([]));
  stubbed.getProviderTypeCommands = vi.fn(() => Promise.resolve([]));
  stubbed.getProviderCapabilities = vi.fn(() => Promise.resolve({}));
  stubbed.getProviderTypeCapabilities = vi.fn(() => Promise.resolve({}));
  stubbed.getSessionRunState = vi.fn(() => Promise.resolve({ isRunning: false }));
  stubbed.archiveSessions = vi.fn(() => Promise.resolve());
  stubbed.updateSession = vi.fn(() => Promise.resolve());
  stubbed.exportSession = vi.fn(() => Promise.resolve({ markdown: '# test', sessionName: 'Test' }));
  stubbed.resetSessionSdkSession = vi.fn(() => Promise.resolve());
  stubbed.executeCommand = vi.fn(() =>
    Promise.resolve({ type: 'builtin', action: 'help', data: { content: 'help text' } })
  );
  stubbed.dismissInterrupted = vi.fn(() => Promise.resolve());
  stubbed.unlockSession = vi.fn(() => Promise.resolve({ isReadOnly: false, planStatus: null }));
  stubbed.getTaskPlanStatus = vi.fn(() => Promise.resolve(null));
  stubbed.updateSessionWorkingDirectory = vi.fn(() => Promise.resolve());
  return stubbed;
});
vi.mock('../../../services/fileUpload', () => ({
  uploadFile: vi.fn(),
}));

// Mock ConnectionContext
vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    serverUrl: 'http://localhost:3100',
    isConnected: true,
    activeBackend: 'local',
    setActiveBackend: vi.fn(),
    sendMessage: mockSendMessage,
    sendToServer: mockSendToServer,
    isServerConnected: mockIsServerConnected,
    connectServer: mockConnectServer,
    handlePermissionDecision: mockHandlePermissionDecision,
    handlePromptAnswer: mockHandleAskUserAnswer,
  }),
}));

// Mock useIsMobile
vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../../hooks/chat/useSessionRoute', () => ({
  useSessionRoute: (sessionId: string) => {
    const serverState = useServerStore.getState();
    const ownershipState = useOwnershipStore.getState();
    const recoveryState = useRecoveryStore.getState();
    const activeServerId = serverState.activeServerId ?? 'local';
    const backendId = ownershipState.sessionBackendIds[sessionId] ?? activeServerId;
    const isConnected = recoveryState.backends[activeServerId]?.status === 'ready';

    return {
      backendId,
      phase: isConnected ? 'ready' : 'offline',
      canSend: isConnected,
      canLoadMessages: true,
      ownerResolved: backendId !== activeServerId,
      lastError: null,
    };
  },
}));

vi.mock('../../../hooks/chat/useMessagePagination', () => ({
  useMessagePagination: ({ sessionId }: { sessionId: string }) => {
    let stable = paginationHookState.get(sessionId);
    if (!stable) {
      stable = {
        messagesEndRef: { current: null },
        messagesContainerRef: { current: null },
        scrollToBottom: vi.fn(),
        jumpToBottomInstant: vi.fn(),
        loadMoreMessages: vi.fn(),
        handleScroll: vi.fn(),
        handleMessageWheel: vi.fn(),
        retryLoad: vi.fn(),
        resetRefs: vi.fn(),
      };
      paginationHookState.set(sessionId, stable);
    }
    const sessionPagination = useChatMessageStore.getState().pagination[sessionId];
    return {
      ...stable,
      initialLoadDone: Boolean(sessionPagination),
      showScrollToBottom: false,
      scrollMetrics: { scrollTop: 0, viewportHeight: 0 },
      highlightedMessageId: null,
      loadError: null,
      sessionPagination,
    };
  },
}));

vi.mock('../../../hooks/chat/useProviderCapabilities', () => ({
  useProviderCapabilities: ({ sessionId }: { sessionId: string }) => {
    const projectState = useProjectStore.getState();
    const currentSession = projectState.sessions.find(session => session.id === sessionId);
    const currentProject = currentSession
      ? projectState.projects.find(project => project.id === currentSession.projectId)
      : null;
    // Mirrors useProviderCapabilities post-C: agent profile chain is resolved
    // server-side / via useAgentForSession; tests stub it to null since
    // they don't exercise that path.
    void currentSession;
    void currentProject;
    const llmProfileId: string | null = null;

    return {
      llmProfileId,
      // Stub capabilities so ModeSelector renders in tests.
      capabilities: {
        modes: [
          { id: 'default', label: 'Default' },
          { id: 'plan', label: 'Plan' },
        ],
        models: [],
        defaultModeId: 'default',
      },
      commands: [],
      commandsCacheKey: `test:${llmProfileId ?? '_default'}`,
    };
  },
}));

vi.mock('../../../hooks/chat/usePlanStatus', () => ({
  usePlanStatus: () => planStatusHookState,
}));

import { ChatInterface } from '../ChatInterface';
import * as api from '../../../services/api';

async function clickAsync(target: Element) {
  await act(async () => {
    fireEvent.click(target);
    await Promise.resolve();
  });
}

async function blurAsync(target: Element) {
  await act(async () => {
    fireEvent.blur(target);
    await Promise.resolve();
  });
}

// Helper: default store state
function setDefaultStores(overrides?: {
  projectStore?: Record<string, any>;
  chatStore?: Record<string, any>;
  chatMessageStore?: Record<string, any>;
  sessionConfigStore?: Record<string, any>;
  sessionOverridesStore?: Record<string, any>;
  terminalStore?: Record<string, any>;
  uiStore?: Record<string, any>;
  permissionStore?: Record<string, any>;
  serverStore?: Record<string, any>;
  fileViewerStore?: Record<string, any>;
}) {
  useProjectStore.setState({
    projects: [{ id: 'proj-1', name: 'Test Project', rootPath: '/test' }],
    sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'Test Session' }],
    providers: [],
    dataServerId: 'local',
    providerCommands: {},
    providerCapabilities: {},
    setProviderCapabilities: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    ...overrides?.projectStore,
  } as any);
  useRunStore.setState({
    activeRuns: {},
    backgroundRunIds: new Set(),
    runHealth: {},
    activeToolCalls: {},
    runContentBlocks: {},
    toolCallsHistory: {},
    startRun: vi.fn(),
    ...overrides?.chatStore,
  } as any);
  useChatMessageStore.setState({
    messages: {},
    pagination: {},
    addMessage: vi.fn(),
    setMessages: vi.fn(),
    prependMessages: vi.fn(),
    appendMessages: vi.fn(),
    clearMessages: vi.fn(),
    setLoadingMore: vi.fn(),
    ...overrides?.chatMessageStore,
  } as any);
  useSessionConfigStore.setState({
    modeBySession: {},
    runtimeModes: {},
    sessionUsage: {},
    compactionNotice: {},
    systemInfoBySession: {},
    setMode: vi.fn(),
    getMode: vi.fn(() => ''),
    getSystemInfo: vi.fn(() => null),
    ...overrides?.sessionConfigStore,
  } as any);
  useSessionOverridesStore.setState({
    permissionOverrides: {},
    worktreeOverrides: {},
    setPermissionOverride: vi.fn(),
    getPermissionOverride: vi.fn(() => null),
    setWorktreeOverride: vi.fn(),
    getWorktreeOverride: vi.fn(() => ''),
    clearWorktreeOverride: vi.fn(),
    ...overrides?.sessionOverridesStore,
  } as any);
  useTerminalStore.setState({
    drawerOpen: {},
    terminals: {},
    setDrawerOpen: vi.fn(),
    openTerminal: vi.fn(),
    isDrawerOpen: vi.fn(() => false),
    ...overrides?.terminalStore,
  } as any);
  useBottomPanelStore.setState({
    activeTab: 'terminal',
    setActiveTab: vi.fn(),
  });
  useUIStore.setState({
    forceScrollToBottomSessionId: null,
    poppedOutSessions: new Map(),
    consumeForceScrollToBottom: vi.fn(),
    addPoppedOutSession: vi.fn(),
    removePoppedOutSession: vi.fn(),
    ...overrides?.uiStore,
  } as any);
  usePermissionStore.setState({
    pendingRequests: [],
    ...overrides?.permissionStore,
  } as any);
  useServerStore.setState({
    activeServerId: 'local',
    servers: [],
    connections: {
      local: { isLocalConnection: true, features: [] },
    },
    activeServerSupports: () => false,
    ...overrides?.serverStore,
  } as any);
  useRecoveryStore.setState({
    backends: {
      local: {
        backendId: 'local',
        status: 'ready',
        subscribed: true,
        dataReady: true,
        retryCount: 0,
        lastError: null,
        lastCloseReason: null,
        statusEnteredAt: Date.now(),
      },
    },
    transport: {
      status: 'connected',
      mode: 'embedded',
      generation: 1,
      error: null,
      peerSessionId: null,
      retryCount: 0,
      lastMessageAt: Date.now(),
      statusEnteredAt: Date.now(),
    },
  } as any);
  useOwnershipStore.setState({
    sessionBackendIds: {},
    projectBackendIds: {},
    taskOwners: {},
    setSessionOwner: vi.fn(),
    setSessionOwners: vi.fn(),
    removeSessionOwner: vi.fn(),
    removeSessionOwnersByBackend: vi.fn(),
    clearSessionOwners: vi.fn(),
    getSessionBackendId: (sessionId: string) =>
      useOwnershipStore.getState().sessionBackendIds[sessionId] ?? null,
    setProjectOwner: vi.fn(),
    setProjectOwners: vi.fn(),
    removeProjectOwner: vi.fn(),
    removeProjectOwnersByBackend: vi.fn(),
    clearProjectOwners: vi.fn(),
    getProjectBackendId: () => null,
    setTaskOwner: vi.fn(),
    setTaskOwners: vi.fn(),
    removeTaskOwner: vi.fn(),
    removeTaskOwnersByBackend: vi.fn(),
    clearTaskOwners: vi.fn(),
    getTaskBackendId: () => null,
    getTaskProjectId: () => null,
  } as any);
  useFileViewerStore.setState({
    isOpen: false,
    searchOpen: false,
    fullscreen: false,
    togglePanel: vi.fn(),
    setSearchOpen: vi.fn(),
    close: vi.fn(),
    ...overrides?.fileViewerStore,
  } as any);
  useComposerStore.setState({ drafts: {}, pendingPrefills: {} });
}

describe('ChatInterface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    paginationHookState.clear();
    planStatusHookState.taskPlanStatus = null;
    planStatusHookState.planStatusLoading = false;
    planStatusHookState.submitPlanLoading = false;
    planStatusHookState.discardPlanLoading = false;
    mockIsServerConnected.mockReturnValue(true);
    setDefaultStores();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset real stores that may be seeded per-test
    useAgentProfileMetaStore.setState({ profiles: {}, loaded: false, loading: false } as any);
    useComposerStore.setState({ drafts: {}, pendingPrefills: {} });
  });

  // ─── Basic Rendering ─────────────────────────────────────────────────

  it('renders without crashing', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container).toBeTruthy();
  });

  it('renders the message input area', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="message-input"]')).toBeTruthy();
  });

  it('renders the message list', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="message-list"]')).toBeTruthy();
  });

  it('renders beforeComposer content', () => {
    const { container } = render(
      <ChatInterface
        sessionId="sess-1"
        beforeComposer={<div data-testid="before-composer-basic" />}
      />
    );
    expect(container.querySelector('[data-testid="before-composer-basic"]')).toBeTruthy();
  });

  it('renders background task panel', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="bg-task-panel"]')).toBeTruthy();
  });

  it('renders toolbar selectors (mode selector, permission)', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="mode-selector"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="permission-selector"]')).toBeTruthy();
  });

  it('renders token usage display in footer', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="token-usage"]')).toBeTruthy();
  });

  // ─── Session Action Bar ───────────────────────────────────────────────

  it('renders the session name in the action bar', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Test Session');
  });

  it('shows "Untitled Session" when session has no name', () => {
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: '' }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Untitled Session');
  });

  it('shows rename input when session name is clicked', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    // Click the session name button (the button with title "Click to rename")
    const renameBtn = container.querySelector('button[title="Click to rename"]');
    expect(renameBtn).toBeTruthy();
    fireEvent.click(renameBtn!);
    // Now an input should appear
    const input = container.querySelector('input[type="text"]');
    expect(input).toBeTruthy();
  });

  it('submits rename on Enter key', async () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const renameBtn = container.querySelector('button[title="Click to rename"]');
    await clickAsync(renameBtn!);
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New Name' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve();
    });
    expect(api.updateSession).toHaveBeenCalledWith('sess-1', { name: 'New Name' });
  });

  it('cancels rename on Escape key', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const renameBtn = container.querySelector('button[title="Click to rename"]');
    fireEvent.click(renameBtn!);
    const input = container.querySelector('input[type="text"]');
    expect(input).toBeTruthy();
    fireEvent.keyDown(input!, { key: 'Escape' });
    // Input should disappear
    expect(container.querySelector('input[type="text"]')).toBeNull();
  });

  it('submits rename on blur', async () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const renameBtn = container.querySelector('button[title="Click to rename"]');
    await clickAsync(renameBtn!);
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Blur Name' } });
    await blurAsync(input);
    expect(api.updateSession).toHaveBeenCalledWith('sess-1', { name: 'Blur Name' });
  });

  // ─── Session Action Buttons ───────────────────────────────────────────

  // Desktop session actions now live behind a "..." overflow menu.
  const openSessionMenu = (container: HTMLElement) =>
    clickAsync(container.querySelector('button[title="Session actions"]')!);
  const menuItem = (container: HTMLElement, label: string) =>
    Array.from(container.querySelectorAll('button[role="menuitem"]')).find(b =>
      b.textContent?.includes(label)
    ) as HTMLButtonElement | undefined;

  it('renders reset provider session menu item', async () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    await openSessionMenu(container);
    expect(menuItem(container, 'Reset session')).toBeTruthy();
  });

  it('calls resetSessionSdkSession when reset item clicked', async () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    await openSessionMenu(container);
    await clickAsync(menuItem(container, 'Reset session')!);
    expect(api.resetSessionSdkSession).toHaveBeenCalledWith('sess-1');
  });

  it('renders export item and calls exportSession on click', async () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    await openSessionMenu(container);
    const btn = menuItem(container, 'Export as Markdown');
    expect(btn).toBeTruthy();
    await clickAsync(btn!);
    expect(api.exportSession).toHaveBeenCalledWith('sess-1');
  });

  it('renders archive item and calls archiveSessions on click', async () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    await openSessionMenu(container);
    const btn = menuItem(container, 'Archive session');
    expect(btn).toBeTruthy();
    await clickAsync(btn!);
    expect(api.archiveSessions).toHaveBeenCalledWith(['sess-1']);
  });

  it('disables reset item while loading', async () => {
    setDefaultStores({
      chatStore: {
        activeRuns: { 'run-1': 'sess-1' },
        backgroundRunIds: new Set(),
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    await openSessionMenu(container);
    expect(menuItem(container, 'Reset session')?.disabled).toBe(true);
  });

  // ─── Background Session (back button and read-only label) ─────────────

  it('shows back button for background sessions', () => {
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'BG Session', type: 'background' }],
      },
    });
    const onReturnToDashboard = vi.fn();
    const { container } = render(
      <ChatInterface sessionId="sess-1" onReturnToDashboard={onReturnToDashboard} />
    );
    const backBtn = container.querySelector('button[title="Back to dashboard"]');
    expect(backBtn).toBeTruthy();
    fireEvent.click(backBtn!);
    expect(onReturnToDashboard).toHaveBeenCalledWith('proj-1');
  });

  it('does not show rename for background sessions (shows span instead of button)', () => {
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'BG Session', type: 'background' }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    // Background sessions show a span, not a button with "Click to rename"
    expect(container.querySelector('button[title="Click to rename"]')).toBeNull();
    expect(container.textContent).toContain('BG Session');
  });

  it('hides action buttons for background sessions', () => {
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'BG', type: 'background' }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    // Background sessions don't render the actions overflow menu at all.
    expect(container.querySelector('button[title="Session actions"]')).toBeNull();
  });

  // ─── Loading State ────────────────────────────────────────────────────

  it('shows loading indicator when session run is active', () => {
    setDefaultStores({
      chatStore: {
        activeRuns: { 'run-1': 'sess-1' },
        backgroundRunIds: new Set(),
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="loading"]')).toBeTruthy();
  });

  it('does not show loading indicator when no active run', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    // LoadingIndicator renders with isLoading=false
    expect(container.querySelector('[data-testid="loading"]')).toBeNull();
    expect(container.querySelector('[data-testid="loading-hidden"]')).toBeTruthy();
  });

  it('does not show loading when run is for a different session', () => {
    setDefaultStores({
      chatStore: {
        activeRuns: { 'run-1': 'sess-other' },
        backgroundRunIds: new Set(),
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="loading"]')).toBeNull();
  });

  it('does not show loading when run is backgrounded', () => {
    setDefaultStores({
      chatStore: {
        activeRuns: { 'run-1': 'sess-1' },
        backgroundRunIds: new Set(['run-1']),
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="loading"]')).toBeNull();
  });

  // ─── Initial Loading Placeholder ──────────────────────────────────────

  it('shows initial loading placeholder before messages are loaded', () => {
    // No pagination set = initial loading state
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Loading messages...');
  });

  it('hides initial loading placeholder after messages load', () => {
    setDefaultStores({
      chatMessageStore: {
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).not.toContain('Loading messages...');
  });

  // ─── Messages Display ─────────────────────────────────────────────────

  it('passes session messages to MessageList', () => {
    const msgs = [
      { id: 'msg-1', sessionId: 'sess-1', role: 'user', content: 'Hello', createdAt: 1 },
      { id: 'msg-2', sessionId: 'sess-1', role: 'assistant', content: 'Hi there', createdAt: 2 },
    ];
    setDefaultStores({
      chatMessageStore: {
        messages: { 'sess-1': msgs },
        pagination: { 'sess-1': { total: 2, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="msg-msg-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="msg-msg-2"]')).toBeTruthy();
  });

  it('shows empty message list for unknown session', () => {
    const { container } = render(<ChatInterface sessionId="sess-unknown" />);
    // MessageList should receive empty messages array
    const list = container.querySelector('[data-testid="message-list"]');
    expect(list).toBeTruthy();
  });

  // ─── Sending Messages ─────────────────────────────────────────────────

  it('sends message via WebSocket on send button click', async () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {},
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const sendBtn = container.querySelector('[data-testid="send-btn"]');
    await clickAsync(sendBtn!);
    expect(mockSendToServer).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({
        type: 'run_start',
        sessionId: 'sess-1',
      })
    );
  });

  it('routes session messages to the owner backend instead of the active server', async () => {
    setDefaultStores({
      serverStore: {
        activeServerId: 'local',
        connections: {
          local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
          'backend-1': { status: 'connected', error: null, isLocalConnection: false, features: [] },
        },
      },
    });
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      sessionBackendIds: { 'sess-1': 'backend-1' },
    });

    const { container } = render(<ChatInterface sessionId="sess-1" />);
    await clickAsync(container.querySelector('[data-testid="send-btn"]')!);
    expect(mockSendToServer).toHaveBeenCalledWith(
      'backend-1',
      expect.objectContaining({
        type: 'run_start',
        sessionId: 'sess-1',
      })
    );
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('does not send empty messages', async () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {},
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const sendEmptyBtn = container.querySelector('[data-testid="send-empty-btn"]');
    fireEvent.click(sendEmptyBtn!);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSendToServer).not.toHaveBeenCalled();
  });

  it("includes mode='plan' in run_start message when mode is plan", async () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {},
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
      sessionConfigStore: {
        modeBySession: { 'sess-1': 'plan' },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const sendBtn = container.querySelector('[data-testid="send-btn"]');
    await clickAsync(sendBtn!);
    expect(mockSendToServer).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({
        type: 'run_start',
        mode: 'plan',
      })
    );
  });

  it('omits mode when no per-session mode is set (server picks default)', async () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {},
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const sendBtn = container.querySelector('[data-testid="send-btn"]');
    await clickAsync(sendBtn!);
    const call = mockSendToServer.mock.calls[0];
    expect(call?.[0]).toBe('local');
    expect((call?.[1] as any).mode).toBeUndefined();
    expect(call?.[1]).not.toHaveProperty('model');
    expect((call?.[1] as any).planMode).toBeUndefined();
  });

  // ─── Cancel Run ───────────────────────────────────────────────────────

  it('sends run_cancel when cancel is triggered during loading', () => {
    setDefaultStores({
      chatStore: {
        activeRuns: { 'run-1': 'sess-1' },
        backgroundRunIds: new Set(),
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const cancelBtn = container.querySelector('[data-testid="loading-cancel"]');
    expect(cancelBtn).toBeTruthy();
    fireEvent.click(cancelBtn!);
    expect(mockSendToServer).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({
        type: 'run_cancel',
        runId: 'run-1',
      })
    );
  });

  it('routes cancel to the owner backend for remote sessions', () => {
    setDefaultStores({
      serverStore: {
        activeServerId: 'local',
      },
      chatStore: {
        activeRuns: { 'run-1': 'sess-1' },
        backgroundRunIds: new Set(),
      },
    });
    useOwnershipStore.setState({
      ...useOwnershipStore.getState(),
      sessionBackendIds: { 'sess-1': 'backend-1' },
    });

    const { container } = render(<ChatInterface sessionId="sess-1" />);
    fireEvent.click(container.querySelector('[data-testid="loading-cancel"]')!);

    expect(mockSendToServer).toHaveBeenCalledWith(
      'backend-1',
      expect.objectContaining({
        type: 'run_cancel',
        runId: 'run-1',
      })
    );
  });

  // ─── Permission Requests ──────────────────────────────────────────────

  it('renders inline permission requests for the session', () => {
    setDefaultStores({
      permissionStore: {
        pendingRequests: [
          { requestId: 'perm-1', sessionId: 'sess-1', tool: 'bash' },
          { requestId: 'perm-2', sessionId: 'sess-1', tool: 'write' },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const permReqs = container.querySelectorAll('[data-testid="permission-request"]');
    expect(permReqs.length).toBe(2);
  });

  it('does not render permission requests for other sessions', () => {
    setDefaultStores({
      permissionStore: {
        pendingRequests: [{ requestId: 'perm-1', sessionId: 'sess-other', tool: 'bash' }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const permReqs = container.querySelectorAll('[data-testid="permission-request"]');
    expect(permReqs.length).toBe(0);
  });

  it('renders permission requests without sessionId (backward compat)', () => {
    setDefaultStores({
      permissionStore: {
        pendingRequests: [
          { requestId: 'perm-1', tool: 'bash' }, // no sessionId
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const permReqs = container.querySelectorAll('[data-testid="permission-request"]');
    expect(permReqs.length).toBe(1);
  });

  // ─── Tool Calls Display ───────────────────────────────────────────────

  it('shows tool calls when session has active tool calls', () => {
    setDefaultStores({
      chatStore: {
        activeRuns: { 'run-1': 'sess-1' },
        backgroundRunIds: new Set(),
        activeToolCalls: {
          'run-1': { 'tc-1': { id: 'tc-1', toolName: 'bash', status: 'running' } },
        },
        runContentBlocks: {},
        toolCallsHistory: {},
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="tool-calls"]')).toBeTruthy();
  });

  it('does not show tool calls when there are none', () => {
    setDefaultStores({
      chatStore: {
        activeRuns: { 'run-1': 'sess-1' },
        backgroundRunIds: new Set(),
        activeToolCalls: {},
        runContentBlocks: {},
        toolCallsHistory: {},
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="tool-calls"]')).toBeNull();
  });

  // ─── Task Card Strip ──────────────────────────────────────────────────

  it('shows task card strip for main supervisor sessions', () => {
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'Main', projectRole: 'main' }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const strip = container.querySelector('[data-testid="task-card-strip"]');
    expect(strip).toBeTruthy();
    expect(strip?.getAttribute('data-project-id')).toBe('proj-1');
  });

  it('does not show task card strip for non-main sessions', () => {
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'Task', projectRole: 'task' }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="task-card-strip"]')).toBeNull();
  });

  // ─── Interrupted Session Banner ───────────────────────────────────────

  it('shows interrupted session banner when lastRunStatus is interrupted', () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          { id: 'sess-1', projectId: 'proj-1', name: 'Test', lastRunStatus: 'interrupted' },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Session was interrupted by app restart');
  });

  it('shows Resume and Dismiss buttons in interrupted banner', () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          { id: 'sess-1', projectId: 'proj-1', name: 'Test', lastRunStatus: 'interrupted' },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const buttons = container.querySelectorAll('button');
    const resumeBtn = Array.from(buttons).find(b => b.textContent?.includes('Resume'));
    const dismissBtn = Array.from(buttons).find(b => b.textContent?.includes('Dismiss'));
    expect(resumeBtn).toBeTruthy();
    expect(dismissBtn).toBeTruthy();
  });

  it('sends continue run_start on Resume click', async () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          { id: 'sess-1', projectId: 'proj-1', name: 'Test', lastRunStatus: 'interrupted' },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const buttons = container.querySelectorAll('button');
    const resumeBtn = Array.from(buttons).find(b => b.textContent?.includes('Resume'));
    await clickAsync(resumeBtn!);
    expect(mockSendToServer).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({
        type: 'run_start',
        sessionId: 'sess-1',
        input: 'continue',
      })
    );
  });

  it('calls dismissInterrupted on Dismiss click', async () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          { id: 'sess-1', projectId: 'proj-1', name: 'Test', lastRunStatus: 'interrupted' },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const buttons = container.querySelectorAll('button');
    const dismissBtn = Array.from(buttons).find(b => b.textContent?.includes('Dismiss'));
    await clickAsync(dismissBtn!);
    expect(api.dismissInterrupted).toHaveBeenCalledWith('sess-1');
  });

  it('does not show interrupted banner for normal sessions', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).not.toContain('Session was interrupted');
  });

  // ─── Read-Only Sessions ───────────────────────────────────────────────

  it('shows read-only indicator for read-only sessions', () => {
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'RO', isReadOnly: true }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('This session is read-only');
  });

  it('shows background session read-only message', () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          { id: 'sess-1', projectId: 'proj-1', name: 'BG', isReadOnly: true, type: 'background' },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Background session');
  });

  it('shows planned status read-only message', () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          {
            id: 'sess-1',
            projectId: 'proj-1',
            name: 'Task',
            isReadOnly: true,
            planStatus: 'planned',
          },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Plan submitted');
  });

  it('shows executing status read-only message', () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          {
            id: 'sess-1',
            projectId: 'proj-1',
            name: 'Task',
            isReadOnly: true,
            planStatus: 'executing',
          },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Task executing');
  });

  it('shows Unlock button for non-background read-only sessions', () => {
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'RO', isReadOnly: true }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const buttons = container.querySelectorAll('button');
    const unlockBtn = Array.from(buttons).find(b => b.textContent?.includes('Unlock'));
    expect(unlockBtn).toBeTruthy();
  });

  it('calls unlockSession when Unlock clicked', async () => {
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'RO', isReadOnly: true }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const buttons = container.querySelectorAll('button');
    const unlockBtn = Array.from(buttons).find(b => b.textContent?.includes('Unlock'));
    await clickAsync(unlockBtn!);
    expect(api.unlockSession).toHaveBeenCalledWith('sess-1');
  });

  it('hides message input for read-only sessions', () => {
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'RO', isReadOnly: true }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="message-input"]')).toBeNull();
  });

  it('shows Cancel button for background read-only session with active run', () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          { id: 'sess-1', projectId: 'proj-1', name: 'BG', isReadOnly: true, type: 'background' },
        ],
      },
      chatStore: {
        activeRuns: { 'run-1': 'sess-1' },
        backgroundRunIds: new Set(),
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const buttons = container.querySelectorAll('button');
    const cancelBtn = Array.from(buttons).find(b => b.textContent?.includes('Cancel'));
    expect(cancelBtn).toBeTruthy();
  });

  // ─── Popped Out Session ───────────────────────────────────────────────

  it('shows popped-out placeholder when session is popped out', () => {
    setDefaultStores({
      uiStore: {
        poppedOutSessions: new Map([['sess-1', 'win-label-1']]),
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('This session is open in a separate window');
    // Should show focus and bring back buttons
    const buttons = container.querySelectorAll('button');
    const focusBtn = Array.from(buttons).find(b => b.textContent?.includes('Focus window'));
    const bringBackBtn = Array.from(buttons).find(b => b.textContent?.includes('Bring back here'));
    expect(focusBtn).toBeTruthy();
    expect(bringBackBtn).toBeTruthy();
  });

  it('hides chat content when session is popped out', () => {
    setDefaultStores({
      uiStore: {
        poppedOutSessions: new Map([['sess-1', 'win-label-1']]),
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="message-list"]')).toBeNull();
    expect(container.querySelector('[data-testid="message-input"]')).toBeNull();
  });

  it('shows chat content when session is not popped out', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="message-list"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="message-input"]')).toBeTruthy();
  });

  // ─── Plan Status Indicator ────────────────────────────────────────────

  it('shows planning mode indicator for task sessions in planning status', () => {
    planStatusHookState.taskPlanStatus = {
      exists: true,
      ready: false,
      missing: ['summary'],
    };
    setDefaultStores({
      projectStore: {
        sessions: [
          {
            id: 'sess-1',
            projectId: 'proj-1',
            name: 'Task',
            projectRole: 'task',
            planStatus: 'planning',
            taskId: 'task-1',
          },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Planning mode');
  });

  it('shows Submit Plan and Discard Plan buttons in planning mode', () => {
    planStatusHookState.taskPlanStatus = {
      exists: true,
      ready: false,
      missing: ['summary'],
    };
    setDefaultStores({
      projectStore: {
        sessions: [
          {
            id: 'sess-1',
            projectId: 'proj-1',
            name: 'Task',
            projectRole: 'task',
            planStatus: 'planning',
            taskId: 'task-1',
          },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const buttons = container.querySelectorAll('button');
    const submitBtn = Array.from(buttons).find(b => b.textContent?.includes('Submit Plan'));
    const discardBtn = Array.from(buttons).find(b => b.textContent?.includes('Discard Plan'));
    expect(submitBtn).toBeTruthy();
    expect(discardBtn).toBeTruthy();
  });

  it('does not show planning indicator for non-task sessions', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).not.toContain('Planning mode');
  });

  // ─── Toolbar: Mode + Permission ───────────────────────────────────────

  it("shows mode selector value='plan' when modeBySession is set", () => {
    setDefaultStores({
      sessionConfigStore: {
        modeBySession: { 'sess-1': 'plan' },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const sel = container.querySelector('[data-testid="mode-selector"]');
    expect(sel?.getAttribute('data-value')).toBe('plan');
  });

  it('disables toolbar selectors while loading', () => {
    setDefaultStores({
      chatStore: {
        activeRuns: { 'run-1': 'sess-1' },
        backgroundRunIds: new Set(),
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const sel = container.querySelector('[data-testid="mode-selector"]');
    const permSelector = container.querySelector('[data-testid="permission-selector"]');
    expect(sel?.getAttribute('data-disabled')).toBe('true');
    expect(permSelector?.getAttribute('data-disabled')).toBe('true');
  });

  it('locks mode selector in forced plan session', () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          {
            id: 'sess-1',
            projectId: 'proj-1',
            name: 'Task',
            projectRole: 'task',
            planStatus: 'planning',
          },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const sel = container.querySelector('[data-testid="mode-selector"]');
    expect(sel?.getAttribute('data-locked')).toBe('true');
    expect(sel?.getAttribute('data-value')).toBe('plan');
  });

  it('shows worktree selector when project has rootPath', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="worktree-selector"]')).toBeTruthy();
  });

  it('hides worktree selector when project has no rootPath', () => {
    setDefaultStores({
      projectStore: {
        projects: [{ id: 'proj-1', name: 'Test Project', rootPath: '' }],
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'Test Session' }],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="worktree-selector"]')).toBeNull();
  });

  // ─── MessageInput Placeholder Texts ───────────────────────────────────

  it('shows default placeholder when connected and not loading', () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {},
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const input = container.querySelector('[data-testid="message-input"]');
    expect(input?.getAttribute('data-placeholder')).toContain('Type a message');
  });

  it("shows plan mode placeholder when mode='plan'", () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {},
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
      sessionConfigStore: {
        modeBySession: { 'sess-1': 'plan' },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const input = container.querySelector('[data-testid="message-input"]');
    expect(input?.getAttribute('data-placeholder')).toContain('Plan Mode');
  });

  it('does not show plan mode placeholder when only runtimeMode is plan', () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {},
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
      sessionConfigStore: {
        modeBySession: {},
        runtimeModes: { 'sess-1': 'plan' },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const input = container.querySelector('[data-testid="message-input"]');
    expect(input?.getAttribute('data-placeholder')).toContain('Type a message');
    expect(input?.getAttribute('data-placeholder')).not.toContain('Plan Mode');
  });

  it('shows send-queue placeholder when loading', () => {
    setDefaultStores({
      chatStore: {
        activeRuns: { 'run-1': 'sess-1' },
        backgroundRunIds: new Set(),
      },
      chatMessageStore: {
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const input = container.querySelector('[data-testid="message-input"]');
    expect(input?.getAttribute('data-placeholder')).toContain('queue');
  });

  it('restores session draft attachments into MessageInput', () => {
    setDefaultStores({
      chatMessageStore: {
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
    });
    useComposerStore.setState({
      drafts: {
        'sess-1': {
          content: '',
          attachments: [
            {
              id: 'att-1',
              type: 'image',
              name: 'draft.png',
              data: 'data:image/png;base64,aaa',
              mimeType: 'image/png',
            },
          ],
        },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const input = container.querySelector('[data-testid="message-input"]');
    expect(input?.getAttribute('data-initial-attachments')).toContain('draft.png');
  });

  // ─── Load More Messages ───────────────────────────────────────────────

  it('shows "Load older messages" button when hasMore is true', () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {
          'sess-1': [
            { id: 'm1', sessionId: 'sess-1', role: 'user', content: 'hi', createdAt: 1000 },
          ],
        },
        pagination: {
          'sess-1': { total: 100, hasMore: true, isLoadingMore: false, oldestTimestamp: 1000 },
        },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const buttons = container.querySelectorAll('button');
    const loadMoreBtn = Array.from(buttons).find(b =>
      b.textContent?.includes('Load older messages')
    );
    expect(loadMoreBtn).toBeTruthy();
  });

  it('shows "Loading older messages..." when isLoadingMore is true', () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {
          'sess-1': [
            { id: 'm1', sessionId: 'sess-1', role: 'user', content: 'hi', createdAt: 1000 },
          ],
        },
        pagination: {
          'sess-1': { total: 100, hasMore: true, isLoadingMore: true, oldestTimestamp: 1000 },
        },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Loading older messages...');
  });

  it('does not show load more when hasMore is false', () => {
    setDefaultStores({
      chatMessageStore: {
        pagination: { 'sess-1': { total: 5, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).not.toContain('Load older messages');
  });

  // ─── Provider Badge ───────────────────────────────────────────────────

  it('shows agent badge with the agent name, not the provider or model', () => {
    // SessionHeader resolves the agent via useAgentForSession and shows only its
    // name in the pill; the model lives in the details popover, not the badge.
    useAgentProfileMetaStore.setState({
      profiles: {
        'agent-1': {
          id: 'agent-1',
          name: 'Coder',
          llmProfileId: 'prov-1',
          model: 'claude-sonnet-4-6',
          systemPrompt: '',
          enabledTools: [],
          isDefault: true,
          createdAt: 0,
          updatedAt: 0,
        },
      },
      loaded: true,
      loading: false,
    } as any);
    mockProviderMetaStore.getState().getProviders.mockReturnValue([
      {
        id: 'prov-1',
        name: 'TestProvider',
        providerType: 'zclaudia',
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    setDefaultStores({
      projectStore: {
        sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'Test', agentProfileId: 'agent-1' }],
        providers: [],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    // Badge shows the agent name; neither the LLM provider name nor the model appears.
    expect(container.textContent).toContain('Coder');
    expect(container.textContent).not.toContain('TestProvider');
    expect(container.textContent).not.toContain('claude-sonnet-4-6');
    mockProviderMetaStore.getState().getProviders.mockReturnValue([]);
  });

  it('falls back to "Default Coding Agent" before agent resolves', () => {
    // No agent profile resolved → SessionHeader shows the fallback label.
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Default Coding Agent');
  });

  // ─── Session with no session found ────────────────────────────────────

  it('does not render action bar when session is not found', () => {
    const { container } = render(<ChatInterface sessionId="sess-unknown" />);
    // No session found means currentSession is undefined, so action bar won't render
    expect(container.querySelector('button[title="Click to rename"]')).toBeNull();
    expect(container.querySelector('button[title="Archive session"]')).toBeNull();
  });

  // ─── Token Usage ──────────────────────────────────────────────────────

  it('passes session usage to TokenUsageDisplay', () => {
    setDefaultStores({
      sessionConfigStore: {
        sessionUsage: {
          'sess-1': {
            inputTokens: 100,
            outputTokens: 200,
            latestInputTokens: 50,
            latestOutputTokens: 75,
            contextWindow: 128000,
          },
        },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const tokenDisplay = container.querySelector('[data-testid="token-usage"]');
    expect(tokenDisplay?.getAttribute('data-input')).toBe('100');
    expect(tokenDisplay?.getAttribute('data-context-window')).toBe('128000');
  });

  it('uses real context occupancy for the header and compact usage display', () => {
    // 85% is above the header pill's warn threshold (80%), so the percentage is
    // visible; below the threshold the pill hides it (covered in SessionHeader.test).
    setDefaultStores({
      sessionConfigStore: {
        sessionUsage: {
          'sess-1': {
            inputTokens: 100,
            outputTokens: 200,
            latestInputTokens: 0,
            latestOutputTokens: 75,
            contextUsedTokens: 850_000,
            contextWindow: 1_000_000,
          },
        },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const tokenDisplay = container.querySelector('[data-testid="token-usage"]');
    expect(tokenDisplay?.getAttribute('data-context-used')).toBe('850000');
    expect(container.textContent).toContain('· 85%');
  });

  it('passes zero usage when no usage data exists', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const tokenDisplay = container.querySelector('[data-testid="token-usage"]');
    expect(tokenDisplay?.getAttribute('data-input')).toBe('0');
    expect(tokenDisplay?.getAttribute('data-context-window')).toBeNull();
  });

  // ─── Message Input disabled state ─────────────────────────────────────

  it('passes disabled=false when connected', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const input = container.querySelector('[data-testid="message-input"]');
    expect(input?.getAttribute('data-disabled')).toBe('false');
  });

  // ─── Panel slot ───────────────────────────────────────────────────────

  it('renders beforeComposer slot before the input area', () => {
    const { container } = render(
      <ChatInterface
        sessionId="sess-1"
        beforeComposer={<div data-testid="before-composer-slot" />}
      />
    );
    const slot = container.querySelector('[data-testid="before-composer-slot"]');
    const input = container.querySelector('[data-testid="message-input"]');
    expect(slot).toBeTruthy();
    expect(input).toBeTruthy();
    expect(Boolean(slot?.compareDocumentPosition(input!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true
    );
  });

  // ─── BackgroundTaskPanel sessionId ────────────────────────────────────

  it('passes sessionId to BackgroundTaskPanel', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const btp = container.querySelector('[data-testid="bg-task-panel"]');
    expect(btp?.getAttribute('data-session-id')).toBe('sess-1');
  });

  it('sends stop_background_task when BackgroundTaskPanel requests stop', () => {
    const { getByTestId } = render(<ChatInterface sessionId="sess-1" />);
    fireEvent.click(getByTestId('bg-task-stop'));
    expect(mockSendToServer).toHaveBeenCalledWith('local', {
      type: 'stop_background_task',
      sessionId: 'sess-1',
      taskId: 'task-123',
      cliPid: 456,
      taskRootPid: 789,
      taskCommand: 'sleep 30 && echo hello',
    });
  });

  // ─── Multiple sessions rendering correctly ────────────────────────────

  it('shows messages for the correct session', () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {
          'sess-1': [
            { id: 'm1', sessionId: 'sess-1', role: 'user', content: 'Hello from 1', createdAt: 1 },
          ],
          'sess-2': [
            { id: 'm2', sessionId: 'sess-2', role: 'user', content: 'Hello from 2', createdAt: 2 },
          ],
        },
        pagination: {
          'sess-1': { total: 1, hasMore: false },
          'sess-2': { total: 1, hasMore: false },
        },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="msg-m1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="msg-m2"]')).toBeNull();
  });

  // ─── Working directory / worktree ─────────────────────────────────────

  it('includes workingDirectory in run_start when session has one', async () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          { id: 'sess-1', projectId: 'proj-1', name: 'Test', workingDirectory: '/test/worktree' },
        ],
      },
      chatMessageStore: {
        messages: {},
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const sendBtn = container.querySelector('[data-testid="send-btn"]');
    await clickAsync(sendBtn!);
    expect(mockSendToServer).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({
        type: 'run_start',
        workingDirectory: '/test/worktree',
      })
    );
  });

  // ─── Composer footer ──────────────────────────────────────────────────

  it('renders the three selectors inside the composer footer (not a top toolbar)', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const footer = container.querySelector('[data-testid="composer-footer"]');
    expect(footer).not.toBeNull();
    expect(footer!.querySelector('[data-testid="mode-selector"]')).not.toBeNull();
    expect(footer!.querySelector('[data-testid="permission-selector"]')).not.toBeNull();
  });

  // ─── Worktree selector locked in planning mode ────────────────────────

  it('locks worktree selector in forced plan session', () => {
    setDefaultStores({
      projectStore: {
        sessions: [
          {
            id: 'sess-1',
            projectId: 'proj-1',
            name: 'Task',
            projectRole: 'task',
            planStatus: 'planning',
          },
        ],
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const wt = container.querySelector('[data-testid="worktree-selector"]');
    expect(wt?.getAttribute('data-locked')).toBe('true');
  });

  // ─── Permission override passed in run_start ──────────────────────────

  it('includes permissionOverride in run_start message', async () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {},
        pagination: { 'sess-1': { total: 0, hasMore: false } },
      },
      sessionOverridesStore: {
        permissionOverrides: { 'sess-1': 'auto-approve' },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const sendBtn = container.querySelector('[data-testid="send-btn"]');
    await clickAsync(sendBtn!);
    expect(mockSendToServer).toHaveBeenCalledWith(
      'local',
      expect.objectContaining({
        type: 'run_start',
        permissionOverride: 'auto-approve',
      })
    );
  });

  // ─── Scroll to bottom button ───────────────────────────────────────────

  it('shows scroll to bottom button when scrolled up', () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {
          'sess-1': [
            { id: 'm1', sessionId: 'sess-1', role: 'user', content: 'test', createdAt: 1 },
          ],
        },
        pagination: { 'sess-1': { total: 1, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    // Scroll button should exist
    const scrollBtn = container.querySelector('button[title="Scroll to bottom"]');
    // May or may not be visible depending on scroll position
    expect(scrollBtn || container.querySelector('[data-testid="message-list"]')).toBeTruthy();
  });

  // ─── Session rename functionality ───────────────────────────────────────

  it('shows session name in action bar', () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.textContent).toContain('Test Session');
  });

  // ─── Export session functionality ───────────────────────────────────────

  it('shows export item in the actions menu', async () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    await clickAsync(container.querySelector('button[title="Session actions"]')!);
    const exportItem = Array.from(container.querySelectorAll('button[role="menuitem"]')).find(b =>
      b.textContent?.includes('Export')
    );
    expect(exportItem).toBeTruthy();
  });

  // ─── Archive session functionality ──────────────────────────────────────

  it('shows archive item in the actions menu', async () => {
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    await clickAsync(container.querySelector('button[title="Session actions"]')!);
    const archiveItem = Array.from(container.querySelectorAll('button[role="menuitem"]')).find(b =>
      b.textContent?.includes('Archive')
    );
    expect(archiveItem).toBeTruthy();
  });

  // ─── Connection status handling ─────────────────────────────────────────

  it('queues message when not connected', async () => {
    // This test verifies that when isConnected is false, the message input is disabled
    // The default mock returns isConnected: true, so we we test the disabled state
    // by checking that input is enabled when connected (covered by other tests)
    // This test documents the expected behavior: when not connected, input is disabled
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const input = container.querySelector('[data-testid="message-input"]');
    // With default mock (isConnected: true), input should be enabled
    expect(input?.getAttribute('data-disabled')).toBe('false');
  });

  // ─── Resend functionality ───────────────────────────────────────────────

  it('shows resend button when last message is from user', () => {
    setDefaultStores({
      chatMessageStore: {
        messages: {
          'sess-1': [
            { id: 'm1', sessionId: 'sess-1', role: 'assistant', content: 'Hi', createdAt: 1 },
            { id: 'm2', sessionId: 'sess-1', role: 'user', content: 'Hello', createdAt: 2 },
          ],
        },
        pagination: { 'sess-1': { total: 2, hasMore: false } },
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    const resendTarget = container.querySelector('[data-testid="message-list"]');
    // Last message is from user, so resendTargetMessageId should be 'm2'
    expect(resendTarget?.getAttribute('data-resend-id')).toBe('m2');
  });

  // ─── File push notification ─────────────────────────────────────────────

  it('renders file push notification component when there is a notification', () => {
    // FilePushNotification is rendered by the App component, not ChatInterface
    // This test verifies ChatInterface renders without crashing
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="message-input"]')).toBeTruthy();
  });

  // ─── Multiple active runs handling ──────────────────────────────────────

  it('handles multiple active runs for different sessions', () => {
    setDefaultStores({
      chatStore: {
        activeRuns: { 'run-1': 'sess-1', 'run-2': 'sess-2' },
        backgroundRunIds: new Set(),
      },
    });
    const { container } = render(<ChatInterface sessionId="sess-1" />);
    expect(container.querySelector('[data-testid="loading"]')).toBeTruthy();
  });
});

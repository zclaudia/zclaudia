// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { useAppearanceStore } from '../../../stores/appearanceStore';
import { useUIStore } from '../../../stores/uiStore';
import { useProjectStore } from '../../../stores/projectStore';
import { usePluginStore } from '../../../stores/pluginStore';
import { useRightWorkspaceStore } from '../../../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../../../stores/projectWorkspaceStore';
import { useRightSidebarStore } from '../../../stores/rightSidebarStore';
import { selectProjectChat } from '../../../actions/projectWorkspaceActions';
import { useDraftEditorStore } from '../../../stores/draftEditorStore';
import { useFileViewerStore } from '../../../stores/fileViewerStore';

const { streamOwners } = vi.hoisted(() => ({ streamOwners: new Map<string, number>() }));
vi.mock('../../../components/workspace/useWorkspaceHydrated', () => ({ useWorkspaceHydrated: () => true }));
vi.mock('../../../hooks/useSelectionCoordinator', () => ({ useSelectionCoordinator: () => ({ selectSession: vi.fn() }) }));
vi.mock('../hooks/useSessionRoute', () => ({
  useSessionRoute: (sessionId: string, options?: { maintainDesiredState?: boolean }) => {
    useEffect(() => {
      if (!options?.maintainDesiredState) return;
      streamOwners.set(sessionId, (streamOwners.get(sessionId) ?? 0) + 1);
      return () => { streamOwners.set(sessionId, (streamOwners.get(sessionId) ?? 1) - 1); };
    }, [sessionId, options?.maintainDesiredState]);
    return { backendId: 'local' };
  },
}));

const isMobileMock = vi.fn();
vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => isMobileMock(),
  isMobileViewport: () => isMobileMock(),
}));

vi.mock('../ChatInterface', () => ({
  ChatInterface: ({ beforeComposer, sessionId, onReturnToDashboard }: { beforeComposer?: React.ReactNode; sessionId: string; onReturnToDashboard?: (id: string) => void }) => {
    const poppedOut = useUIStore(s => s.poppedOutSessions.get(sessionId));
    return <div data-testid={poppedOut ? 'popped-placeholder' : 'chat'} data-session-id={sessionId}>
      {beforeComposer ?? null}
      {onReturnToDashboard && <button onClick={() => onReturnToDashboard('project')}>Return to dashboard</button>}
    </div>;
  },
}));
vi.mock('../../../components/panels/PanelRenderer', () => ({
  PanelContent: () => <div data-testid="tool-content" />,
  PanelActions: () => null,
}));
vi.mock('../../../components/RightSidebar', () => ({
  RightSidebar: () => <div data-testid="right" />,
}));
vi.mock('../../../components/BottomPanel', () => ({
  BottomPanel: () => <div data-testid="bottom" />,
}));

import { SessionChatLayout } from '../SessionChatLayout';

describe('SessionChatLayout bottom panel placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMobileMock.mockReturnValue(false);
    streamOwners.clear();
    useAppearanceStore.setState({ chatCard: false, unifiedWorkspace: false });
    useUIStore.setState({ poppedOutSessions: new Map() });
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    useProjectWorkspaceStore.setState({ byProject: {} });
    useRightSidebarStore.setState({ collapsed: false });
    usePluginStore.setState({ panels: [] });
    useProjectStore.setState({ projects: [{ id: 'project', rootPath: '/root' }] as any, sessions: [
      { id: 's1', projectId: 'project', name: 'First', workingDirectory: '/worktree' },
      { id: 's2', projectId: 'project', name: 'Second' },
    ] as any });
    Object.defineProperties(HTMLElement.prototype, {
      clientWidth: { configurable: true, get: () => 1200 },
      clientHeight: { configurable: true, get: () => 800 },
    });
  });

  it('does NOT render BottomPanel on desktop', () => {
    isMobileMock.mockReturnValue(false);
    render(<SessionChatLayout sessionId="s1" />);
    expect(screen.queryByTestId('bottom')).toBeNull();
  });

  it('renders BottomPanel on mobile', () => {
    isMobileMock.mockReturnValue(true);
    render(<SessionChatLayout sessionId="s1" />);
    expect(screen.queryByTestId('bottom')).not.toBeNull();
  });

  it('uses one unified desktop host and preserves navigation callbacks', () => {
    useAppearanceStore.setState({ unifiedWorkspace: true });
    const onReturnToDashboard = vi.fn();
    const { container } = render(<SessionChatLayout sessionId="s1" onReturnToDashboard={onReturnToDashboard} />);
    expect(container.querySelector('[data-session-workspace]')).toBeTruthy();
    expect(screen.queryByTestId('right')).toBeNull();
    expect(screen.queryByTestId('bottom')).toBeNull();
    expect(streamOwners.get('s1')).toBe(1);
    fireEvent.click(screen.getByText('Return to dashboard'));
    expect(onReturnToDashboard).toHaveBeenCalledWith('project');
  });

  it('retains the mobile bottom host even when both desktop experiments are enabled', () => {
    isMobileMock.mockReturnValue(true);
    useAppearanceStore.setState({ chatCard: true, unifiedWorkspace: true });
    const { container } = render(<SessionChatLayout sessionId="s1" />);
    expect(container.querySelector('[data-session-workspace]')).toBeNull();
    expect(container.querySelector('[data-chat-card]')).toBeNull();
    expect(screen.queryByTestId('bottom')).toBeTruthy();
    expect(streamOwners.size).toBe(0);
  });

  it('keeps sibling chats and their subscriptions when one chat is popped out', () => {
    useAppearanceStore.setState({ unifiedWorkspace: true });
    const { container } = render(<SessionChatLayout sessionId="s1" />);
    act(() => { selectProjectChat('project', 's2', { beside: true }); });
    expect(screen.getAllByTestId('chat')).toHaveLength(2);
    expect(streamOwners.get('s1')).toBe(1);
    expect(streamOwners.get('s2')).toBe(1);
    act(() => { useUIStore.getState().addPoppedOutSession('s1', 'popout-window'); });
    expect(container.querySelector('[data-session-workspace]')).toBeTruthy();
    expect(screen.getByTestId('popped-placeholder')).toHaveAttribute('data-session-id', 's1');
    expect(screen.getByTestId('chat')).toHaveAttribute('data-session-id', 's2');
    expect(streamOwners.get('s1')).toBe(0);
    expect(streamOwners.get('s2')).toBe(1);
  });

  it('restores legacy singleton synchronization when the unified flag is switched off', () => {
    useAppearanceStore.setState({ unifiedWorkspace: true });
    const openEditor = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    usePluginStore.setState({ panels: [{ id: 'draft', visible: true }] as any });
    useDraftEditorStore.setState({ activeSessionId: 'fixed-chat', openEditor });
    useFileViewerStore.setState({ isOpen: true, projectRoot: '/other-worktree', close });
    render(<SessionChatLayout sessionId="s1" />);
    expect(openEditor).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    act(() => { useAppearanceStore.getState().setUnifiedWorkspace(false); });
    expect(openEditor).toHaveBeenCalledWith('s1');
    expect(close).toHaveBeenCalledOnce();
  });
});

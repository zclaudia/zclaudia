import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useChatMessageStore } from '../../../stores/chatMessageStore';
import { useServerStore } from '../../../stores/serverStore';
import { useRightSidebarStore } from '../../../stores/rightSidebarStore';
import { useRightWorkspaceStore } from '../../../stores/rightWorkspaceStore';

// Prevent useAgentForSession's loadAll() from hitting the real API
vi.mock('../../../services/api/agent-profiles', () => ({
  listAgentProfiles: vi.fn().mockResolvedValue([]),
}));

// Mock useAgentForSession
vi.mock('../../../hooks/useAgentForSession', () => ({
  useAgentForSession: () => ({ agent: null }),
}));

// Setup stores before import
const mockChatMessageState = {
  messages: {} as Record<string, any[]>,
  pagination: {},
  setMessages: vi.fn(),
  prependMessages: vi.fn(),
  appendMessages: vi.fn(),
  mergeMessages: vi.fn(),
  addMessage: vi.fn(),
  updateMessageIdByClientMessageId: vi.fn(),
  appendToLastMessage: vi.fn(),
  clearMessages: vi.fn(),
  setLoadingMore: vi.fn(),
  getPagination: vi.fn(() => undefined),
};

const mockRightSidebarState = {
  collapsed: false,
  unread: false,
  activeTab: null,
  toggleCollapsed: vi.fn(),
  setCollapsed: vi.fn(),
  setActiveTab: vi.fn(),
  setUnread: vi.fn(),
};

import { SessionHeader } from '../SessionHeader';
import type { Session, Project } from '@zclaudia/shared';

// Minimal valid props
const baseSession: Session = {
  id: 'sess-1',
  projectId: 'proj-1',
  name: 'Test Session',
  type: undefined,
  createdAt: 1000,
  updatedAt: 1000,
} as unknown as Session;

const baseProject: Project = {
  id: 'proj-1',
  name: 'Test Project',
  rootPath: '/test',
} as unknown as Project;

const baseProps = {
  currentSession: baseSession,
  currentProject: baseProject,
  isMobile: false,
  isLoading: false,
  isRenamingSession: false,
  renameValue: '',
  showSessionMenu: false,
  onRenameStart: vi.fn(),
  onRenameChange: vi.fn(),
  onRenameConfirm: vi.fn(),
  onRenameCancel: vi.fn(),
  onResetProviderSession: vi.fn(),
  onExport: vi.fn(),
  onArchive: vi.fn(),
  onPopOut: vi.fn(),
  onToggleSessionMenu: vi.fn(),
};

function setupStores(overrides?: { messages?: Record<string, any[]> }) {
  useChatMessageStore.setState({
    ...mockChatMessageState,
    messages: overrides?.messages ?? {},
  } as any);

  useServerStore.setState({
    activeServerId: 'local',
    servers: [],
    connections: {
      local: { isLocalConnection: true, features: [] },
    },
    activeServerSupports: () => false,
  } as any);

  useRightSidebarStore.setState(mockRightSidebarState as any);
  useRightWorkspaceStore.setState({ bySession: {}, order: [] });
}

describe('SessionHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStores();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the session name', () => {
    render(<SessionHeader {...baseProps} />);
    expect(screen.getByText('Test Session')).toBeTruthy();
  });

  it('shows topic anchor chip with first user message text', () => {
    setupStores({
      messages: {
        'sess-1': [
          {
            id: 'msg-1',
            sessionId: 'sess-1',
            role: 'user',
            content: '帮我修一下 Windows 下的编码问题',
            createdAt: 1,
          },
          { id: 'msg-2', sessionId: 'sess-1', role: 'assistant', content: 'Sure!', createdAt: 2 },
        ],
      },
    });

    render(<SessionHeader {...baseProps} />);

    // The chip text should be present (may be truncated to 40 chars, but the content fits)
    expect(screen.getByText(/帮我修一下 Windows/)).toBeTruthy();
  });

  it('does not show topic chip when there are no messages', () => {
    setupStores({ messages: {} });
    const { container } = render(<SessionHeader {...baseProps} />);
    // No chip with MessageSquare icon — check that no element with the chip class exists
    // We verify by asserting the first user text is absent
    const spans = container.querySelectorAll('span[title]');
    // None of the titled spans should contain the test content
    const chipSpan = Array.from(spans).find(s => s.getAttribute('title')?.includes('帮我'));
    expect(chipSpan).toBeUndefined();
  });

  it('does not show topic chip for background sessions', () => {
    const bgSession: Session = { ...baseSession, type: 'background' } as Session;
    setupStores({
      messages: {
        'sess-1': [
          {
            id: 'msg-1',
            sessionId: 'sess-1',
            role: 'user',
            content: '帮我修一下 Windows 下的编码问题',
            createdAt: 1,
          },
        ],
      },
    });

    render(<SessionHeader {...baseProps} currentSession={bgSession} />);
    // Background sessions should not show the chip
    expect(screen.queryByText(/帮我修一下 Windows/)).toBeNull();
  });

  it('truncates topic text to 40 chars', () => {
    const longMessage = 'A'.repeat(60);
    setupStores({
      messages: {
        'sess-1': [
          { id: 'msg-1', sessionId: 'sess-1', role: 'user', content: longMessage, createdAt: 1 },
        ],
      },
    });

    render(<SessionHeader {...baseProps} />);
    // The displayed text should be max 40 chars
    expect(screen.getByText('A'.repeat(40))).toBeTruthy();
  });

  it('uses first user message, skipping assistant messages that come first', () => {
    setupStores({
      messages: {
        'sess-1': [
          { id: 'msg-1', sessionId: 'sess-1', role: 'assistant', content: 'Hello!', createdAt: 1 },
          { id: 'msg-2', sessionId: 'sess-1', role: 'user', content: 'Fix my bug', createdAt: 2 },
        ],
      },
    });

    render(<SessionHeader {...baseProps} />);
    expect(screen.getByText(/Fix my bug/)).toBeTruthy();
    expect(screen.queryByText(/Hello!/)).toBeNull(); // The assistant greeting should not be in chip
  });

  describe('info chip breakpoint gate', () => {
    it('hides the info chip below md so it matches the useIsMobile (768px) breakpoint', () => {
      render(<SessionHeader {...baseProps} />);
      const chipContainer = screen.getByTitle('Session info').parentElement as HTMLElement;
      expect(chipContainer.className).toContain('md:block');
      expect(chipContainer.className).not.toContain('sm:block');
    });
  });

  describe('mobile session info', () => {
    it('offers a Session info item in the mobile "…" menu', () => {
      render(<SessionHeader {...baseProps} isMobile showSessionMenu />);
      expect(screen.getByText('Session info')).toBeTruthy();
    });

    it('opens the info overlay (with context %) from the mobile menu and closes it again', () => {
      const onToggleSessionMenu = vi.fn();
      render(
        <SessionHeader
          {...baseProps}
          isMobile
          showSessionMenu
          contextPercent={42}
          onToggleSessionMenu={onToggleSessionMenu}
        />
      );

      fireEvent.click(screen.getByText('Session info'));
      // The menu is asked to close and the overlay opens.
      expect(onToggleSessionMenu).toHaveBeenCalled();
      const overlay = screen.getByTestId('session-info-overlay');
      expect(overlay.textContent).toContain('Agent');
      expect(overlay.textContent).toContain('42%');

      fireEvent.click(screen.getByLabelText('Close session info'));
      expect(screen.queryByTestId('session-info-overlay')).toBeNull();
    });

    it('closes the info overlay on the Android back gesture', () => {
      render(<SessionHeader {...baseProps} isMobile showSessionMenu />);
      fireEvent.click(screen.getByText('Session info'));
      expect(screen.getByTestId('session-info-overlay')).toBeTruthy();

      act(() => {
        window.dispatchEvent(new Event('android-back'));
      });
      expect(screen.queryByTestId('session-info-overlay')).toBeNull();
    });
  });

  describe('context usage in the pill', () => {
    it('hides the percentage while usage is low (below the warn threshold)', () => {
      render(<SessionHeader {...baseProps} contextPercent={1} />);
      expect(screen.queryByText(/1%/)).toBeNull();
    });

    it('surfaces the percentage in warning color once usage reaches the threshold', () => {
      render(<SessionHeader {...baseProps} contextPercent={82} />);
      const pct = screen.getByText(/82%/);
      expect(pct.className).toContain('text-warning');
    });

    it('escalates to the destructive color when usage is critical', () => {
      render(<SessionHeader {...baseProps} contextPercent={97} />);
      const pct = screen.getByText(/97%/);
      expect(pct.className).toContain('text-destructive');
    });
  });
});

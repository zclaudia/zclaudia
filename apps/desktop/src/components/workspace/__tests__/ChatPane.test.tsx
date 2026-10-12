import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../../features/chat/ChatPane';
import { WorkspaceNavigationContext } from '../WorkspaceContext';
import { useUIStore } from '../../../stores/uiStore';

const { route } = vi.hoisted(() => ({ route: vi.fn() }));
vi.mock('../../../features/chat/hooks/useSessionRoute', () => ({ useSessionRoute: route }));
vi.mock('../../../features/chat/ChatInterface', () => ({
  ChatInterface: (props: { sessionId: string; surface: string; onOpenSidebar?: () => void }) => (
    <button data-surface={props.surface} onClick={props.onOpenSidebar}>
      {props.sessionId}
    </button>
  ),
}));

describe('ChatPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ poppedOutSessions: new Map() });
  });

  it('owns its session stream independently of global selection and keeps navigation', () => {
    const onOpenSidebar = vi.fn();
    render(
      <WorkspaceNavigationContext.Provider value={{ onOpenSidebar }}>
        <ChatPane sessionId="pane-chat" />
      </WorkspaceNavigationContext.Provider>
    );
    expect(route).toHaveBeenCalledWith('pane-chat', { maintainDesiredState: true });
    const chat = screen.getByRole('button', { name: 'pane-chat' });
    expect(chat).toHaveAttribute('data-surface', 'card');
    chat.click();
    expect(onOpenSidebar).toHaveBeenCalledOnce();
  });

  it('releases stream ownership when its chat is popped out', () => {
    useUIStore.setState({ poppedOutSessions: new Map([['pane-chat', 'chat-window']]) });
    render(<ChatPane sessionId="pane-chat" />);
    expect(route).toHaveBeenCalledWith('pane-chat', { maintainDesiredState: false });
  });
});

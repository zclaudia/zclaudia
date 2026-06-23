// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const isMobileMock = vi.fn();
vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => isMobileMock(),
  isMobileViewport: () => isMobileMock(),
}));

vi.mock('../ChatInterface', () => ({
  ChatInterface: ({ beforeComposer }: { beforeComposer?: React.ReactNode }) => (
    <div data-testid="chat">{beforeComposer ?? null}</div>
  ),
}));
vi.mock('../../../components/RightSidebar', () => ({ RightSidebar: () => <div data-testid="right" /> }));
vi.mock('../../../components/BottomPanel', () => ({ BottomPanel: () => <div data-testid="bottom" /> }));

import { SessionChatLayout } from '../SessionChatLayout';

describe('SessionChatLayout bottom panel placement', () => {
  beforeEach(() => isMobileMock.mockReset());

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
});

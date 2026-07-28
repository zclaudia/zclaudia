import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  openToolInWorkspace: vi.fn(),
  selectedSessionId: 's1' as string | null,
}));

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ sendMessage: mocks.sendMessage }),
}));
vi.mock('../../../stores/selectionStore', () => ({
  useSelectionStore: (sel: (s: { selectedSessionId: string | null }) => unknown) =>
    sel({ selectedSessionId: mocks.selectedSessionId }),
}));
vi.mock('../../../utils/workspaceActions', () => ({
  openToolInWorkspace: mocks.openToolInWorkspace,
}));

import { ChatLink } from '../ChatLink';

describe('ChatLink', () => {
  beforeEach(() => {
    mocks.sendMessage.mockClear();
    mocks.openToolInWorkspace.mockClear();
    mocks.selectedSessionId = 's1';
  });

  it('plain left-click on an http(s) link opens it in the browser panel', () => {
    const { getByText } = render(<ChatLink href="http://localhost:5173/">dev</ChatLink>);
    const ev = fireEvent.click(getByText('dev'));
    expect(ev).toBe(false); // preventDefault called
    expect(mocks.sendMessage).toHaveBeenNthCalledWith(1, { type: 'browser_open', sessionId: 's1' });
    expect(mocks.sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'browser_navigate',
      sessionId: 's1',
      url: 'http://localhost:5173/',
    });
    expect(mocks.openToolInWorkspace).toHaveBeenCalledWith('s1', 'browser');
  });

  it('modifier clicks fall through to the default anchor behavior', () => {
    const { getByText } = render(<ChatLink href="https://example.com">x</ChatLink>);
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
      fireEvent.click(getByText('x'), init);
    }
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.openToolInWorkspace).not.toHaveBeenCalled();
  });

  it('non-http(s) hrefs are never intercepted', () => {
    const { getByText } = render(<ChatLink href="mailto:a@b.c">mail</ChatLink>);
    fireEvent.click(getByText('mail'));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('falls through when no session is selected', () => {
    mocks.selectedSessionId = null;
    const { getByText } = render(<ChatLink href="https://example.com">x</ChatLink>);
    fireEvent.click(getByText('x'));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('renders the existing anchor visuals and attributes', () => {
    const { getByText } = render(<ChatLink href="https://example.com">x</ChatLink>);
    const a = getByText('x') as HTMLAnchorElement;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.className).toContain('text-primary');
  });
});

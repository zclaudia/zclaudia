import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { MessageWithToolCalls } from '../../../stores/chatMessageStore';

// ── Mocks ──────────────────────────────────────────────────────────────────────
//
// This file deliberately does NOT mock `react-markdown` / `remark-gfm` (unlike
// the sibling MessageList.test.tsx, which stubs react-markdown for speed and
// therefore never invokes the `a` component renderer). We need the real
// markdown pipeline here specifically to exercise the ReactMarkdown ->
// `components.a` -> ChatLink wiring end to end. Everything else MessageList
// touches is mocked the same way the ChatLink unit test mocks it
// (ConnectionContext, selectionStore, workspaceActions, openPanel), plus the
// supporting stores/components MessageList imports at module scope that are
// irrelevant to a plain assistant text message (tool calls, file push, etc).

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  openToolInWorkspace: vi.fn(),
  isConnected: true,
  isPanelAvailable: vi.fn(),
}));

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
  isDarkTheme: () => true,
}));

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ sendMessage: mocks.sendMessage, isConnected: mocks.isConnected }),
}));

vi.mock('../../../stores/filePushStore', () => ({
  useFilePushStore: Object.assign((selector: any) => selector({ items: [] }), {
    getState: () => ({ items: [] }),
  }),
}));

vi.mock('../../../stores/terminalStore', () => ({
  getTerminalScopeKey: (projectId: string, backendId: string | null | undefined) =>
    `${backendId ?? 'no-backend'}::${projectId}`,
  useTerminalStore: Object.assign((selector: any) => selector({ terminals: {} }), {
    getState: () => ({ terminals: {} }),
  }),
}));

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: Object.assign(
    (selector: any) => selector({ selectedSessionId: null, sessions: [] }),
    { getState: () => ({ selectedSessionId: null, sessions: [] }) }
  ),
}));

vi.mock('../../../stores/selectionStore', () => ({
  useSelectionStore: (sel: (s: { selectedSessionId: string | null }) => unknown) =>
    sel({ selectedSessionId: 's1' }),
}));

vi.mock('../../../stores/serverStore', () => ({
  useServerStore: Object.assign((selector: any) => selector({}), {
    getState: () => ({ activeServerSupports: () => false }),
  }),
}));

vi.mock('../../../utils/workspaceActions', () => ({
  openToolInWorkspace: mocks.openToolInWorkspace,
  closeToolInWorkspace: vi.fn(),
  useToolOpenState: vi.fn(() => false),
}));

vi.mock('../../../utils/openPanel', () => ({
  isPanelAvailable: mocks.isPanelAvailable,
  activatePanel: vi.fn(),
}));

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: string }) => <pre>{children}</pre>,
}));

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
  oneLight: {},
}));

vi.mock('../tool-call/ToolCallList', () => ({
  ToolCallList: () => <div data-testid="tool-call-list" />,
}));

vi.mock('../FilePushNotification', () => ({
  FilePushCard: () => <div data-testid="file-push-card" />,
}));

vi.mock('../FilePreviewModal', () => ({
  FilePreviewModal: () => <div data-testid="file-preview-modal" />,
}));

vi.mock('../../../services/fileUpload', () => ({
  downloadFile: vi.fn(),
}));

vi.mock('../FileReference', () => ({
  TextWithFileRefs: ({ text }: { text: string }) => <span>{text}</span>,
  MarkdownChildrenWithFileRefs: ({ children }: any) => <>{children}</>,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { MessageList } from '../MessageList';

function makeMessage(
  overrides: Partial<MessageWithToolCalls> & { id: string; role: 'user' | 'assistant' | 'system' }
): MessageWithToolCalls {
  return {
    sessionId: 's1',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('MessageList -> ChatLink wiring (real react-markdown)', () => {
  beforeEach(() => {
    mocks.sendMessage.mockClear();
    mocks.openToolInWorkspace.mockClear();
    mocks.isConnected = true;
    mocks.isPanelAvailable.mockReset();
    mocks.isPanelAvailable.mockReturnValue(true);
  });

  it('renders an http link from assistant markdown with target=_blank and intercepts a plain click', () => {
    const messages = [
      makeMessage({
        id: 'm1',
        role: 'assistant',
        content: 'See the [docs](http://example.com/docs) for details.',
      }),
    ];

    const { getByText } = render(<MessageList messages={messages} />);
    const anchor = getByText('docs') as HTMLAnchorElement;

    expect(anchor.tagName).toBe('A');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('href')).toBe('http://example.com/docs');

    const result = fireEvent.click(anchor);
    expect(result).toBe(false); // preventDefault called -> intercepted
    expect(mocks.sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'browser_open',
      sessionId: 's1',
    });
    expect(mocks.sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'browser_navigate',
      sessionId: 's1',
      url: 'http://example.com/docs',
    });
    expect(mocks.openToolInWorkspace).toHaveBeenCalledWith('s1', 'browser');
  });
});

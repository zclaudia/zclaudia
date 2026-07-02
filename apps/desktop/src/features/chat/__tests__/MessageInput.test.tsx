import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageInput } from '../MessageInput';
import { MAX_MESSAGE_ATTACHMENT_BYTES } from '@zclaudia/shared';
import type { SlashCommand } from '@zclaudia/shared';

// Mock hooks
vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

// Mock composerStore
const mockSetDraft = vi.fn();
const mockClearDraft = vi.fn();
vi.mock('../../../stores/composerStore', () => ({
  useComposerStore: (selector: any) => {
    const state = {
      setDraft: mockSetDraft,
      clearDraft: mockClearDraft,
    };
    return selector(state);
  },
}));

// Mock api
const { mockGetWorkspaceSkillsResult } = vi.hoisted(() => ({
  mockGetWorkspaceSkillsResult: vi.fn(),
}));
vi.mock('../../../services/api', () => ({
  listDirectory: vi.fn().mockResolvedValue({ entries: [] }),
  getWorkspaceSkillsResult: mockGetWorkspaceSkillsResult,
}));

// Mock commands for testing
const mockCommands: SlashCommand[] = [
  { command: '/clear', description: 'Clear chat history', source: 'local' },
  { command: '/help', description: 'Show help information', source: 'local' },
  { command: '/model', description: 'Show current model info', source: 'local' },
  { command: '/compact', description: 'Compact conversation history', source: 'provider' },
  { command: '/config', description: 'Open Claude config', source: 'provider' },
  { command: '/cost', description: 'Show token usage and cost', source: 'provider' },
];

describe('MessageInput', () => {
  const defaultProps = {
    sessionId: 'session-1',
    onSend: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspaceSkillsResult.mockResolvedValue({ skills: [], diagnostics: [] });
  });

  function makeFile(name: string, type: string, size: number): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { configurable: true, value: size });
    return file;
  }

  // ── Basic rendering ─────────────────────────────────────────────────────

  it('renders textarea with default placeholder', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
  });

  it('renders textarea with custom placeholder', () => {
    render(<MessageInput {...defaultProps} placeholder="Ask me anything..." />);
    expect(screen.getByPlaceholderText('Ask me anything...')).toBeInTheDocument();
  });

  it('renders the send button', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTitle('Send message (Enter)')).toBeInTheDocument();
  });

  it('renders the attachment button', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTitle('Add attachment (images, files)')).toBeInTheDocument();
  });

  // ── Composer box layout ───────────────────────────────────────────────────

  it('places attach and send inside the bordered input box', () => {
    const { getByTestId } = render(<MessageInput {...defaultProps} />);
    const box = getByTestId('composer-box');
    expect(box.querySelector('[data-testid="message-input"]')).not.toBeNull();
    expect(box.querySelector('[data-testid="attach-button"]')).not.toBeNull();
    expect(box.querySelector('[data-testid="send-button"]')).not.toBeNull();
  });

  it('shows the multiline toggle when onToggleAdvanced is provided', () => {
    const { getByTestId } = render(<MessageInput {...defaultProps} onToggleAdvanced={() => {}} />);
    expect(getByTestId('advanced-toggle')).toBeInTheDocument();
  });

  it('hides the multiline toggle when onToggleAdvanced is not provided', () => {
    const { queryByTestId } = render(<MessageInput {...defaultProps} />);
    expect(queryByTestId('advanced-toggle')).toBeNull();
  });

  it('calls onToggleAdvanced when the multiline toggle is clicked', () => {
    const onToggleAdvanced = vi.fn();
    const { getByTestId } = render(
      <MessageInput {...defaultProps} onToggleAdvanced={onToggleAdvanced} />
    );
    fireEvent.click(getByTestId('advanced-toggle'));
    expect(onToggleAdvanced).toHaveBeenCalledTimes(1);
  });

  it('drops the old helper-text lines', () => {
    const { queryByText } = render(<MessageInput {...defaultProps} />);
    expect(queryByText(/Paste images with/)).toBeNull();
    expect(queryByText(/Type \/ for commands and skills/)).toBeNull();
  });

  // ── Text input ────────────────────────────────────────────────────────────

  it('updates value when typing', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    expect(textarea).toHaveValue('Hello world');
  });

  it('persists draft to store on change', () => {
    vi.useFakeTimers();
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'draft text' } });
    vi.advanceTimersByTime(300);
    expect(mockSetDraft).toHaveBeenCalledWith('session-1', {
      content: 'draft text',
      attachments: [],
    });
    vi.useRealTimers();
  });

  it('renders with initialValue', () => {
    render(<MessageInput {...defaultProps} initialValue="Prefilled text" />);
    const textarea = screen.getByRole('textbox');
    expect((textarea as HTMLTextAreaElement).value).toBe('Prefilled text');
  });

  // ── Send behavior ─────────────────────────────────────────────────────────

  it('sends message on Enter', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Hello world', undefined);
  });

  it('clears value and draft after sending', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea).toHaveValue('');
    expect(mockClearDraft).toHaveBeenCalledWith('session-1');
  });

  it('sends on Cmd+Enter', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledWith('Test', undefined);
  });

  it('sends on Ctrl+Enter', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith('Test', undefined);
  });

  it('sends message via send button click', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    expect(onSend).toHaveBeenCalledWith('Hello', undefined);
    expect(textarea).toHaveValue('');
  });

  it('guards against duplicate rapid submissions before input state clears', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    const sendButton = screen.getByTitle('Send message (Enter)');

    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Hello', undefined);
  });

  it('trims whitespace from message before sending', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '  Hello world  ' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    expect(onSend).toHaveBeenCalledWith('Hello world', undefined);
  });

  it('does not send empty message', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send whitespace-only message', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '   ' } });
    const sendButton = screen.getByTitle('Send message (Enter)');
    expect(sendButton).toBeDisabled();
  });

  it('does not send on Shift+Enter (allows newline)', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  // ── Disabled state ────────────────────────────────────────────────────────

  it('disables textarea when disabled prop is true', () => {
    render(<MessageInput {...defaultProps} disabled />);
    expect(screen.getByPlaceholderText(/Type a message/)).toBeDisabled();
  });

  it('disables send button when disabled prop is true', () => {
    render(<MessageInput {...defaultProps} disabled />);
    expect(screen.getByTestId('send-button')).toBeDisabled();
  });

  it('disables attachment button when disabled prop is true', () => {
    render(<MessageInput {...defaultProps} disabled />);
    expect(screen.getByTitle('Add attachment (images, files)')).toBeDisabled();
  });

  it('does not send when disabled even if value is present', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} disabled />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  // ── Loading/cancel state ──────────────────────────────────────────────────

  it('shows cancel button when isLoading is true', () => {
    const onCancel = vi.fn();
    render(<MessageInput {...defaultProps} onCancel={onCancel} isLoading />);
    expect(screen.getByTitle('Cancel (Esc)')).toBeInTheDocument();
    expect(screen.queryByTitle('Send message (Enter)')).not.toBeInTheDocument();
  });

  it('shows send button when not loading', () => {
    render(<MessageInput {...defaultProps} onCancel={vi.fn()} />);
    expect(screen.getByTitle('Send message (Enter)')).toBeInTheDocument();
    expect(screen.queryByTitle('Cancel (Esc)')).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<MessageInput {...defaultProps} onCancel={onCancel} isLoading />);
    fireEvent.click(screen.getByTitle('Cancel (Esc)'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel on Escape when loading', () => {
    const onCancel = vi.fn();
    render(<MessageInput {...defaultProps} onCancel={onCancel} isLoading />);
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not call onCancel on Escape when not loading', () => {
    const onCancel = vi.fn();
    render(<MessageInput {...defaultProps} onCancel={onCancel} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  // ── Slash commands ────────────────────────────────────────────────────────

  describe('slash commands', () => {
    it('shows command suggestions when typing /', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      expect(screen.getByText('/clear')).toBeInTheDocument();
      expect(screen.getByText('/help')).toBeInTheDocument();
      expect(screen.getByText('/model')).toBeInTheDocument();
    });

    it('filters commands based on input', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/cl' } });
      expect(screen.getByText('/clear')).toBeInTheDocument();
      expect(screen.queryByText('/help')).not.toBeInTheDocument();
    });

    it('hides command suggestions when input has space', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/clear ' } });
      expect(screen.queryByText('Clear chat history')).not.toBeInTheDocument();
    });

    it('shows no suggestions when commands prop is empty', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={[]} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      expect(screen.queryByText('/clear')).not.toBeInTheDocument();
    });

    it('calls onCommand when slash command is sent', () => {
      const onCommand = vi.fn();
      render(<MessageInput {...defaultProps} onCommand={onCommand} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/clear ' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onCommand).toHaveBeenCalledWith('/clear', '');
    });

    it('passes args to onCommand', () => {
      const onCommand = vi.fn();
      render(<MessageInput {...defaultProps} onCommand={onCommand} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/model zclaudia-1' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onCommand).toHaveBeenCalledWith('/model', 'zclaudia-1');
    });

    it('shows provider commands in suggestions', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/co' } });
      expect(screen.getByText('/compact')).toBeInTheDocument();
      expect(screen.getByText('/config')).toBeInTheDocument();
      expect(screen.getByText('/cost')).toBeInTheDocument();
    });

    it('calls onCommand for provider commands', () => {
      const onCommand = vi.fn();
      render(<MessageInput {...defaultProps} onCommand={onCommand} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/cost ' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onCommand).toHaveBeenCalledWith('/cost', '');
    });

    it('selects command on Enter key in dropdown', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      // Enter selects the first command
      fireEvent.keyDown(textarea, { key: 'Enter' });
      // The command should be filled in the textarea
      expect((textarea as HTMLTextAreaElement).value).toContain('/clear');
    });

    it('navigates commands with ArrowDown', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      // Press ArrowDown to move selection, then Enter
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      // Should have selected the second command (/help)
      expect((textarea as HTMLTextAreaElement).value).toContain('/help');
    });

    it('navigates commands with ArrowUp', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      // ArrowUp wraps to last command
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      // Should have selected the last command (/cost)
      expect((textarea as HTMLTextAreaElement).value).toContain('/cost');
    });

    it('closes command suggestions on Escape', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      expect(screen.getByText('/clear')).toBeInTheDocument();
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(screen.queryByText('/clear')).not.toBeInTheDocument();
    });

    it('command suggestion item is clickable', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      fireEvent.click(screen.getByText('/help'));
      expect((textarea as HTMLTextAreaElement).value).toContain('/help');
    });

    it('shows user-invocable workspace skills before commands using usage ranking', async () => {
      mockGetWorkspaceSkillsResult.mockResolvedValue({
        diagnostics: [],
        skills: [
          {
            id: 'release-notes',
            name: 'release-notes',
            description: 'Write release notes',
            path: '/skills/release-notes/SKILL.md',
            source: 'workspace',
            eligible: true,
            metadata: { argumentHint: '<ticket> <title>' },
            execution: { defaultMode: 'fork' },
            usage: { count: 3, lastUsedAt: 3000 },
          },
          {
            id: 'model-only',
            name: 'model-only',
            description: 'Hidden skill',
            path: '/skills/model-only/SKILL.md',
            source: 'workspace',
            eligible: true,
            metadata: { userInvocable: false },
          },
        ],
      });
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);

      await waitFor(() => expect(mockGetWorkspaceSkillsResult).toHaveBeenCalled());
      fireEvent.change(textarea, { target: { value: '/r' } });

      expect(screen.getByText('/release-notes')).toBeInTheDocument();
      expect(screen.getByText('<ticket> <title>')).toBeInTheDocument();
      expect(screen.getByText('×3')).toBeInTheDocument();
      expect(screen.getByText('workspace')).toBeInTheDocument();
      expect(screen.getByText('fork')).toBeInTheDocument();
      expect(screen.queryByText('/model-only')).not.toBeInTheDocument();
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect((textarea as HTMLTextAreaElement).value).toBe('/release-notes ');
    });

    it('refreshes workspace skills after sending a direct slash skill message', async () => {
      const onSend = vi.fn();
      mockGetWorkspaceSkillsResult.mockResolvedValue({
        diagnostics: [],
        skills: [
          {
            id: 'release-notes',
            name: 'release-notes',
            description: 'Write release notes',
            path: '/skills/release-notes/SKILL.md',
            source: 'workspace',
            eligible: true,
          },
        ],
      });
      render(
        <MessageInput
          {...defaultProps}
          onSend={onSend}
          onCommand={vi.fn()}
          commands={mockCommands}
        />
      );
      const textarea = screen.getByPlaceholderText(/Type a message/);
      await waitFor(() => expect(mockGetWorkspaceSkillsResult).toHaveBeenCalledTimes(1));

      fireEvent.change(textarea, { target: { value: '/release-notes ZOOM-1' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(onSend).toHaveBeenCalledWith('/release-notes ZOOM-1', undefined);
      await waitFor(() => expect(mockGetWorkspaceSkillsResult).toHaveBeenCalledTimes(2));
    });

    it('handles plugin commands with colon', () => {
      const onCommand = vi.fn();
      render(<MessageInput {...defaultProps} onCommand={onCommand} commands={[]} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/plugin:action arg1' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onCommand).toHaveBeenCalledWith('/plugin:action', 'arg1');
    });

    it('sends unknown /command as regular message if not known and no colon', () => {
      const onSend = vi.fn();
      const onCommand = vi.fn();
      render(
        <MessageInput
          {...defaultProps}
          onSend={onSend}
          onCommand={onCommand}
          commands={mockCommands}
        />
      );
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/unknowncmd arg' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      // Not a known command and no colon, so treated as regular message
      expect(onSend).toHaveBeenCalledWith('/unknowncmd arg', undefined);
      expect(onCommand).not.toHaveBeenCalled();
    });
  });

  // ── Advanced mode ─────────────────────────────────────────────────────────

  describe('advanced mode', () => {
    it('renders larger textarea in advanced mode', () => {
      render(<MessageInput {...defaultProps} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
      expect(textarea.style.minHeight).toBe('160px');
      expect(textarea.className).toContain('resize-none');
    });

    it('renders normal textarea with smaller min-height when not in advanced mode', () => {
      render(<MessageInput {...defaultProps} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      expect(textarea.className).toContain('h-6');
      expect(textarea.className).toContain('leading-6');
      expect(textarea.className).toContain('resize-none');
      const box = screen.getByTestId('composer-box');
      expect(box.className).toContain('items-center');
      expect(box.className).toContain('min-h-12');
      expect(box.className).not.toContain('items-end');
    });

    it('pins single-line collapsed composer height to the shared control size', () => {
      render(<MessageInput {...defaultProps} />);
      const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 40 });
      fireEvent.change(textarea, { target: { value: 'short' } });
      expect(textarea.style.height).toBe('24px');
    });

    it('uses a stacked desktop advanced composer so controls do not indent the text area', () => {
      render(<MessageInput {...defaultProps} advancedMode />);
      const box = screen.getByTestId('composer-box');
      expect(box.className).toContain('flex-col');
      expect(box.className).not.toContain('items-center');
      expect(box.querySelector('[data-testid="message-input"]')).not.toBeNull();
      expect(box.querySelector('[data-testid="attach-button"]')).not.toBeNull();
      expect(box.querySelector('[data-testid="send-button"]')).not.toBeNull();
    });

    it('keeps collapsed desktop composer center-aligned even once content exceeds a single line', () => {
      render(<MessageInput {...defaultProps} />);
      const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 72 });
      fireEvent.change(textarea, { target: { value: 'line 1\nline 2' } });
      const box = screen.getByTestId('composer-box');
      expect(box.className).toContain('items-center');
      expect(box.className).not.toContain('items-end');
    });

    it('does not send on plain Enter in advanced mode (desktop)', () => {
      const onSend = vi.fn();
      render(<MessageInput {...defaultProps} onSend={onSend} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'Test' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSend).not.toHaveBeenCalled();
    });

    it('sends on Cmd+Enter in advanced mode', () => {
      const onSend = vi.fn();
      render(<MessageInput {...defaultProps} onSend={onSend} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'Test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onSend).toHaveBeenCalledWith('Test', undefined);
    });

    it('sends on Ctrl+Enter in advanced mode', () => {
      const onSend = vi.fn();
      render(<MessageInput {...defaultProps} onSend={onSend} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'Test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onSend).toHaveBeenCalledWith('Test', undefined);
    });

    it('inserts spaces on Tab in advanced mode', () => {
      render(<MessageInput {...defaultProps} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'hello' } });
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(textarea.value).toContain('  ');
    });

    it('shows send button with Cmd+Enter title in advanced mode', () => {
      render(<MessageInput {...defaultProps} advancedMode />);
      expect(screen.getByTitle(/Send message \((Cmd|Ctrl)\+Enter\)/)).toBeInTheDocument();
    });

    it('restores vertical scrolling when switching to advanced mode', () => {
      const { rerender } = render(<MessageInput {...defaultProps} />);
      const collapsedTextarea = screen.getByPlaceholderText(
        /Type a message/
      ) as HTMLTextAreaElement;
      fireEvent.change(collapsedTextarea, { target: { value: 'short' } });
      expect(collapsedTextarea.style.overflowY).toBe('hidden');
      rerender(<MessageInput {...defaultProps} advancedMode />);
      const advancedTextarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
      expect(advancedTextarea.style.overflowY).toBe('auto');
    });
  });

  // ── Attachments ───────────────────────────────────────────────────────────

  describe('attachments', () => {
    it('renders hidden file input for attachments', () => {
      const { container } = render(<MessageInput {...defaultProps} />);
      const fileInput = container.querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();
      expect(fileInput?.className).toContain('hidden');
    });

    it('file input accepts correct file types', () => {
      const { container } = render(<MessageInput {...defaultProps} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput.accept).toContain('image/*');
      expect(fileInput.accept).toContain('.pdf');
      expect(fileInput.accept).toContain('.txt');
    });

    it('send button is disabled when no text and no attachments', () => {
      render(<MessageInput {...defaultProps} />);
      expect(screen.getByTestId('send-button')).toBeDisabled();
    });

    it('shows remove button for attachments via initialAttachments', () => {
      const initialAttachments = [
        {
          id: 'att-1',
          type: 'image' as const,
          name: 'photo.png',
          data: 'data:image/png;base64,abc',
          mimeType: 'image/png',
        },
      ];
      render(<MessageInput {...defaultProps} initialAttachments={initialAttachments} />);
      expect(screen.getByLabelText('Remove attachment photo.png')).toBeInTheDocument();
    });

    it('removes attachment when remove button is clicked', () => {
      const initialAttachments = [
        {
          id: 'att-1',
          type: 'image' as const,
          name: 'photo.png',
          data: 'data:image/png;base64,abc',
          mimeType: 'image/png',
        },
      ];
      render(<MessageInput {...defaultProps} initialAttachments={initialAttachments} />);
      fireEvent.click(screen.getByLabelText('Remove attachment photo.png'));
      expect(screen.queryByLabelText('Remove attachment photo.png')).not.toBeInTheDocument();
    });

    it('shows file attachment with file icon', () => {
      const initialAttachments = [
        {
          id: 'att-1',
          type: 'file' as const,
          name: 'report.pdf',
          data: 'data:application/pdf;base64,abc',
          mimeType: 'application/pdf',
        },
      ];
      render(<MessageInput {...defaultProps} initialAttachments={initialAttachments} />);
      expect(screen.getByText('report.pdf')).toBeInTheDocument();
    });

    it('shows image attachment as thumbnail', () => {
      const initialAttachments = [
        {
          id: 'att-1',
          type: 'image' as const,
          name: 'photo.png',
          data: 'data:image/png;base64,abc',
          mimeType: 'image/png',
        },
      ];
      const { container } = render(
        <MessageInput {...defaultProps} initialAttachments={initialAttachments} />
      );
      const img = container.querySelector('img');
      expect(img).toBeInTheDocument();
      expect(img?.alt).toBe('photo.png');
    });

    it('sends with attachments', () => {
      const onSend = vi.fn();
      const initialAttachments = [
        {
          id: 'att-1',
          type: 'image' as const,
          name: 'photo.png',
          data: 'data:image/png;base64,abc',
          mimeType: 'image/png',
        },
      ];
      render(
        <MessageInput {...defaultProps} onSend={onSend} initialAttachments={initialAttachments} />
      );
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'with image' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSend).toHaveBeenCalledWith('with image', initialAttachments);
    });

    it('clears attachments after sending', () => {
      const onSend = vi.fn();
      const initialAttachments = [
        {
          id: 'att-1',
          type: 'image' as const,
          name: 'photo.png',
          data: 'data:image/png;base64,abc',
          mimeType: 'image/png',
        },
      ];
      render(
        <MessageInput {...defaultProps} onSend={onSend} initialAttachments={initialAttachments} />
      );
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'msg' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      // After sending, attachments should be cleared
      expect(screen.queryByLabelText('Remove attachment photo.png')).not.toBeInTheDocument();
    });

    it('can send with only attachments and no text', () => {
      const onSend = vi.fn();
      const initialAttachments = [
        {
          id: 'att-1',
          type: 'image' as const,
          name: 'photo.png',
          data: 'data:image/png;base64,abc',
          mimeType: 'image/png',
        },
      ];
      render(
        <MessageInput {...defaultProps} onSend={onSend} initialAttachments={initialAttachments} />
      );
      // Send button should be enabled because attachments exist
      const sendBtn = screen.getByTestId('send-button');
      expect(sendBtn).not.toBeDisabled();
      fireEvent.click(sendBtn);
      expect(onSend).toHaveBeenCalledWith('', initialAttachments);
    });

    it('persists attachment-only draft after removing attachments', () => {
      vi.useFakeTimers();
      const initialAttachments = [
        {
          id: 'att-1',
          type: 'image' as const,
          name: 'photo.png',
          data: 'data:image/png;base64,abc',
          mimeType: 'image/png',
        },
      ];
      render(<MessageInput {...defaultProps} initialAttachments={initialAttachments} />);
      fireEvent.click(screen.getByLabelText('Remove attachment photo.png'));
      vi.advanceTimersByTime(300);
      expect(mockSetDraft).toHaveBeenLastCalledWith('session-1', { content: '', attachments: [] });
      vi.useRealTimers();
    });

    it('rejects oversized selected files before reading them into memory', async () => {
      const readAsDataURL = vi.spyOn(FileReader.prototype, 'readAsDataURL');
      const { container } = render(<MessageInput {...defaultProps} />);
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('huge.pdf', 'application/pdf', MAX_MESSAGE_ATTACHMENT_BYTES + 1);

      fireEvent.change(fileInput, { target: { files: [file] } });

      expect(readAsDataURL).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        '"huge.pdf" is too large. Attachments must be 10 MB or smaller.'
      );
      expect(screen.queryByText('huge.pdf')).not.toBeInTheDocument();
      readAsDataURL.mockRestore();
    });

    it('rejects oversized pasted images before reading them into memory', async () => {
      const readAsDataURL = vi.spyOn(FileReader.prototype, 'readAsDataURL');
      render(<MessageInput {...defaultProps} />);
      const textarea = screen.getByTestId('message-input');
      const file = makeFile('huge.png', 'image/png', MAX_MESSAGE_ATTACHMENT_BYTES + 1);

      fireEvent.paste(textarea, {
        clipboardData: {
          items: [{ type: 'image/png', getAsFile: () => file }],
        },
      });

      expect(readAsDataURL).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        '"huge.png" is too large. Attachments must be 10 MB or smaller.'
      );
      expect(screen.queryByLabelText('Remove attachment huge.png')).not.toBeInTheDocument();
      readAsDataURL.mockRestore();
    });
  });

  // ── IME composition handling ──────────────────────────────────────────────

  describe('IME composition', () => {
    it('does not send during IME composition', () => {
      const onSend = vi.fn();
      render(<MessageInput {...defaultProps} onSend={onSend} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'test' } });
      fireEvent.compositionStart(textarea);
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSend).not.toHaveBeenCalled();
    });
  });

  // ── data-testid ───────────────────────────────────────────────────────────

  it('textarea has data-testid="message-input"', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTestId('message-input')).toBeInTheDocument();
  });

  it('send button has data-testid="send-button"', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTestId('send-button')).toBeInTheDocument();
  });
});

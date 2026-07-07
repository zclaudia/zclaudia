import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageInput } from './MessageInput';
import type { SlashCommand } from '@zclaudia/shared';

// Mock hooks
let mockIsMobile = false;
vi.mock('../../hooks/useMediaQuery', () => ({
  useIsMobile: () => mockIsMobile,
}));

// Mock composerStore
const mockSetDraft = vi.fn();
const mockClearDraft = vi.fn();
vi.mock('../../stores/composerStore', () => ({
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
vi.mock('../../services/api', () => ({
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
    vi.useRealTimers();
    mockIsMobile = false;
    mockGetWorkspaceSkillsResult.mockResolvedValue({ skills: [], diagnostics: [] });
  });

  // ── Basic rendering ─────────────────────────────────────────────────────

  it('renders textarea with default placeholder', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
  });

  it('renders textarea with custom placeholder', () => {
    render(<MessageInput {...defaultProps} placeholder="Custom placeholder" />);
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument();
  });

  it('renders the send button', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTitle('Send message (Enter)')).toBeInTheDocument();
  });

  it('renders the attachment button', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTitle('Add attachment (images, files)')).toBeInTheDocument();
  });

  // ── Text input ────────────────────────────────────────────────────────────

  it('updates value when typing', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    expect(textarea).toHaveValue('Hello world');
  });

  it('persists draft to store after debounce', () => {
    vi.useFakeTimers();
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'draft text' } });
    expect(mockSetDraft).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(mockSetDraft).toHaveBeenCalledWith('session-1', {
      content: 'draft text',
      attachments: [],
    });
  });

  it('renders with initialValue', () => {
    render(<MessageInput {...defaultProps} initialValue="Prefilled text" />);
    const textarea = screen.getByRole('textbox');
    expect((textarea as HTMLTextAreaElement).value).toBe('Prefilled text');
  });

  // ── Send behavior ─────────────────────────────────────────────────────────

  it('calls onSend when clicking send button with valid message', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    expect(onSend).toHaveBeenCalledWith('Hello', undefined);
    expect(textarea).toHaveValue('');
  });

  it('clears draft after sending', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockClearDraft).toHaveBeenCalledWith('session-1');
  });

  it('sends on Enter without modifier', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Test', undefined);
  });

  it('sends on Cmd+Enter', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledWith('Test message', undefined);
  });

  it('sends on Ctrl+Enter', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith('Test message', undefined);
  });

  it('does not call onSend with empty message', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not call onSend with whitespace only message', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(screen.getByTitle('Send message (Enter)')).toBeDisabled();
  });

  it('does not send on Shift+Enter (allows newline)', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('trims whitespace from message before sending', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '  Hello world  ' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    expect(onSend).toHaveBeenCalledWith('Hello world', undefined);
  });

  // ── Disabled state ────────────────────────────────────────────────────────

  it('disables textarea when disabled prop is true', () => {
    render(<MessageInput {...defaultProps} disabled />);
    expect(screen.getByPlaceholderText(/Type a message/)).toBeDisabled();
  });

  it('disables send button when disabled', () => {
    render(<MessageInput {...defaultProps} disabled />);
    expect(screen.getByTestId('send-button')).toBeDisabled();
  });

  it('does not send when disabled even with value', () => {
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

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<MessageInput {...defaultProps} onCancel={onCancel} isLoading />);
    fireEvent.click(screen.getByTitle('Cancel (Esc)'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel on Escape when loading', () => {
    const onCancel = vi.fn();
    render(<MessageInput {...defaultProps} onCancel={onCancel} isLoading />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows send button when not loading', () => {
    render(<MessageInput {...defaultProps} onCancel={vi.fn()} />);
    expect(screen.getByTitle('Send message (Enter)')).toBeInTheDocument();
    expect(screen.queryByTitle('Cancel (Esc)')).not.toBeInTheDocument();
  });

  // ── Slash commands ────────────────────────────────────────────────────────

  describe('slash commands', () => {
    it('shows command suggestions when typing /', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      expect(screen.getByText('/clear')).toBeInTheDocument();
      expect(screen.getByText('/help')).toBeInTheDocument();
    });

    it('filters commands based on input', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/cl' } });
      expect(screen.getByText('/clear')).toBeInTheDocument();
      expect(screen.queryByText('/help')).not.toBeInTheDocument();
    });

    it('calls onCommand when slash command is sent', () => {
      const onCommand = vi.fn();
      render(<MessageInput {...defaultProps} onCommand={onCommand} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/clear ' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onCommand).toHaveBeenCalledWith('/clear', '');
      expect(defaultProps.onSend).not.toHaveBeenCalled();
    });

    it('passes args to onCommand', () => {
      const onCommand = vi.fn();
      render(<MessageInput {...defaultProps} onCommand={onCommand} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/model zclaudia-1' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onCommand).toHaveBeenCalledWith('/model', 'zclaudia-1');
    });

    it('hides command suggestions when input has space', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/clear ' } });
      expect(screen.queryByText('Clear chat history')).not.toBeInTheDocument();
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

    it('shows no suggestions when commands prop is empty', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={[]} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      expect(screen.queryByText('/clear')).not.toBeInTheDocument();
    });

    it('navigates commands with arrow keys', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect((textarea as HTMLTextAreaElement).value).toContain('/help');
    });

    it('closes command suggestions on Escape', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      expect(screen.getByText('/clear')).toBeInTheDocument();
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(screen.queryByText('/clear')).not.toBeInTheDocument();
    });

    it('selects command on click', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      fireEvent.click(screen.getByText('/help'));
      expect((textarea as HTMLTextAreaElement).value).toContain('/help');
    });
  });

  // ── Auto-grow ──────────────────────────────────────────────────────────────

  describe('auto-grow', () => {
    it('grows the textarea height to fit content up to the cap', () => {
      render(<MessageInput {...defaultProps} />);
      const textarea = screen.getByTestId('message-input') as HTMLTextAreaElement;
      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 80 });
      fireEvent.change(textarea, { target: { value: 'line1\nline2\nline3' } });
      expect(textarea.style.height).toBe('80px');
      expect(textarea.style.overflowY).toBe('hidden');
    });

    it('caps height and enables internal scroll past the max', () => {
      render(<MessageInput {...defaultProps} />);
      const textarea = screen.getByTestId('message-input') as HTMLTextAreaElement;
      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 9999 });
      fireEvent.change(textarea, { target: { value: 'many\nlines\nhere' } });
      expect(textarea.style.overflowY).toBe('auto');
      // capped at min(40% viewport, 320)
      expect(parseInt(textarea.style.maxHeight, 10)).toBeLessThanOrEqual(320);
      expect(textarea.style.height).toBe(textarea.style.maxHeight);
    });

    it('shrinks height back down as content is deleted', () => {
      render(<MessageInput {...defaultProps} />);
      const textarea = screen.getByTestId('message-input') as HTMLTextAreaElement;
      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 200 });
      fireEvent.change(textarea, { target: { value: 'a\nb\nc\nd\ne' } });
      expect(textarea.style.height).toBe('200px');
      Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 24 });
      fireEvent.change(textarea, { target: { value: 'a' } });
      expect(textarea.style.height).toBe('24px');
    });

    it('does not render an advanced-mode toggle', () => {
      render(<MessageInput {...defaultProps} />);
      expect(screen.queryByTestId('advanced-toggle')).toBeNull();
    });
  });

  // ── Attachments ───────────────────────────────────────────────────────────

  describe('attachments', () => {
    it('renders hidden file input', () => {
      const { container } = render(<MessageInput {...defaultProps} />);
      const fileInput = container.querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();
      expect(fileInput?.className).toContain('hidden');
    });

    it('send button is disabled when no text and no attachments', () => {
      render(<MessageInput {...defaultProps} />);
      expect(screen.getByTestId('send-button')).toBeDisabled();
    });

    it('shows attachment preview with initialAttachments', () => {
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
      const sendBtn = screen.getByTestId('send-button');
      expect(sendBtn).not.toBeDisabled();
      fireEvent.click(sendBtn);
      expect(onSend).toHaveBeenCalledWith('', initialAttachments);
    });

    it('persists attachment-only draft after debounce', () => {
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
    });
  });

  // ── IME composition ───────────────────────────────────────────────────────

  it('does not send during IME composition', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('uses Enter for newline on mobile and only sends via button', () => {
    mockIsMobile = true;
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'line 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTitle('Send message')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Send message'));
    expect(onSend).toHaveBeenCalledWith('line 1', undefined);
  });
});

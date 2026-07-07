import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileContentSearchInput } from '../FileContentSearchInput';

const mockContent = `import foo
foo bar baz
line with foo
line without`;

// Advance timers helper for the 120ms debounce.
function flushDebounce() {
  vi.advanceTimersByTime(150);
}

describe('FileContentSearchInput', () => {
  const defaultProps = {
    content: mockContent,
    query: '',
    caseSensitive: false,
    onQueryChange: vi.fn(),
    onToggleCaseSensitive: vi.fn(),
    onSelectMatch: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders input and shows match count after debounce', async () => {
    render(<FileContentSearchInput {...defaultProps} query="foo" />);
    flushDebounce();
    await waitFor(() => expect(screen.getByText('1/3')).toBeInTheDocument());
    expect(screen.getByLabelText('Find in file')).toHaveValue('foo');
  });

  it('calls onQueryChange after debounce when typing', async () => {
    render(<FileContentSearchInput {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('Find in file'), { target: { value: 'bar' } });
    expect(defaultProps.onQueryChange).not.toHaveBeenCalled();
    flushDebounce();
    await waitFor(() => expect(defaultProps.onQueryChange).toHaveBeenCalledWith('bar'));
  });

  it('navigates to next match on Enter', async () => {
    render(<FileContentSearchInput {...defaultProps} query="foo" />);
    flushDebounce();
    await waitFor(() => expect(screen.getByText('1/3')).toBeInTheDocument());

    const input = screen.getByLabelText('Find in file');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(defaultProps.onSelectMatch).toHaveBeenCalledWith({ line: 2, start: 0, end: 3 });
  });

  it('navigates to previous match on Shift+Enter', async () => {
    render(<FileContentSearchInput {...defaultProps} query="foo" />);
    flushDebounce();
    await waitFor(() => expect(screen.getByText('1/3')).toBeInTheDocument());

    const input = screen.getByLabelText('Find in file');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    // 3 matches for "foo": line 1 (7-10), line 2 (0-3), line 3 (10-13)
    expect(defaultProps.onSelectMatch).toHaveBeenCalledWith({ line: 3, start: 10, end: 13 });
  });

  it('cycles through matches with up/down buttons', async () => {
    render(<FileContentSearchInput {...defaultProps} query="foo" />);
    flushDebounce();
    await waitFor(() => expect(screen.getByText('1/3')).toBeInTheDocument());

    const nextBtn = screen.getByLabelText('Next match');
    const prevBtn = screen.getByLabelText('Previous match');

    fireEvent.click(nextBtn);
    expect(defaultProps.onSelectMatch).toHaveBeenCalledWith({ line: 2, start: 0, end: 3 });

    vi.clearAllMocks();
    fireEvent.click(nextBtn);
    expect(defaultProps.onSelectMatch).toHaveBeenCalledWith({ line: 3, start: 10, end: 13 });

    vi.clearAllMocks();
    fireEvent.click(prevBtn);
    expect(defaultProps.onSelectMatch).toHaveBeenCalledWith({ line: 2, start: 0, end: 3 });
  });

  it('calls onClose on Escape', () => {
    render(<FileContentSearchInput {...defaultProps} />);
    fireEvent.keyDown(screen.getByLabelText('Find in file'), { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('toggles case sensitivity', () => {
    render(<FileContentSearchInput {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Case insensitive'));
    expect(defaultProps.onToggleCaseSensitive).toHaveBeenCalled();
  });

  it('disables nav buttons when no matches', async () => {
    render(<FileContentSearchInput {...defaultProps} query="nomatch" />);
    flushDebounce();
    await waitFor(() => expect(screen.getByLabelText('Next match')).toBeDisabled());
    expect(screen.getByLabelText('Previous match')).toBeDisabled();
  });

  it('updates active index when query changes', async () => {
    const { rerender } = render(<FileContentSearchInput {...defaultProps} query="foo" />);
    flushDebounce();
    await waitFor(() => expect(screen.getByText('1/3')).toBeInTheDocument());

    rerender(<FileContentSearchInput {...defaultProps} query="bar" />);
    flushDebounce();
    await waitFor(() => expect(screen.getByText('1/1')).toBeInTheDocument());
  });
});

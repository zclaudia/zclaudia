import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallCard } from '../tool-call/ToolCallCard';
import type { ToolCallView } from '@zclaudia/agent-transcript-kit';

// Purity contract: unlike ToolCallItem.test.tsx, this file mocks NO stores and
// NO contexts. The card must render from props alone — that is what makes it
// extractable into the shared transcript component layer. Only heavy
// renderers are stubbed for speed.
vi.mock('../../../components/renderers/CodeViewer', () => ({
  CodeViewer: () => <div data-testid="code-viewer" />,
}));
vi.mock('../../../components/renderers/DiffViewer', () => ({
  DiffViewer: () => <div data-testid="diff-viewer" />,
  UnifiedDiffViewer: () => <div data-testid="unified-diff-viewer" />,
}));

function createToolCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    id: 'tool-1',
    name: 'Bash',
    input: { command: 'npm test' },
    status: 'running',
    ...overrides,
  };
}

describe('ToolCallCard (pure)', () => {
  it('renders name and summary without any store or context providers', () => {
    render(<ToolCallCard toolCall={createToolCall()} />);
    expect(screen.getByTestId('tool-name')).toHaveTextContent('Bash');
    expect(screen.getByText('npm test')).toBeInTheDocument();
  });

  it('offers "Send to background" only when the host provides the capability', () => {
    const { rerender } = render(<ToolCallCard toolCall={createToolCall()} />);
    expect(screen.queryByText('Send to background')).not.toBeInTheDocument();

    const onSendToBackground = vi.fn();
    rerender(<ToolCallCard toolCall={createToolCall()} onSendToBackground={onSendToBackground} />);
    const button = screen.getByText('Send to background');
    fireEvent.click(button);
    expect(onSendToBackground).toHaveBeenCalledTimes(1);
    // Second click is swallowed while the request is pending.
    fireEvent.click(screen.getByText('Moving to background…'));
    expect(onSendToBackground).toHaveBeenCalledTimes(1);
  });

  it('shows the terminal paste button only when runInTerminal is provided', () => {
    const runInTerminal = vi.fn();
    render(<ToolCallCard toolCall={createToolCall()} runInTerminal={runInTerminal} />);
    // Expand the card to reveal the Bash command block.
    fireEvent.click(screen.getByTestId('tool-name'));
    fireEvent.click(screen.getByTitle('Paste to terminal'));
    expect(runInTerminal).toHaveBeenCalledWith('npm test');
  });

  it('hides the terminal paste button without the capability', () => {
    render(<ToolCallCard toolCall={createToolCall()} />);
    fireEvent.click(screen.getByTestId('tool-name'));
    expect(screen.queryByTitle('Paste to terminal')).not.toBeInTheDocument();
  });
});

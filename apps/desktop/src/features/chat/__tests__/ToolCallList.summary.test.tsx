import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToolCallList } from '../tool-call/ToolCallList';
import { formatToolInput } from '../tool-call/toolFormatters';
import type { ToolCallState } from '../../../stores/runStore';

vi.mock('../tool-call/toolFormatters', () => ({
  formatToolInput: vi.fn((_name, input) => input.file_path),
}));
vi.mock('../ToolCallItem', () => ({
  ToolCallItem: ({ toolCall }: { toolCall: ToolCallState }) => (
    <div data-testid="tool-detail">{toolCall.id}</div>
  ),
}));

const tools = Array.from(
  { length: 1000 },
  (_, index): ToolCallState => ({
    id: `tool-${index}`,
    toolName: 'Read',
    toolInput: { file_path: `/file-${index}.ts` },
    status: 'completed',
    result: '',
    isError: false,
  })
);

describe('bounded tool summary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders and formats only the latest five badges, retaining full counts and expansion', () => {
    const { container } = render(<ToolCallList toolCalls={tools} defaultCollapsed />);
    expect(screen.getByText('1000 tool calls')).toBeInTheDocument();
    expect(screen.getByText('+995 earlier')).toBeInTheDocument();
    expect(container.querySelectorAll('[title]')).toHaveLength(5);
    expect(formatToolInput).toHaveBeenCalledTimes(5);
    expect(screen.queryByText('file-0.ts')).not.toBeInTheDocument();
    expect(screen.getByText('file-999.ts')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Click to expand'));
    expect(screen.getAllByTestId('tool-detail')).toHaveLength(5);
    fireEvent.click(screen.getByText('Show 995 earlier tool calls'));
    expect(screen.getAllByTestId('tool-detail')).toHaveLength(1000);
  });

  it('bounds the older-tools summary during streaming too', () => {
    const { container } = render(<ToolCallList toolCalls={tools} isStreaming />);
    expect(container.querySelectorAll('[title]')).toHaveLength(5);
    expect(screen.getByText('+994 earlier')).toBeInTheDocument();
    expect(screen.getAllByTestId('tool-detail')).toHaveLength(1);
    expect(screen.getByTestId('tool-detail')).toHaveTextContent('tool-999');
  });
});

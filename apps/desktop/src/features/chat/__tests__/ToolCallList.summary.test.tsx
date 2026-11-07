import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToolCallList, fitSummaryChipCount } from '../tool-call/ToolCallList';
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
    // jsdom has no layout, so the count cap is the fallback for the one-line fit.
    expect(container.querySelectorAll('[data-summary-chip]')).toHaveLength(5);
    expect(formatToolInput).toHaveBeenCalledTimes(5);
    expect(screen.queryByText('file-0.ts')).not.toBeInTheDocument();
    expect(screen.getByText('file-999.ts')).toBeInTheDocument();
    expect(screen.getByTitle('995 earlier tool calls hidden')).toHaveTextContent('…');

    fireEvent.click(screen.getByText('Click to expand'));
    expect(screen.getAllByTestId('tool-detail')).toHaveLength(5);
    fireEvent.click(screen.getByText('Show 995 earlier tool calls'));
    expect(screen.getAllByTestId('tool-detail')).toHaveLength(1000);
  });

  it('bounds the older-tools summary during streaming too', () => {
    const { container } = render(<ToolCallList toolCalls={tools} isStreaming />);
    expect(container.querySelectorAll('[data-summary-chip]')).toHaveLength(5);
    expect(screen.getByTitle('994 earlier tool calls hidden')).toHaveTextContent('…');
    expect(screen.getAllByTestId('tool-detail')).toHaveLength(1);
    expect(screen.getByTestId('tool-detail')).toHaveTextContent('tool-999');
  });
});

describe('fitSummaryChipCount', () => {
  it('keeps only chips that fit alongside the ellipsis', () => {
    // 60 + 6 + 60 stays; adding a third chip and the ellipsis (6 + 14) would overflow.
    expect(fitSummaryChipCount([60, 60, 60], 14, 210, 10)).toBe(2);
    expect(fitSummaryChipCount([60, 60, 60], 14, 300, 10)).toBe(3);
  });

  it('does not reserve an ellipsis when every chip is shown', () => {
    expect(fitSummaryChipCount([60, 60, 60], 14, 192, 3)).toBe(3);
  });

  it('returns zero when not even the first chip fits', () => {
    expect(fitSummaryChipCount([200], 14, 100, 4)).toBe(0);
  });
});

describe('one-line summary row', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps whole chips that fit and ellipsizes the rest, dropping older chips', () => {
    const rect = (width: number) => ({ width, height: 20 }) as unknown as DOMRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      if (this.getAttribute('data-testid') === 'tool-summary-row') return rect(200);
      if (this.hasAttribute('data-summary-chip')) return rect(60);
      if (this.getAttribute('data-testid') === 'tool-summary-more') return rect(14);
      return rect(0);
    });

    const { container } = render(<ToolCallList toolCalls={tools} defaultCollapsed />);

    // 200px fits two 60px chips (with gaps) plus the ellipsis; older chips are dropped.
    expect(container.querySelectorAll('[data-summary-chip]')).toHaveLength(2);
    expect(screen.getByText('file-999.ts')).toBeInTheDocument();
    expect(screen.getByText('file-998.ts')).toBeInTheDocument();
    expect(screen.queryByText('file-997.ts')).not.toBeInTheDocument();
    expect(screen.getByTitle('998 earlier tool calls hidden')).toBeInTheDocument();
  });
});

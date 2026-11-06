import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock } from '@zclaudia/shared/core/message';
import type { ToolCallState } from '../../../stores/runStore';
import { SegmentedContent } from './SegmentedContent';

const { renderTools } = vi.hoisted(() => ({ renderTools: vi.fn() }));

vi.mock('../tool-call/ToolCallList', () => ({
  ToolCallList: (props: { toolCalls: ToolCallState[] }) => {
    renderTools(props);
    return <div>{props.toolCalls.map(tool => tool.id).join(',')}</div>;
  },
}));

vi.mock('./AssistantContent', () => ({
  AssistantContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('@zclaudia/agent-transcript-kit/react', () => ({
  ThinkingBlock: ({ content }: { content: string }) => <div>{content}</div>,
}));

const tool = (id: string): ToolCallState => ({
  id,
  toolName: 'Read',
  toolInput: {},
  status: 'completed',
  result: 'ok',
});

describe('SegmentedContent tool group rendering', () => {
  beforeEach(() => renderTools.mockClear());

  it('keeps completed tool group arrays and renders stable while the final text streams', () => {
    const toolCalls = [tool('a'), tool('b')];
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolUseId: 'a' },
      { type: 'text', content: 'Intermediate' },
      { type: 'tool_use', toolUseId: 'b' },
      { type: 'text', content: 'Answer' },
    ];
    const { rerender } = render(
      <SegmentedContent contentBlocks={blocks} toolCalls={toolCalls} isStreaming />
    );
    expect(renderTools).toHaveBeenCalledTimes(2);
    const firstGroupCalls = renderTools.mock.calls[0][0].toolCalls;
    const secondGroupCalls = renderTools.mock.calls[1][0].toolCalls;

    rerender(
      <SegmentedContent
        contentBlocks={[...blocks.slice(0, -1), { type: 'text', content: 'Answer!' }]}
        toolCalls={toolCalls}
        isStreaming
      />
    );
    expect(screen.getByText('Answer!')).toBeInTheDocument();
    expect(renderTools).toHaveBeenCalledTimes(2);
    expect(renderTools.mock.calls[0][0].toolCalls).toBe(firstGroupCalls);
    expect(renderTools.mock.calls[1][0].toolCalls).toBe(secondGroupCalls);
  });

  it('rerenders only the group whose tool object changed', () => {
    const toolCalls = [tool('a'), { ...tool('b'), status: 'running' as const }];
    const blocks: ContentBlock[] = [
      { type: 'tool_use', toolUseId: 'a' },
      { type: 'text', content: 'Intermediate' },
      { type: 'tool_use', toolUseId: 'b' },
    ];
    const { rerender } = render(
      <SegmentedContent contentBlocks={blocks} toolCalls={toolCalls} isStreaming />
    );
    const completed = { ...toolCalls[1], status: 'completed' as const, result: 'new result' };
    rerender(
      <SegmentedContent contentBlocks={blocks} toolCalls={[toolCalls[0], completed]} isStreaming />
    );

    expect(renderTools).toHaveBeenCalledTimes(3);
    expect(renderTools.mock.calls[2][0].toolCalls).toEqual([completed]);
    expect(renderTools.mock.calls[2][0].toolCalls[0]).toBe(completed);
    expect(renderTools.mock.calls[2][0].isStreaming).toBe(true);
  });

  it('updates trailing group flags when text arrives or streaming ends', () => {
    const toolCalls = [tool('a')];
    const blocks: ContentBlock[] = [{ type: 'tool_use', toolUseId: 'a' }];
    const { rerender } = render(
      <SegmentedContent contentBlocks={blocks} toolCalls={toolCalls} isStreaming />
    );
    expect(renderTools.mock.calls[0][0]).toMatchObject({
      defaultCollapsed: false,
      isStreaming: true,
    });

    rerender(<SegmentedContent contentBlocks={blocks} toolCalls={toolCalls} isStreaming={false} />);
    expect(renderTools).toHaveBeenCalledTimes(2);
    expect(renderTools.mock.calls[1][0]).toMatchObject({
      defaultCollapsed: true,
      isStreaming: false,
    });

    rerender(<SegmentedContent contentBlocks={blocks} toolCalls={toolCalls} isStreaming />);
    rerender(
      <SegmentedContent
        contentBlocks={[...blocks, { type: 'text', content: 'Answer' }]}
        toolCalls={toolCalls}
        isStreaming
      />
    );
    expect(renderTools).toHaveBeenCalledTimes(4);
    expect(renderTools.mock.calls[3][0]).toMatchObject({
      defaultCollapsed: true,
      isStreaming: false,
    });
  });
});

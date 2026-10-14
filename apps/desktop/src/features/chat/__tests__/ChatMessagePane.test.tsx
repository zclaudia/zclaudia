import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { ChatMessagePane } from '../ChatMessagePane';
import type { ToolCallState } from '../../../stores/runStore';

const mockInteractionsState = {
  interactions: {} as Record<string, any>,
  owners: {} as Record<string, { serverId: string; runId?: string }>,
};

vi.mock('../../../stores/interactionStore', () => ({
  useInteractionStore: Object.assign((selector: any) => selector(mockInteractionsState), {
    getState: () => mockInteractionsState,
  }),
}));

vi.mock('../MessageList', () => ({
  MessageList: ({ streamingToolCalls }: { streamingToolCalls?: ToolCallState[] }) => (
    <div data-testid="message-list">
      {streamingToolCalls?.map(toolCall => (
        <div key={toolCall.id} data-testid="inline-tool-call">
          {toolCall.id}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../InteractionItem', () => ({
  InteractionItem: ({ interaction }: { interaction: any }) => (
    <div data-testid="global-interaction">{interaction.interactionId}</div>
  ),
}));

vi.mock('../LoadingIndicator', () => ({
  LoadingIndicator: () => <div data-testid="loading-indicator" />,
}));

vi.mock('../InlinePermissionRequest', () => ({
  InlinePermissionRequest: () => <div data-testid="permission-request" />,
}));

function makeAskUserQuestionToolCall(id: string): ToolCallState {
  return {
    id,
    toolName: 'AskUserQuestion',
    toolInput: {
      questions: [{ header: 'Scope', question: 'Proceed?', options: [] }],
    },
    status: 'running',
    isError: false,
  };
}

function makeCreatePlanToolCall(id: string): ToolCallState {
  return {
    id,
    toolName: 'createPlan',
    toolInput: { plan: '# Cursor plan' },
    status: 'completed',
    isError: false,
    semantic: 'plan_proposal',
  };
}

function makeRequestApprovalToolCall(id: string): ToolCallState {
  return {
    id,
    toolName: 'mcp:claudia-plugins:request_approval',
    toolInput: { title: 'Approve action', message: 'Review this action' },
    status: 'running',
    isError: false,
  };
}

function renderPane(overrides: Partial<Parameters<typeof ChatMessagePane>[0]> = {}) {
  return render(
    <ChatMessagePane
      sessionId="s1"
      messagesEndRef={createRef<HTMLDivElement>()}
      messagesContainerRef={createRef<HTMLDivElement>()}
      initialLoadDone
      showScrollToBottom={false}
      scrollMetrics={{ scrollTop: 0, viewportHeight: 800 }}
      highlightedMessageId={null}
      loadError={null}
      sessionPagination={undefined}
      scrollToBottom={vi.fn()}
      jumpToBottomInstant={vi.fn()}
      loadMoreMessages={vi.fn()}
      handleScroll={vi.fn()}
      handleMessageWheel={vi.fn()}
      retryLoad={vi.fn()}
      sessionMessages={[]}
      lastSessionMessage={null}
      lastStreamingBlock={null}
      streamingContentSignature=""
      useStreamingSegmented
      sessionContentBlocks={[]}
      sessionToolCallHistory={[]}
      sessionToolCalls={[]}
      sessionHealth={null}
      isLoading={false}
      resendTargetMessageId={undefined}
      resendDisabled={false}
      onResendTarget={vi.fn()}
      onCancelRun={vi.fn()}
      permissionRequests={[]}
      onPermissionDecision={vi.fn()}
      {...overrides}
    />
  );
}

function defineScrollableMetrics(
  element: HTMLElement,
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }
) {
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    writable: true,
    value: metrics.scrollTop,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight,
  });
}

describe('ChatMessagePane', () => {
  beforeEach(() => {
    mockInteractionsState.interactions = {};
    mockInteractionsState.owners = {};
  });

  it('does not render a provider prompt globally when an AskUserQuestion tool call already owns it', () => {
    mockInteractionsState.interactions['ask-1'] = {
      type: 'interaction_prompt',
      interactionId: 'ask-1',
      sessionId: 's1',
      source: 'provider_native',
      createdAt: 1,
      title: 'Question',
      fields: [{ id: 'question_0', label: 'Proceed?', type: 'select', options: [] }],
      responseMode: 'prompt_answer',
      variant: 'question',
    };

    renderPane({
      sessionToolCallHistory: [makeAskUserQuestionToolCall('ask-1')],
    });

    expect(screen.getByTestId('inline-tool-call')).toHaveTextContent('ask-1');
    expect(screen.queryByTestId('global-interaction')).not.toBeInTheDocument();
  });

  it('keeps the global provider prompt as a fallback when no AskUserQuestion tool call owns it', () => {
    mockInteractionsState.interactions['ask-1'] = {
      type: 'interaction_prompt',
      interactionId: 'ask-1',
      sessionId: 's1',
      source: 'provider_native',
      createdAt: 1,
      title: 'Question',
      fields: [{ id: 'question_0', label: 'Proceed?', type: 'select', options: [] }],
      responseMode: 'prompt_answer',
      variant: 'question',
    };

    renderPane();

    expect(screen.getByTestId('global-interaction')).toHaveTextContent('ask-1');
  });

  it('renders an orphan plan review so pending sessions have visible action buttons', () => {
    mockInteractionsState.interactions['plan-1'] = {
      type: 'interaction_plan_review',
      interactionId: 'plan-1',
      sessionId: 's1',
      source: 'client_synth',
      createdAt: 1,
      plan: 'Review Cursor plan',
    };

    renderPane();

    expect(screen.getByTestId('global-interaction')).toHaveTextContent('plan-1');
  });

  it('does not render a plan review globally when a tool call owns it', () => {
    mockInteractionsState.interactions['plan-1'] = {
      type: 'interaction_plan_review',
      interactionId: 'plan-1',
      sessionId: 's1',
      source: 'client_synth',
      createdAt: 1,
      plan: 'Review Cursor plan',
    };

    renderPane({
      sessionToolCallHistory: [makeCreatePlanToolCall('plan-1')],
    });

    expect(screen.queryByTestId('global-interaction')).not.toBeInTheDocument();
  });

  it('renders a live approval globally when its interaction ID differs from the tool-call ID', () => {
    mockInteractionsState.interactions['approval-id'] = {
      type: 'interaction_approval',
      interactionId: 'approval-id',
      sessionId: 's1',
      source: 'tool_call',
      createdAt: 1,
      title: 'Approve action',
      message: 'Review this action',
    };

    renderPane({ sessionToolCallHistory: [makeRequestApprovalToolCall('tool-call-id')] });

    expect(screen.getByTestId('inline-tool-call')).toHaveTextContent('tool-call-id');
    expect(screen.getByTestId('global-interaction')).toHaveTextContent('approval-id');
  });

  it('does not duplicate an approval once the owning tool result is available', () => {
    mockInteractionsState.interactions['approval-id'] = {
      type: 'interaction_approval',
      interactionId: 'approval-id',
      sessionId: 's1',
      source: 'tool_call',
      createdAt: 1,
      title: 'Approve action',
      message: 'Review this action',
    };

    renderPane({
      sessionToolCallHistory: [
        {
          ...makeRequestApprovalToolCall('tool-call-id'),
          result: JSON.stringify({ interactionId: 'approval-id' }),
        },
      ],
    });

    expect(screen.queryByTestId('global-interaction')).not.toBeInTheDocument();
  });

  it('does not show an approval owned by another backend with the same session ID', () => {
    mockInteractionsState.interactions['approval-a'] = {
      type: 'interaction_approval',
      interactionId: 'approval-a',
      sessionId: 's1',
      source: 'tool_call',
      createdAt: 1,
      title: 'Approve A',
      message: 'Backend A action',
    };
    mockInteractionsState.interactions['approval-b'] = {
      type: 'interaction_approval',
      interactionId: 'approval-b',
      sessionId: 's1',
      source: 'tool_call',
      createdAt: 2,
      title: 'Approve B',
      message: 'Backend B action',
    };
    mockInteractionsState.owners = {
      'approval-a': { serverId: 'backend-a', runId: 'run-a' },
      'approval-b': { serverId: 'backend-b', runId: 'run-b' },
    };

    renderPane({ interactionServerId: 'backend-a' });

    expect(screen.getByTestId('global-interaction')).toHaveTextContent('approval-a');
    expect(screen.queryByText('approval-b')).not.toBeInTheDocument();
  });

  it('does not auto-scroll on initial mount for a static loaded session', () => {
    const scrollToBottom = vi.fn();

    renderPane({
      scrollToBottom,
      sessionMessages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: 'hello',
          createdAt: 1,
          updatedAt: 1,
        },
      ] as any,
      lastSessionMessage: {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: 'hello',
        createdAt: 1,
        updatedAt: 1,
      } as any,
    });

    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it('stops auto-scrolling to bottom after the user scrolls upward', () => {
    const scrollToBottom = vi.fn();
    const { container, rerender } = renderPane({
      scrollToBottom,
      sessionMessages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: 'hello',
          createdAt: 1,
          updatedAt: 1,
        },
      ] as any,
    });

    // The scroll container is the inner overflow-y-auto div (wrapped by a relative
    // parent that hosts the fade mask + lifted scroll-to-bottom button).
    const scrollContainer = container.querySelector('.overflow-y-auto') as HTMLElement;
    defineScrollableMetrics(scrollContainer, {
      scrollTop: 500,
      scrollHeight: 1000,
      clientHeight: 500,
    });
    fireEvent.scroll(scrollContainer);

    scrollToBottom.mockClear();

    defineScrollableMetrics(scrollContainer, {
      scrollTop: 440,
      scrollHeight: 1000,
      clientHeight: 500,
    });
    fireEvent.scroll(scrollContainer);

    rerender(
      <ChatMessagePane
        sessionId="s1"
        messagesEndRef={createRef<HTMLDivElement>()}
        messagesContainerRef={{ current: scrollContainer }}
        initialLoadDone
        showScrollToBottom={false}
        scrollMetrics={{ scrollTop: 440, viewportHeight: 500 }}
        highlightedMessageId={null}
        loadError={null}
        sessionPagination={undefined}
        scrollToBottom={scrollToBottom}
        jumpToBottomInstant={vi.fn()}
        loadMoreMessages={vi.fn()}
        handleScroll={vi.fn()}
        handleMessageWheel={vi.fn()}
        retryLoad={vi.fn()}
        sessionMessages={
          [
            {
              id: 'm1',
              sessionId: 's1',
              role: 'assistant',
              content: 'hello',
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'm2',
              sessionId: 's1',
              role: 'assistant',
              content: 'world',
              createdAt: 2,
              updatedAt: 2,
            },
          ] as any
        }
        lastSessionMessage={null}
        lastStreamingBlock={null}
        streamingContentSignature=""
        useStreamingSegmented
        sessionContentBlocks={[]}
        sessionToolCallHistory={[]}
        sessionToolCalls={[]}
        sessionHealth={null}
        isLoading={false}
        resendTargetMessageId={undefined}
        resendDisabled={false}
        onResendTarget={vi.fn()}
        onCancelRun={vi.fn()}
        permissionRequests={[]}
        onPermissionDecision={vi.fn()}
      />
    );

    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it('fades only the message edges that have off-screen content', () => {
    const { container } = renderPane({
      sessionMessages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: 'hello',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'm2',
          sessionId: 's1',
          role: 'assistant',
          content: 'world',
          createdAt: 2,
          updatedAt: 2,
        },
      ] as any,
    });
    const scrollContainer = container.querySelector('.overflow-y-auto') as HTMLElement;
    // The mask uses a calc() gradient jsdom can't parse into computed style, so the
    // component mirrors which edges are faded onto data-edge-fade for assertions.
    const fade = () => scrollContainer.getAttribute('data-edge-fade');

    // Scrolled to the middle: content above and below → both edges fade.
    defineScrollableMetrics(scrollContainer, {
      scrollTop: 300,
      scrollHeight: 1000,
      clientHeight: 500,
    });
    fireEvent.scroll(scrollContainer);
    expect(fade()).toBe('both');

    // Scrolled to the very top: nothing above → top edge stays crisp, bottom fades.
    defineScrollableMetrics(scrollContainer, {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500,
    });
    fireEvent.scroll(scrollContainer);
    expect(fade()).toBe('bottom');

    // Scrolled to the very bottom: nothing below → newest message stays crisp.
    defineScrollableMetrics(scrollContainer, {
      scrollTop: 500,
      scrollHeight: 1000,
      clientHeight: 500,
    });
    fireEvent.scroll(scrollContainer);
    expect(fade()).toBe('top');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useRunStore } from '../runStore';
import { useChatMessageStore } from '../chatMessageStore';
import { useSessionConfigStore } from '../sessionConfigStore';
import type { MessageWithToolCalls } from '../chatMessageStore';

const reset = () => {
  useRunStore.setState({
    activeRuns: {},
    assistantMessageIds: {},
    backgroundRunIds: new Set(),
    runHealth: {},
    runRetryStatus: {},
    activeToolCalls: {},
    toolCallsHistory: {},
    runContentBlocks: {},
  });
  useChatMessageStore.setState({ messages: {}, pagination: {} });
  useSessionConfigStore.setState({
    systemInfoBySession: {},
    modeBySession: {},
    runtimeModes: {},
    sessionUsage: {},
    compactionNotice: {},
  });
};

describe('runStore', () => {
  beforeEach(reset);

  it('startRun registers run + initializes per-run buckets', () => {
    useRunStore.getState().startRun('r1', 's1', false, 'm1');
    expect(useRunStore.getState().activeRuns.r1).toBe('s1');
    expect(useRunStore.getState().getSessionRunId('s1')).toBe('r1');
    expect(useRunStore.getState().activeToolCalls.r1).toEqual({});
    expect(useRunStore.getState().assistantMessageIds.r1).toBe('m1');
  });

  it('isSessionLoading ignores background runs', () => {
    useRunStore.getState().startRun('r1', 's1', true);
    expect(useRunStore.getState().isSessionLoading('s1')).toBe(false);
    useRunStore.getState().startRun('r2', 's1');
    expect(useRunStore.getState().isSessionLoading('s1')).toBe(true);
  });

  it('addToolCall then updateToolCallResult flips status and is idempotent', () => {
    useRunStore.getState().startRun('r1', 's1');
    useRunStore.getState().addToolCall('r1', 't1', 'Read', { path: 'x' });
    useRunStore.getState().updateToolCallResult('r1', 't1', 'ok');
    expect(useRunStore.getState().activeToolCalls.r1.t1.status).toBe('completed');
    useRunStore.getState().updateToolCallResult('r1', 't1', 'IGNORED', true);
    expect(useRunStore.getState().activeToolCalls.r1.t1.result).toBe('ok');
  });

  it('appendTextBlock coalesces consecutive text blocks', () => {
    useRunStore.getState().startRun('r1', 's1');
    useRunStore.getState().appendTextBlock('r1', 'a');
    useRunStore.getState().appendTextBlock('r1', 'b');
    const blocks = useRunStore.getState().runContentBlocks.r1;
    expect(blocks).toEqual([{ type: 'text', content: 'ab' }]);
  });

  it('endRun clears run buckets AND the session runtime mode (cross-store)', () => {
    useRunStore.getState().startRun('r1', 's1');
    useSessionConfigStore.getState().setRuntimeMode('s1', 'plan');
    useRunStore.getState().endRun('r1');
    expect(useRunStore.getState().activeRuns.r1).toBeUndefined();
    expect(useSessionConfigStore.getState().getRuntimeMode('s1')).toBe('');
  });

  it('finalizeRunToMessage writes run tool calls onto the last assistant message (cross-store)', () => {
    const am: MessageWithToolCalls = {
      id: 'm1',
      role: 'assistant',
      content: '',
      createdAt: 1,
    } as MessageWithToolCalls;
    useChatMessageStore.getState().setMessages('s1', [am]);
    useRunStore.getState().startRun('r1', 's1');
    useRunStore.getState().addToolCall('r1', 't1', 'Read', { path: 'x' });
    useRunStore.getState().addToolUseBlock('r1', 't1');
    useRunStore.getState().finalizeRunToMessage('r1');
    const finalized = useChatMessageStore.getState().messages.s1[0];
    expect(finalized.toolCalls).toHaveLength(1);
    expect(finalized.contentBlocks).toHaveLength(1);
  });

  it('finalizeRunToMessage prefers server-authoritative final content over local accumulation', () => {
    // Locally accumulated deltas can be missing a lost tail; the terminal
    // event's content/contentBlocks are authoritative when provided.
    const am: MessageWithToolCalls = {
      id: 'm1',
      role: 'assistant',
      content: 'partial tex',
      createdAt: 1,
    } as MessageWithToolCalls;
    useChatMessageStore.getState().setMessages('s1', [am]);
    useRunStore.getState().startRun('r1', 's1');
    useRunStore.getState().addToolUseBlock('r1', 't1');
    useRunStore.getState().appendTextBlock('r1', 'partial tex');
    useRunStore.getState().finalizeRunToMessage('r1', {
      content: 'partial text plus lost tail',
      contentBlocks: [
        { type: 'tool_use', toolUseId: 't1' },
        { type: 'text', content: 'partial text plus lost tail' },
      ],
    });
    const finalized = useChatMessageStore.getState().messages.s1[0];
    expect(finalized.content).toBe('partial text plus lost tail');
    expect(finalized.contentBlocks).toEqual([
      { type: 'tool_use', toolUseId: 't1' },
      { type: 'text', content: 'partial text plus lost tail' },
    ]);
  });

  it('finalizeRunToMessage applies authoritative content via sessionId fallback when run tracking is gone', () => {
    // A stale heartbeat can endRun() the client-side tracking just before
    // run_completed arrives; the terminal event still carries sessionId, so
    // the authoritative content must land even without activeRuns.
    const am: MessageWithToolCalls = {
      id: 'm1',
      role: 'assistant',
      content: 'partial tex',
      createdAt: 1,
    } as MessageWithToolCalls;
    useChatMessageStore.getState().setMessages('s1', [am]);
    // No startRun: activeRuns has no entry for this run.
    useRunStore.getState().finalizeRunToMessage('r-gone', {
      sessionId: 's1',
      assistantMessageId: 'm1',
      content: 'full final text',
      contentBlocks: [{ type: 'text', content: 'full final text' }],
    });
    const finalized = useChatMessageStore.getState().messages.s1[0];
    expect(finalized.content).toBe('full final text');
    expect(finalized.contentBlocks).toEqual([{ type: 'text', content: 'full final text' }]);
  });

  it('finalizes the run-bound assistant row and never overwrites a newer assistant', () => {
    useChatMessageStore.getState().setMessages('s1', [
      { id: 'old-assistant', sessionId: 's1', role: 'assistant', content: 'partial', createdAt: 1 },
      { id: 'new-assistant', sessionId: 's1', role: 'assistant', content: 'new run', createdAt: 2 },
    ]);
    useRunStore.getState().startRun('old-run', 's1', false, 'old-assistant');

    useRunStore.getState().finalizeRunToMessage('old-run', {
      assistantMessageId: 'old-assistant',
      content: 'complete old run',
      messageVersion: 12,
    });

    const [oldMessage, newMessage] = useChatMessageStore.getState().messages.s1;
    expect(oldMessage.content).toBe('complete old run');
    expect(newMessage.content).toBe('new run');
    expect(useChatMessageStore.getState().pagination.s1.messageVersion).toBe(12);
  });

  it('ignores an identity-less late terminal event after run tracking was removed', () => {
    useChatMessageStore
      .getState()
      .setMessages('s1', [
        {
          id: 'new-assistant',
          sessionId: 's1',
          role: 'assistant',
          content: 'new run',
          createdAt: 2,
        },
      ]);

    useRunStore.getState().finalizeRunToMessage('old-run', {
      sessionId: 's1',
      content: 'late old result',
    });

    expect(useChatMessageStore.getState().messages.s1[0].content).toBe('new run');
  });
});

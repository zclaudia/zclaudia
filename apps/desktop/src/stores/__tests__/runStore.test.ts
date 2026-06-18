import { describe, it, expect, beforeEach } from 'vitest';
import { useRunStore } from '../runStore';
import { useChatMessageStore } from '../chatMessageStore';
import { useSessionConfigStore } from '../sessionConfigStore';
import type { MessageWithToolCalls } from '../chatMessageStore';

const reset = () => {
  useRunStore.setState({
    activeRuns: {}, backgroundRunIds: new Set(), runHealth: {}, runRetryStatus: {},
    activeToolCalls: {}, toolCallsHistory: {}, runContentBlocks: {},
  });
  useChatMessageStore.setState({ messages: {}, pagination: {} });
  useSessionConfigStore.setState({ systemInfoBySession: {}, modeBySession: {}, runtimeModes: {}, sessionUsage: {}, compactionNotice: {} });
};

describe('runStore', () => {
  beforeEach(reset);

  it('startRun registers run + initializes per-run buckets', () => {
    useRunStore.getState().startRun('r1', 's1');
    expect(useRunStore.getState().activeRuns.r1).toBe('s1');
    expect(useRunStore.getState().getSessionRunId('s1')).toBe('r1');
    expect(useRunStore.getState().activeToolCalls.r1).toEqual({});
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
    const am: MessageWithToolCalls = { id: 'm1', role: 'assistant', content: '', createdAt: 1 } as MessageWithToolCalls;
    useChatMessageStore.getState().setMessages('s1', [am]);
    useRunStore.getState().startRun('r1', 's1');
    useRunStore.getState().addToolCall('r1', 't1', 'Read', { path: 'x' });
    useRunStore.getState().addToolUseBlock('r1', 't1');
    useRunStore.getState().finalizeRunToMessage('r1');
    const finalized = useChatMessageStore.getState().messages.s1[0];
    expect(finalized.toolCalls).toHaveLength(1);
    expect(finalized.contentBlocks).toHaveLength(1);
  });
});

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
    runTranscripts: {},
    runToolMeta: {},
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

  it('carries sub-agent lineage from addToolCall through the meta map into ToolCallState', () => {
    useRunStore.getState().startRun('r1', 's1');
    useRunStore.getState().addToolCall('r1', 'task-1', 'Task', { description: 'd' });
    useRunStore
      .getState()
      .addToolCall(
        'r1',
        'inner-1',
        'Read',
        { file_path: 'x' },
        undefined,
        undefined,
        undefined,
        'task-1'
      );
    const calls = useRunStore.getState().activeToolCalls.r1;
    expect(calls['inner-1'].parentToolUseId).toBe('task-1');
    expect(calls['task-1'].parentToolUseId).toBeUndefined();
    const history = useRunStore.getState().toolCallsHistory.r1;
    expect(history.find(tc => tc.id === 'inner-1')?.parentToolUseId).toBe('task-1');
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
    useChatMessageStore.getState().setMessages('s1', [
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

describe('runStore backgroundable tool affordance', () => {
  beforeEach(reset);

  it('projects backgroundable onto the tool call only when announced', () => {
    useRunStore.getState().startRun('r1', 's1');
    useRunStore
      .getState()
      .addToolCall('r1', 't1', 'Bash', { command: 'sleep 30' }, undefined, undefined, true);
    useRunStore.getState().addToolCall('r1', 't2', 'Bash', { command: 'ls' });
    const calls = useRunStore.getState().activeToolCalls.r1;
    expect(calls.t1.backgroundable).toBe(true);
    expect(calls.t2).not.toHaveProperty('backgroundable');
  });

  it('keeps backgroundable alongside an effect discovered at completion', () => {
    useRunStore.getState().startRun('r1', 's1');
    useRunStore
      .getState()
      .addToolCall('r1', 't1', 'Bash', { command: 'ls' }, undefined, undefined, true);
    const effect = { kind: 'shell' as const, command: 'ls' };
    useRunStore.getState().updateToolCallResult('r1', 't1', 'ok', false, effect);
    const call = useRunStore.getState().activeToolCalls.r1.t1;
    expect(call.effect).toEqual(effect);
    expect(call.backgroundable).toBe(true);
    expect(call.status).toBe('completed');
  });
});

describe('runStore projection sharing', () => {
  beforeEach(reset);

  it('preserves tool objects and both levels of tool containers across text deltas with 100 tools', () => {
    const store = useRunStore.getState();
    store.startRun('r1', 's1');
    store.appendTextBlock('r1', 'Before tools');
    for (let index = 0; index < 100; index++) {
      store.addToolCall('r1', `t${index}`, 'Read', { path: `file-${index}` });
      store.updateToolCallResult('r1', `t${index}`, 'ok');
    }
    store.appendTextBlock('r1', 'Answer');
    const before = useRunStore.getState();
    store.appendTextBlock('r1', '!');
    const after = useRunStore.getState();

    expect(after.activeToolCalls).toBe(before.activeToolCalls);
    expect(after.activeToolCalls.r1).toBe(before.activeToolCalls.r1);
    expect(after.toolCallsHistory).toBe(before.toolCallsHistory);
    expect(after.toolCallsHistory.r1).toBe(before.toolCallsHistory.r1);
    for (let index = 0; index < 100; index++) {
      expect(after.activeToolCalls.r1[`t${index}`]).toBe(before.activeToolCalls.r1[`t${index}`]);
    }
    expect(after.runContentBlocks.r1).not.toBe(before.runContentBlocks.r1);
    for (let index = 0; index < 101; index++) {
      expect(after.runContentBlocks.r1[index]).toBe(before.runContentBlocks.r1[index]);
    }
    expect(after.runContentBlocks.r1.at(-1)).toEqual({ type: 'text', content: 'Answer!' });
  });

  it('updates only the affected tool for activity and completion, retaining blocks and other runs', () => {
    const store = useRunStore.getState();
    store.startRun('r1', 's1');
    store.startRun('r2', 's2');
    store.addToolCall('r1', '10', 'Read', { path: 'a' });
    store.addToolCall('r1', '2', 'Read', { path: 'b' });
    store.addToolCall('r2', 'other', 'Read', { path: 'c' });
    const before = useRunStore.getState();
    store.updateToolCallActivity('r1', '2', 'Reading');
    const active = useRunStore.getState();
    expect(active.activeToolCalls.r1['10']).toBe(before.activeToolCalls.r1['10']);
    expect(active.activeToolCalls.r1['2']).not.toBe(before.activeToolCalls.r1['2']);
    expect(active.activeToolCalls.r1['2'].activity).toBe('Reading');
    expect(active.activeToolCalls.r2).toBe(before.activeToolCalls.r2);
    expect(active.toolCallsHistory.r2).toBe(before.toolCallsHistory.r2);
    expect(active.runContentBlocks).toBe(before.runContentBlocks);
    expect(active.toolCallsHistory.r1.map(tool => tool.id)).toEqual(['10', '2']);

    const effect = { kind: 'shell' as const, command: 'ls' };
    store.updateToolCallResult('r1', '2', 'done', false, effect);
    const completed = useRunStore.getState();
    expect(completed.activeToolCalls.r1['10']).toBe(active.activeToolCalls.r1['10']);
    expect(completed.activeToolCalls.r1['2']).not.toBe(active.activeToolCalls.r1['2']);
    expect(completed.activeToolCalls.r1['2']).toMatchObject({
      status: 'completed',
      result: 'done',
      activity: 'Reading',
      effect,
    });
    expect(completed.runContentBlocks).toBe(before.runContentBlocks);
  });

  it('retains projection references for duplicate starts and repeated activity', () => {
    const store = useRunStore.getState();
    store.startRun('r1', 's1');
    const input = { path: 'a' };
    store.addToolCall('r1', 't1', 'Read', input);
    const before = useRunStore.getState();
    store.addToolUseBlock('r1', 't1');
    store.addToolCall('r1', 't1', 'Read', input);
    const duplicate = useRunStore.getState();
    expect(duplicate.runTranscripts).toBe(before.runTranscripts);
    expect(duplicate.activeToolCalls).toBe(before.activeToolCalls);
    expect(duplicate.toolCallsHistory).toBe(before.toolCallsHistory);
    expect(duplicate.runContentBlocks).toBe(before.runContentBlocks);

    store.updateToolCallActivity('r1', 't1', 'Reading');
    const active = useRunStore.getState();
    store.updateToolCallActivity('r1', 't1', 'Reading');
    expect(useRunStore.getState().activeToolCalls).toBe(active.activeToolCalls);
    expect(useRunStore.getState().toolCallsHistory).toBe(active.toolCallsHistory);
  });

  it('projects late fields and host metadata even when tool_started otherwise no-ops', () => {
    const store = useRunStore.getState();
    useChatMessageStore
      .getState()
      .setMessages('s1', [
        { id: 'm1', sessionId: 's1', role: 'assistant', content: '', createdAt: 1 },
      ]);
    store.startRun('r1', 's1', false, 'm1');
    store.addToolUseBlock('r1', 'inner');
    store.addToolCall('r1', 'other', 'Read', {});
    const before = useRunStore.getState();
    const effect = { kind: 'shell' as const, command: 'ls' };
    store.addToolCall(
      'r1',
      'inner',
      'Bash',
      { command: 'ls' },
      'plan_exit',
      effect,
      true,
      'parent'
    );
    const filled = useRunStore.getState();
    expect(filled.activeToolCalls.r1.inner).toMatchObject({
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      effect,
      backgroundable: true,
      parentToolUseId: 'parent',
      semantic: 'plan_exit',
    });
    expect(filled.activeToolCalls.r1.other).toBe(before.activeToolCalls.r1.other);
    expect(filled.runContentBlocks).toBe(before.runContentBlocks);
    const newEffect = { kind: 'shell' as const, command: 'pwd' };
    store.addToolCall('r1', 'inner', 'Bash', undefined, undefined, newEffect);
    const updated = useRunStore.getState();
    expect(updated.runTranscripts).toBe(filled.runTranscripts);
    expect(updated.runTranscripts.r1).toBe(filled.runTranscripts.r1);
    expect(updated.activeToolCalls.r1.inner).toMatchObject({
      effect: newEffect,
      backgroundable: true,
      parentToolUseId: 'parent',
    });
    expect(updated.activeToolCalls.r1.other).toBe(filled.activeToolCalls.r1.other);
    store.addToolCall('r1', 'inner', 'Bash', undefined, undefined, newEffect);
    expect(useRunStore.getState().activeToolCalls).toBe(updated.activeToolCalls);
    expect(useRunStore.getState().toolCallsHistory).toBe(updated.toolCallsHistory);

    store.updateToolCallResult('r1', 'inner', 'failed', true);
    store.finalizeRunToMessage('r1');
    const finalized = useChatMessageStore.getState().messages.s1[0];
    expect(finalized.toolCalls?.map(tool => tool.id)).toEqual(['inner', 'other']);
    expect(finalized.toolCalls?.[0]).toMatchObject({
      status: 'error',
      result: 'failed',
      isError: true,
      semantic: 'plan_exit',
      effect: newEffect,
      backgroundable: true,
      parentToolUseId: 'parent',
    });
    expect(finalized.contentBlocks).toEqual([
      { type: 'tool_use', toolUseId: 'inner' },
      { type: 'tool_use', toolUseId: 'other' },
    ]);
  });
});

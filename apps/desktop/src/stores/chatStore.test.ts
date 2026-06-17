import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';
import { useChatMessageStore } from './chatMessageStore';
import type { Message } from '@zclaudia/shared';

describe('chatStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useChatStore.setState({
      activeRuns: {},
      activeToolCalls: {},
      toolCallsHistory: {},
    });
    useChatMessageStore.setState({
      messages: {},
      pagination: {},
    });
  });

  const createMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Test message',
    createdAt: Date.now(),
    ...overrides,
  });

  describe('run lifecycle', () => {
    it('startRun registers a run and initializes tool call state', () => {
      useChatStore.getState().startRun('run-1', 'session-1');

      expect(useChatStore.getState().activeRuns['run-1']).toBe('session-1');
      expect(useChatStore.getState().activeToolCalls['run-1']).toEqual({});
      expect(useChatStore.getState().toolCallsHistory['run-1']).toEqual([]);
    });

    it('endRun removes the run and its tool call state', () => {
      useChatStore.getState().startRun('run-1', 'session-1');
      useChatStore.getState().endRun('run-1');

      expect(useChatStore.getState().activeRuns['run-1']).toBeUndefined();
      expect(useChatStore.getState().activeToolCalls['run-1']).toBeUndefined();
      expect(useChatStore.getState().toolCallsHistory['run-1']).toBeUndefined();
    });

    it('isSessionLoading returns true when session has an active run', () => {
      useChatStore.getState().startRun('run-1', 'session-1');

      expect(useChatStore.getState().isSessionLoading('session-1')).toBe(true);
      expect(useChatStore.getState().isSessionLoading('session-2')).toBe(false);
    });

    it('isSessionLoading returns false after endRun', () => {
      useChatStore.getState().startRun('run-1', 'session-1');
      useChatStore.getState().endRun('run-1');

      expect(useChatStore.getState().isSessionLoading('session-1')).toBe(false);
    });

    it('getSessionRunId returns active runId for a session', () => {
      useChatStore.getState().startRun('run-1', 'session-1');

      expect(useChatStore.getState().getSessionRunId('session-1')).toBe('run-1');
      expect(useChatStore.getState().getSessionRunId('session-2')).toBeNull();
    });

    it('supports multiple concurrent runs', () => {
      useChatStore.getState().startRun('run-1', 'session-1');
      useChatStore.getState().startRun('run-2', 'session-2');

      expect(useChatStore.getState().isSessionLoading('session-1')).toBe(true);
      expect(useChatStore.getState().isSessionLoading('session-2')).toBe(true);
      expect(useChatStore.getState().getSessionRunId('session-1')).toBe('run-1');
      expect(useChatStore.getState().getSessionRunId('session-2')).toBe('run-2');

      // End one run, the other should still be active
      useChatStore.getState().endRun('run-1');
      expect(useChatStore.getState().isSessionLoading('session-1')).toBe(false);
      expect(useChatStore.getState().isSessionLoading('session-2')).toBe(true);
    });
  });

  describe('toolCalls', () => {
    const RUN_ID = 'run-1';

    beforeEach(() => {
      // Start a run so tool calls have a context
      useChatStore.getState().startRun(RUN_ID, 'session-1');
    });

    it('addToolCall creates a new running tool call', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', { file_path: '/foo.ts' });

      const tc = useChatStore.getState().activeToolCalls[RUN_ID]['tc-1'];
      expect(tc).toBeDefined();
      expect(tc.toolName).toBe('Read');
      expect(tc.status).toBe('running');
      expect(tc.toolInput).toEqual({ file_path: '/foo.ts' });
    });

    it('addToolCall appends to toolCallsHistory in order', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().addToolCall(RUN_ID, 'tc-2', 'Edit', {});

      const history = useChatStore.getState().toolCallsHistory[RUN_ID];
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('tc-1');
      expect(history[1].id).toBe('tc-2');
    });

    it('updateToolCallResult marks tool as completed', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-1', 'file content here');

      const tc = useChatStore.getState().activeToolCalls[RUN_ID]['tc-1'];
      expect(tc.status).toBe('completed');
      expect(tc.result).toBe('file content here');
      expect(tc.isError).toBeUndefined();
    });

    it('updateToolCallResult marks tool as error when isError is true', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Bash', {});
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-1', 'command failed', true);

      const tc = useChatStore.getState().activeToolCalls[RUN_ID]['tc-1'];
      expect(tc.status).toBe('error');
      expect(tc.isError).toBe(true);
    });

    it('updateToolCallResult also updates toolCallsHistory', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-1', 'done');

      const history = useChatStore.getState().toolCallsHistory[RUN_ID];
      expect(history[0].status).toBe('completed');
    });

    it('updateToolCallResult can backfill completed tool effects', () => {
      const effect = { kind: 'file_change' as const, files: [{ path: 'src/a.ts', changeKind: 'modify' as const, summary: '@@ diff' }] };
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Edit', {});
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-1', 'done', false, effect);

      const tc = useChatStore.getState().activeToolCalls[RUN_ID]['tc-1'];
      const history = useChatStore.getState().toolCallsHistory[RUN_ID];
      expect(tc.effect).toEqual(effect);
      expect(history[0].effect).toEqual(effect);
    });

    it('updateToolCallResult does nothing for unknown tool id', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-unknown', 'result');

      // Original tool call should be unchanged
      expect(useChatStore.getState().activeToolCalls[RUN_ID]['tc-1'].status).toBe('running');
    });

    it('endRun cleans up tool calls for that run', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().addToolCall(RUN_ID, 'tc-2', 'Edit', {});
      useChatStore.getState().endRun(RUN_ID);

      expect(useChatStore.getState().activeToolCalls[RUN_ID]).toBeUndefined();
      expect(useChatStore.getState().toolCallsHistory[RUN_ID]).toBeUndefined();
    });

    it('tool calls from different runs are isolated', () => {
      useChatStore.getState().startRun('run-2', 'session-2');
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().addToolCall('run-2', 'tc-2', 'Edit', {});

      expect(Object.keys(useChatStore.getState().activeToolCalls[RUN_ID])).toEqual(['tc-1']);
      expect(Object.keys(useChatStore.getState().activeToolCalls['run-2'])).toEqual(['tc-2']);

      // End one run, other's tool calls remain
      useChatStore.getState().endRun(RUN_ID);
      expect(useChatStore.getState().activeToolCalls[RUN_ID]).toBeUndefined();
      expect(useChatStore.getState().activeToolCalls['run-2']['tc-2']).toBeDefined();
    });

    it('getSessionToolCalls returns tool calls for the session active run', () => {
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', { file_path: '/a.ts' });
      useChatStore.getState().addToolCall(RUN_ID, 'tc-2', 'Edit', {});

      const toolCalls = useChatStore.getState().getSessionToolCalls('session-1');
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls.map(tc => tc.id).sort()).toEqual(['tc-1', 'tc-2']);
    });

    it('getSessionToolCalls returns empty for session without active run', () => {
      expect(useChatStore.getState().getSessionToolCalls('session-other')).toEqual([]);
    });

    it('finalizeRunToMessage attaches tool calls and content blocks to last assistant message', () => {
      // Set up an assistant message
      const message = createMessage({ id: 'msg-1', role: 'assistant', content: 'Response' });
      useChatMessageStore.getState().addMessage('session-1', message);

      // Add tool calls
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', { file_path: '/a.ts' });
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-1', 'contents');

      // Add content blocks
      useChatStore.getState().appendTextBlock(RUN_ID, 'some text');
      useChatStore.getState().addToolUseBlock(RUN_ID, 'tc-1');

      // Finalize (takes runId, looks up sessionId from activeRuns)
      useChatStore.getState().finalizeRunToMessage(RUN_ID);

      const messages = useChatMessageStore.getState().messages['session-1'];
      expect(messages[0].toolCalls).toHaveLength(1);
      expect(messages[0].toolCalls![0].toolName).toBe('Read');
      expect(messages[0].toolCalls![0].status).toBe('completed');
      expect(messages[0].contentBlocks).toHaveLength(2);
    });

    it('finalizeRunToMessage does nothing if last message is not assistant', () => {
      const message = createMessage({ id: 'msg-1', role: 'user', content: 'User msg' });
      useChatMessageStore.getState().addMessage('session-1', message);
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});

      useChatStore.getState().finalizeRunToMessage(RUN_ID);

      // Tool calls should remain
      expect(useChatStore.getState().toolCallsHistory[RUN_ID]).toHaveLength(1);
    });

    it('keeps appending and finalizing against the most recent assistant message even after system messages', () => {
      useChatMessageStore.getState().addMessage('session-1', createMessage({ id: 'assistant-1', role: 'assistant', content: 'Hello' }));
      useChatMessageStore.getState().addMessage('session-1', createMessage({ id: 'system-1', role: 'system', content: 'Task started' }));

      useChatMessageStore.getState().appendToLastMessage('session-1', ' world');
      useChatStore.getState().addToolCall(RUN_ID, 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult(RUN_ID, 'tc-1', 'ok');
      useChatStore.getState().appendTextBlock(RUN_ID, 'stream text');
      useChatStore.getState().finalizeRunToMessage(RUN_ID);

      const messages = useChatMessageStore.getState().messages['session-1'];
      expect(messages[0].content).toBe('Hello world');
      expect(messages[0].toolCalls).toHaveLength(1);
      expect(messages[0].contentBlocks).toEqual([{ type: 'text', content: 'stream text' }]);
      expect(messages[1].content).toBe('Task started');
    });

    it('finalizeRunToMessage preserves more complete existing data', () => {
      // Set up an assistant message with pre-existing tool calls (e.g., from API load)
      const message = createMessage({ id: 'msg-1', role: 'assistant', content: 'Response' });
      const existingToolCalls = [
        { id: 'tc-1', toolName: 'Read', toolInput: {}, status: 'completed' as const, result: 'data' },
        { id: 'tc-2', toolName: 'Write', toolInput: {}, status: 'completed' as const, result: 'ok' },
      ];
      useChatMessageStore.getState().addMessage('session-1', { ...message, toolCalls: existingToolCalls });

      // Run has no tool calls tracked (mid-stream join scenario)
      useChatStore.getState().finalizeRunToMessage(RUN_ID);

      const messages = useChatMessageStore.getState().messages['session-1'];
      // Should keep the existing 2 tool calls, not overwrite with empty
      expect(messages[0].toolCalls).toHaveLength(2);
    });
  });

});


import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../chatStore';
import { useChatMessageStore, type MessageWithToolCalls } from '../chatMessageStore';
import { useSessionConfigStore } from '../sessionConfigStore';
import type { UsageInfo } from '@zclaudia/shared/core/message';

const u = (input: number, output: number): UsageInfo => ({
  input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const makeMsg = (id: string, role: 'user' | 'assistant' = 'user', content = 'hello'): MessageWithToolCalls => ({
  id,
  sessionId: 'sess-1',
  role,
  content,
  createdAt: Date.now(),
});

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      activeRuns: {},
      backgroundRunIds: new Set(),
      runHealth: {},
      runRetryStatus: {},
      activeToolCalls: {},
      toolCallsHistory: {},
      runContentBlocks: {},
    });
    useChatMessageStore.setState({
      messages: {},
      pagination: {},
    });
    useSessionConfigStore.setState({
      systemInfoBySession: {},
      modeBySession: {},
      runtimeModes: {},
      sessionUsage: {},
      compactionNotice: {},
    });
  });

  // ── Run lifecycle ────────────────────────────────────

  describe('startRun / endRun', () => {
    it('starts and ends a run', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      expect(useChatStore.getState().activeRuns['run-1']).toBe('sess-1');
      expect(useChatStore.getState().activeToolCalls['run-1']).toEqual({});

      useChatStore.getState().endRun('run-1');
      expect(useChatStore.getState().activeRuns['run-1']).toBeUndefined();
    });

    it('tracks background runs', () => {
      useChatStore.getState().startRun('run-bg', 'sess-1', true);
      expect(useChatStore.getState().backgroundRunIds.has('run-bg')).toBe(true);

      useChatStore.getState().endRun('run-bg');
      expect(useChatStore.getState().backgroundRunIds.has('run-bg')).toBe(false);
    });
  });

  describe('updateRunHealth', () => {
    it('sets run health info', () => {
      const health = { sessionId: 'sess-1', startedAt: 1000, lastActivityAt: 2000, health: 'healthy' as const };
      useChatStore.getState().updateRunHealth('run-1', health);
      expect(useChatStore.getState().runHealth['run-1']).toEqual(health);
    });
  });

  // ── Tool calls ──────────────────────────────────────

  describe('tool call actions', () => {
    it('addToolCall adds a tool call', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', { file: 'a.ts' });

      const tc = useChatStore.getState().activeToolCalls['run-1']['tc-1'];
      expect(tc.toolName).toBe('Read');
      expect(tc.status).toBe('running');
    });

    it('updateToolCallResult completes a tool call', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult('run-1', 'tc-1', 'content', false);

      const tc = useChatStore.getState().activeToolCalls['run-1']['tc-1'];
      expect(tc.status).toBe('completed');
      expect(tc.result).toBe('content');
    });

    it('updateToolCallResult marks error', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Bash', {});
      useChatStore.getState().updateToolCallResult('run-1', 'tc-1', 'error msg', true);

      const tc = useChatStore.getState().activeToolCalls['run-1']['tc-1'];
      expect(tc.status).toBe('error');
      expect(tc.isError).toBe(true);
    });

    it('updateToolCallResult returns state when runId missing', () => {
      const before = useChatStore.getState();
      useChatStore.getState().updateToolCallResult('nonexistent', 'tc-1', 'result');
      expect(useChatStore.getState().activeToolCalls).toBe(before.activeToolCalls);
    });

    it('updateToolCallActivity sets activity text', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallActivity('run-1', 'tc-1', 'Reading file...');

      const tc = useChatStore.getState().activeToolCalls['run-1']['tc-1'];
      expect(tc.activity).toBe('Reading file...');
    });

    it('updateToolCallActivity does nothing for completed tool call', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      useChatStore.getState().updateToolCallResult('run-1', 'tc-1', 'done');
      const before = useChatStore.getState().activeToolCalls;
      useChatStore.getState().updateToolCallActivity('run-1', 'tc-1', 'activity');
      expect(useChatStore.getState().activeToolCalls).toBe(before);
    });
  });

  // ── Content blocks ──────────────────────────────────

  describe('content block actions', () => {
    it('appendTextBlock creates new text block', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().appendTextBlock('run-1', 'Hello');
      const blocks = useChatStore.getState().runContentBlocks['run-1'];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({ type: 'text', content: 'Hello' });
    });

    it('appendTextBlock appends to existing text block', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().appendTextBlock('run-1', 'Hello');
      useChatStore.getState().appendTextBlock('run-1', ' World');
      const blocks = useChatStore.getState().runContentBlocks['run-1'];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({ type: 'text', content: 'Hello World' });
    });

    it('appendTextBlock creates new block after tool_use block', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().appendTextBlock('run-1', 'Before');
      useChatStore.getState().addToolUseBlock('run-1', 'tc-1');
      useChatStore.getState().appendTextBlock('run-1', 'After');
      const blocks = useChatStore.getState().runContentBlocks['run-1'];
      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe('text');
      expect(blocks[1].type).toBe('tool_use');
      expect(blocks[2].type).toBe('text');
    });

    it('addToolUseBlock adds tool use block', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolUseBlock('run-1', 'tc-1');
      const blocks = useChatStore.getState().runContentBlocks['run-1'];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({ type: 'tool_use', toolUseId: 'tc-1' });
    });
  });

  // ── finalizeRunToMessage ────────────────────────────

  describe('finalizeRunToMessage', () => {
    it('finalizes tool calls and content blocks onto assistant message', () => {
      useChatMessageStore.getState().setMessages('sess-1', [
        makeMsg('m1', 'user'),
        makeMsg('m2', 'assistant', 'response'),
      ]);
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      useChatStore.getState().appendTextBlock('run-1', 'text');
      useChatStore.getState().finalizeRunToMessage('run-1');

      const msg = useChatMessageStore.getState().messages['sess-1'][1];
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.contentBlocks).toHaveLength(1);
    });

    it('does nothing when no active run', () => {
      const before = useChatMessageStore.getState().messages;
      useChatStore.getState().finalizeRunToMessage('nonexistent');
      expect(useChatMessageStore.getState().messages).toBe(before);
    });

    it('does nothing when no messages', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      const before = useChatMessageStore.getState().messages;
      useChatStore.getState().finalizeRunToMessage('run-1');
      expect(useChatMessageStore.getState().messages).toBe(before);
    });

    it('preserves existing tool calls when more complete', () => {
      const existingTC = [{ id: 'tc-1', toolName: 'Read', toolInput: {}, status: 'completed' as const, result: 'data' }];
      useChatMessageStore.getState().setMessages('sess-1', [
        { ...makeMsg('m2', 'assistant', 'response'), toolCalls: existingTC },
      ]);
      useChatStore.getState().startRun('run-1', 'sess-1');
      // Run has no tool calls (empty)
      useChatStore.getState().finalizeRunToMessage('run-1');

      const msg = useChatMessageStore.getState().messages['sess-1'][0];
      expect(msg.toolCalls).toEqual(existingTC);
    });
  });

  // ── System info ─────────────────────────────────────

  describe('system info', () => {
    it('sets and gets system info', () => {
      const info = { model: 'claude-4', cwd: '/home' };
      useSessionConfigStore.getState().setSystemInfo('sess-1', info);
      expect(useSessionConfigStore.getState().getSystemInfo('sess-1')).toEqual(info);
    });

    it('clears system info', () => {
      useSessionConfigStore.getState().setSystemInfo('sess-1', { model: 'test' });
      useSessionConfigStore.getState().clearSystemInfo('sess-1');
      expect(useSessionConfigStore.getState().getSystemInfo('sess-1')).toBeNull();
    });

    it('returns null for unknown session', () => {
      expect(useSessionConfigStore.getState().getSystemInfo('unknown')).toBeNull();
    });
  });

  // ── Mode ───────────────────────────────────────────

  describe('mode', () => {
    it('setMode + getMode round-trip', () => {
      useSessionConfigStore.getState().setMode('s1', 'plan');
      expect(useSessionConfigStore.getState().getMode('s1')).toBe('plan');
      useSessionConfigStore.getState().setMode('s1', 'default');
      expect(useSessionConfigStore.getState().getMode('s1')).toBe('default');
    });

    it('getMode defaults to empty string for unknown session', () => {
      expect(useSessionConfigStore.getState().getMode('unknown')).toBe('');
    });

    it('tracks runtime mode separately and clears it when a run ends', () => {
      useSessionConfigStore.getState().setMode('sess-1', 'default');
      useSessionConfigStore.getState().setRuntimeMode('sess-1', 'plan');
      useChatStore.getState().startRun('run-1', 'sess-1');

      expect(useSessionConfigStore.getState().getMode('sess-1')).toBe('default');
      expect(useSessionConfigStore.getState().getRuntimeMode('sess-1')).toBe('plan');

      useChatStore.getState().endRun('run-1');

      expect(useSessionConfigStore.getState().getMode('sess-1')).toBe('default');
      expect(useSessionConfigStore.getState().getRuntimeMode('sess-1')).toBe('');
    });
  });

  // ── System info → usage contextWindow wiring ───────

  describe('system info contextWindow', () => {
    it('setSystemInfo copies contextWindow into the session usage record (no prior usage)', () => {
      useSessionConfigStore.getState().setSystemInfo('s2', {
        model: 'kimi-k2.6',
        contextWindow: 128_000,
      });
      const usage = useSessionConfigStore.getState().sessionUsage['s2'];
      expect(usage.contextWindow).toBe(128_000);
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
    });

    it('setSystemInfo updates existing usage record with contextWindow', () => {
      useSessionConfigStore.getState().addSessionUsage('s3', u(100, 50));
      useSessionConfigStore.getState().setSystemInfo('s3', { contextWindow: 64_000 });
      const usage = useSessionConfigStore.getState().sessionUsage['s3'];
      expect(usage.contextWindow).toBe(64_000);
      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(50);
    });

    it('setSystemInfo without contextWindow leaves usage untouched', () => {
      useSessionConfigStore.getState().addSessionUsage('s4', u(20, 10));
      useSessionConfigStore.getState().setSystemInfo('s4', { model: 'foo' });
      const usage = useSessionConfigStore.getState().sessionUsage['s4'];
      expect(usage.contextWindow).toBeUndefined();
    });

    // F2: contextWindowSource is wired alongside contextWindow so the UI can
    // explain provenance and warn on the fallback path.
    it('setSystemInfo copies contextWindowSource into usage (fresh record)', () => {
      useSessionConfigStore.getState().setSystemInfo('s5', {
        contextWindow: 200_000,
        contextWindowSource: 'profile_entry',
      });
      const usage = useSessionConfigStore.getState().sessionUsage['s5'];
      expect(usage.contextWindow).toBe(200_000);
      expect(usage.contextWindowSource).toBe('profile_entry');
    });

    it('setSystemInfo updates contextWindowSource on existing usage record', () => {
      useSessionConfigStore.getState().addSessionUsage('s6', u(1, 2));
      useSessionConfigStore.getState().setSystemInfo('s6', {
        contextWindow: 64_000,
        contextWindowSource: 'fallback',
      });
      const usage = useSessionConfigStore.getState().sessionUsage['s6'];
      expect(usage.contextWindowSource).toBe('fallback');
    });

    it('addSessionUsage preserves contextWindowSource set earlier by setSystemInfo', () => {
      useSessionConfigStore.getState().setSystemInfo('s7', {
        contextWindow: 128_000,
        contextWindowSource: 'pi_ai_registry',
      });
      useSessionConfigStore.getState().addSessionUsage('s7', u(50, 25));
      const usage = useSessionConfigStore.getState().sessionUsage['s7'];
      expect(usage.contextWindowSource).toBe('pi_ai_registry');
      expect(usage.contextWindow).toBe(128_000);
      expect(usage.inputTokens).toBe(50);
    });

    // F4: matchedProvider is the cross-provider annotation that lets the UI
    // show "from registry (deepseek)" — it must round-trip from system_info
    // wire through usage and survive subsequent addSessionUsage calls.
    it('setSystemInfo copies contextWindowMatchedProvider into usage (fresh record)', () => {
      useSessionConfigStore.getState().setSystemInfo('s8', {
        contextWindow: 131_072,
        contextWindowSource: 'pi_ai_registry',
        contextWindowMatchedProvider: 'deepseek',
      });
      const usage = useSessionConfigStore.getState().sessionUsage['s8'];
      expect(usage.contextWindowSource).toBe('pi_ai_registry');
      expect(usage.contextWindowMatchedProvider).toBe('deepseek');
    });

    it('addSessionUsage preserves contextWindowMatchedProvider set earlier by setSystemInfo', () => {
      useSessionConfigStore.getState().setSystemInfo('s9', {
        contextWindow: 131_072,
        contextWindowSource: 'pi_ai_registry',
        contextWindowMatchedProvider: 'deepseek',
      });
      useSessionConfigStore.getState().addSessionUsage('s9', u(10, 5));
      const usage = useSessionConfigStore.getState().sessionUsage['s9'];
      expect(usage.contextWindowMatchedProvider).toBe('deepseek');
      expect(usage.contextWindowSource).toBe('pi_ai_registry');
      expect(usage.contextWindow).toBe(131_072);
      expect(usage.inputTokens).toBe(10);
    });

    it('setSystemInfo leaves contextWindowMatchedProvider undefined when wire omits it', () => {
      useSessionConfigStore.getState().setSystemInfo('s10', {
        contextWindow: 200_000,
        contextWindowSource: 'profile_entry',
      });
      const usage = useSessionConfigStore.getState().sessionUsage['s10'];
      expect(usage.contextWindowMatchedProvider).toBeUndefined();
    });
  });

  // ── Usage tracking ─────────────────────────────────

  describe('addSessionUsage', () => {
    it('accumulates usage', () => {
      useSessionConfigStore.getState().addSessionUsage('sess-1', u(100, 50));
      useSessionConfigStore.getState().addSessionUsage('sess-1', u(200, 100));

      const usage = useSessionConfigStore.getState().sessionUsage['sess-1'];
      expect(usage.inputTokens).toBe(300);
      expect(usage.outputTokens).toBe(150);
      expect(usage.contextWindow).toBeUndefined();
      expect(usage.latestInputTokens).toBe(200);
      expect(usage.latestOutputTokens).toBe(100);
    });

    it('clears usage for the reset session only', () => {
      useSessionConfigStore.getState().addSessionUsage('sess-1', u(100, 50));
      useSessionConfigStore.getState().addSessionUsage('sess-2', u(200, 100));

      useSessionConfigStore.getState().clearSessionUsage('sess-1');

      expect(useSessionConfigStore.getState().sessionUsage['sess-1']).toBeUndefined();
      expect(useSessionConfigStore.getState().sessionUsage['sess-2']).toEqual({
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        latestInputTokens: 200,
        latestOutputTokens: 100,
        latestCacheReadTokens: 0,
        latestCacheWriteTokens: 0,
      });
    });

    const uc = (input: number, output: number, cacheRead: number, cacheWrite: number): UsageInfo => ({
      input, output, cacheRead, cacheWrite, totalTokens: input + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });

    it('accumulates cache tokens and tracks latest snapshot', () => {
      useSessionConfigStore.getState().addSessionUsage('sess-1', uc(100, 50, 1000, 200));
      useSessionConfigStore.getState().addSessionUsage('sess-1', uc(10, 5, 2000, 0));

      const usage = useSessionConfigStore.getState().sessionUsage['sess-1'];
      expect(usage.cacheReadTokens).toBe(3000);
      expect(usage.cacheWriteTokens).toBe(200);
      expect(usage.latestCacheReadTokens).toBe(2000);
      expect(usage.latestCacheWriteTokens).toBe(0);
    });
  });

  // ── Getters ─────────────────────────────────────────

  describe('getters', () => {
    it('isSessionLoading returns true for active foreground run', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      expect(useChatStore.getState().isSessionLoading('sess-1')).toBe(true);
    });

    it('isSessionLoading returns false for background run', () => {
      useChatStore.getState().startRun('run-bg', 'sess-1', true);
      expect(useChatStore.getState().isSessionLoading('sess-1')).toBe(false);
    });

    it('isSessionLoading returns false when no run', () => {
      expect(useChatStore.getState().isSessionLoading('sess-1')).toBe(false);
    });

    it('getSessionRunId returns run id', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      expect(useChatStore.getState().getSessionRunId('sess-1')).toBe('run-1');
    });

    it('getSessionRunId returns null when no run', () => {
      expect(useChatStore.getState().getSessionRunId('sess-1')).toBeNull();
    });

    it('getSessionHealth returns health for active run', () => {
      const health = { sessionId: 'sess-1', startedAt: 1000, lastActivityAt: 2000, health: 'healthy' as const };
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().updateRunHealth('run-1', health);
      expect(useChatStore.getState().getSessionHealth('sess-1')).toEqual(health);
    });

    it('getSessionHealth returns null when no run', () => {
      expect(useChatStore.getState().getSessionHealth('sess-1')).toBeNull();
    });

    it('getSessionToolCalls returns tool calls for active run', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      const tcs = useChatStore.getState().getSessionToolCalls('sess-1');
      expect(tcs).toHaveLength(1);
    });

    it('getSessionToolCalls returns empty when no run', () => {
      expect(useChatStore.getState().getSessionToolCalls('sess-1')).toEqual([]);
    });

    it('getSessionContentBlocks returns blocks for active run', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().appendTextBlock('run-1', 'text');
      expect(useChatStore.getState().getSessionContentBlocks('sess-1')).toHaveLength(1);
    });

    it('getSessionContentBlocks returns empty when no run', () => {
      expect(useChatStore.getState().getSessionContentBlocks('sess-1')).toEqual([]);
    });

    it('getSessionToolCallHistory returns history for active run', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().addToolCall('run-1', 'tc-1', 'Read', {});
      useChatStore.getState().addToolCall('run-1', 'tc-2', 'Edit', {});
      const history = useChatStore.getState().getSessionToolCallHistory('sess-1');
      expect(history).toHaveLength(2);
    });

    it('getSessionToolCallHistory returns empty when no run', () => {
      expect(useChatStore.getState().getSessionToolCallHistory('sess-1')).toEqual([]);
    });
  });

  // ── Run retry status ─────────────────────────────────

  describe('runRetryStatus', () => {
    it('sets and clears retry status with run lifecycle', () => {
      useChatStore.getState().startRun('run-1', 'sess-1');
      useChatStore.getState().updateRunRetryStatus('run-1', {
        sessionId: 'sess-1', attempt: 2, maxAttempts: 5, delayMs: 8000, status: 429, receivedAt: 123,
      });
      expect(useChatStore.getState().runRetryStatus['run-1']).toMatchObject({ attempt: 2, status: 429 });
      useChatStore.getState().clearRunRetryStatus('run-1');
      expect(useChatStore.getState().runRetryStatus['run-1']).toBeUndefined();
    });

    it('endRun cleans up retry status', () => {
      useChatStore.getState().startRun('run-2', 'sess-2');
      useChatStore.getState().updateRunRetryStatus('run-2', {
        sessionId: 'sess-2', attempt: 3, maxAttempts: 5, delayMs: 4000, receivedAt: 456,
      });
      useChatStore.getState().endRun('run-2');
      expect(useChatStore.getState().runRetryStatus['run-2']).toBeUndefined();
    });
  });
});

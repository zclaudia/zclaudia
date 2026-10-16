import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverCurrentSession, recoverCurrentSessionTail } from '../../services/sessionSync';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useRunStore } from '../../stores/runStore';
import { useSessionRunStateStore } from '../../stores/sessionRunStateStore';
import { scheduleDelta } from '../../services/message-handlers/delta-buffer';
import { handleServerMessage } from '../../services/messageHandler';
import { terminalRunSeqByRun } from '../../services/message-handlers/run-finalization';

const { getSessionMessages, getSessionRunState } = vi.hoisted(() => ({
  getSessionMessages: vi.fn(),
  getSessionRunState: vi.fn(),
}));
vi.mock('../../services/api', () => ({ getSessionMessages, getSessionRunState }));

const message = (content: string) => ({
  id: 'assistant-1',
  sessionId: 'session-1',
  role: 'assistant' as const,
  offset: 12,
  createdAt: 1,
  content,
  metadata: { contentBlocks: [{ type: 'text' as const, content }] },
});

describe('mobile recovery hydrates the actual rendered message store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getSessionMessages.mockReset();
    getSessionRunState.mockReset().mockResolvedValue({ sessionId: 'session-1', isRunning: false });
    useRunStore.setState(useRunStore.getInitialState());
    useSessionRunStateStore.setState({ records: {} });
    terminalRunSeqByRun.clear();
    useSelectionStore.setState({ selectedSessionId: 'session-1' });
    useServerStore.setState({ activeServerId: 'backend-1' });
    useFacadeStore.setState({ reconnectGeneration: 1, connectionState: 'connected' });
    useChatMessageStore.setState({ messages: {}, pagination: {} });
    useChatMessageStore.getState().setMessages('session-1', [message('partial')], {
      total: 1,
      hasMore: false,
      maxOffset: 12,
      messageVersion: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces a partial body and rendered blocks even when the offset has not changed', async () => {
    getSessionMessages.mockResolvedValue({
      messages: [message('partial response completed while the phone was frozen')],
      pagination: { maxOffset: 12, messageVersion: 2 },
    });
    expect(await recoverCurrentSessionTail('backend-1')).toBe(true);
    const state = useChatMessageStore.getState();
    expect(state.messages['session-1']).toHaveLength(1);
    expect(state.messages['session-1'][0].content).toBe(
      'partial response completed while the phone was frozen'
    );
    expect(state.messages['session-1'][0].contentBlocks).toEqual([
      { type: 'text', content: 'partial response completed while the phone was frozen' },
    ]);
    expect(state.pagination['session-1'].maxOffset).toBe(12);
    expect(state.pagination['session-1'].messageVersion).toBe(2);
  });

  it('starts fresh recovery after reconnect and ignores a longer stale response', async () => {
    let resolveObsolete!: (value: unknown) => void;
    getSessionMessages.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveObsolete = resolve;
        })
    );
    const obsolete = recoverCurrentSessionTail('backend-1');
    useFacadeStore.setState({ reconnectGeneration: 2 });
    getSessionMessages.mockResolvedValueOnce({
      messages: [message('current complete answer')],
      pagination: { maxOffset: 12, messageVersion: 3 },
    });
    expect(await recoverCurrentSessionTail('backend-1')).toBe(true);
    resolveObsolete({
      messages: [
        message('obsolete answer that is longer and would otherwise win the no-shrink merge'),
      ],
      pagination: { maxOffset: 12, messageVersion: 2 },
    });
    expect(await obsolete).toBe(false);
    expect(useChatMessageStore.getState().messages['session-1'][0].content).toBe(
      'current complete answer'
    );
    expect(useChatMessageStore.getState().pagination['session-1'].messageVersion).toBe(3);
  });

  it('releases a hung request so later recovery can repair the store', async () => {
    getSessionMessages.mockImplementationOnce(() => new Promise(() => {}));
    const hung = recoverCurrentSessionTail('backend-1');
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await hung).toBe(false);
    expect(getSessionMessages.mock.calls[0][1].signal.aborted).toBe(true);
    getSessionMessages.mockResolvedValueOnce({
      messages: [message('recovered after a timeout')],
      pagination: { maxOffset: 12, messageVersion: 2 },
    });
    expect(await recoverCurrentSessionTail('backend-1')).toBe(true);
    expect(useChatMessageStore.getState().messages['session-1'][0].content).toBe(
      'recovered after a timeout'
    );
  });

  it('repairs a completed run and its same-offset final body without waiting for heartbeats', async () => {
    useRunStore.getState().startRun('run-1', 'session-1', false, 'assistant-1');
    useSessionRunStateStore
      .getState()
      .markRunStarted({ backendId: 'backend-1', runId: 'run-1', sessionId: 'session-1' });
    scheduleDelta('session-1', 'run-1', ' buffered text');
    getSessionMessages.mockResolvedValue({
      messages: [message('authoritative final response')],
      pagination: { maxOffset: 12, messageVersion: 2 },
    });
    expect(await recoverCurrentSession('backend-1')).toBe(true);
    expect(useRunStore.getState().activeRuns).toEqual({});
    expect(useRunStore.getState().runContentBlocks['run-1']).toBeUndefined();
    expect(Object.values(useSessionRunStateStore.getState().records)[0].phase).toBe('idle');
    expect(useChatMessageStore.getState().messages['session-1'][0].content).toBe(
      'authoritative final response'
    );
    expect(useChatMessageStore.getState().messages['session-1'][0].contentBlocks).toEqual([
      { type: 'text', content: 'authoritative final response' },
    ]);
  });

  it('keeps a run which is still active on the backend', async () => {
    useRunStore.getState().startRun('run-1', 'session-1', false, 'assistant-1');
    getSessionRunState.mockResolvedValue({
      sessionId: 'session-1',
      isRunning: true,
      activeRunId: 'run-1',
    });
    getSessionMessages.mockResolvedValue({
      messages: [message('more content')],
      pagination: { maxOffset: 12 },
    });
    expect(await recoverCurrentSession('backend-1')).toBe(true);
    expect(useRunStore.getState().activeRuns['run-1']).toBe('session-1');
  });

  it('does not clear a newer run using an older idle HTTP response', async () => {
    let resolveState!: (state: unknown) => void;
    getSessionRunState.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveState = resolve;
        })
    );
    getSessionMessages.mockResolvedValue({
      messages: [message('old response')],
      pagination: { maxOffset: 12 },
    });
    const recovery = recoverCurrentSession('backend-1');
    useRunStore.getState().startRun('new-run', 'session-1', false, 'new-assistant');
    resolveState({ sessionId: 'session-1', isRunning: false });
    expect(await recovery).toBe(false);
    expect(useRunStore.getState().activeRuns['new-run']).toBe('session-1');
    expect(useChatMessageStore.getState().messages['session-1'][0].content).toBe('partial');
  });

  it('rejects old recovery as soon as the connection disconnects, before its next generation', async () => {
    let resolveState!: (state: unknown) => void;
    useRunStore.getState().startRun('run-1', 'session-1', false, 'assistant-1');
    getSessionRunState.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveState = resolve;
        })
    );
    getSessionMessages.mockResolvedValue({
      messages: [message('old response')],
      pagination: { maxOffset: 12 },
    });
    const recovery = recoverCurrentSession('backend-1');
    useFacadeStore.setState({ connectionState: 'reconnecting' });
    resolveState({ sessionId: 'session-1', isRunning: false });
    expect(await recovery).toBe(false);
    expect(useRunStore.getState().activeRuns['run-1']).toBe('session-1');
  });

  it('bounds the run-state request and aborts both HTTP requests on timeout', async () => {
    getSessionRunState.mockImplementationOnce(() => new Promise(() => {}));
    getSessionMessages.mockImplementationOnce(() => new Promise(() => {}));
    const recovery = recoverCurrentSession('backend-1');
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await recovery).toBe(false);
    expect(getSessionRunState.mock.calls[0][1].signal.aborted).toBe(true);
    expect(getSessionMessages.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('cannot resurrect a recovered terminal run through queued heartbeats or run events', async () => {
    useRunStore.getState().startRun('run-1', 'session-1', false, 'assistant-1');
    getSessionMessages.mockResolvedValue({
      messages: [message('complete')],
      pagination: { maxOffset: 12 },
    });
    expect(await recoverCurrentSession('backend-1')).toBe(true);
    const ctx = {
      backendId: 'backend-1',
      serverId: 'backend-1',
      serverRunsRef: new Map(),
      resolveBackendName: () => 'Backend',
      logTag: 'RecoveryTest',
    };
    handleServerMessage(
      {
        type: 'state_heartbeat',
        activeRuns: [
          {
            runId: 'run-1',
            sessionId: 'session-1',
            startedAt: 1,
            lastActivityAt: 1,
            health: 'healthy',
            lastSeq: 100,
          },
        ],
        pendingPermissions: [],
        pendingQuestions: [],
        pendingApprovals: [],
        versions: { projects: 0, plugins: 0 },
      } as any,
      ctx
    );
    handleServerMessage(
      {
        type: 'run_started',
        runId: 'run-1',
        sessionId: 'session-1',
        assistantMessageId: 'assistant-1',
      } as any,
      ctx
    );
    expect(useRunStore.getState().activeRuns).toEqual({});
    expect(Object.values(useSessionRunStateStore.getState().records)[0].phase).toBe('idle');
  });
});

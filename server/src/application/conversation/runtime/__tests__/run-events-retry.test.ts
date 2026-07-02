import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal mocks matching the pattern used by the adjacent run-events.test.ts.
vi.mock('../run-lifecycle.js', () => ({
  cleanupPendingPermissions: vi.fn(),
  findProcessPidsByTaskCommand: vi.fn(),
  upsertAssistantMessage: vi.fn(),
}));

vi.mock('../../compaction/compaction-service.js', () => ({
  maybeCompact: vi.fn(async () => ({ compacted: false })),
}));

vi.mock('../../../../infra/events/index.js', () => ({
  pluginEvents: {
    emit: vi.fn(async () => {}),
  },
}));

vi.mock('../../interactions/interaction-normalizer.js', () => ({
  normalizeFromToolUse: vi.fn(() => null),
}));

vi.mock('../../transport/broadcast.js', () => ({
  sendMessage: vi.fn(),
}));

const mockProviderRegistry = {
  get: vi.fn(() => undefined),
  getPolicy: vi.fn(() => undefined),
  getOrDefault: vi.fn(),
};

describe('run-events retry_scheduled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('translates retry_scheduled into a run_retrying wire event', async () => {
    const sendRunEvent = vi.fn();
    const activeRun = {
      sessionId: 'session-retry-1',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'retry_scheduled',
        retryInfo: {
          attempt: 2,
          maxAttempts: 5,
          delayMs: 1000,
          status: 429,
        },
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-retry-1',
      sendRunEvent,
      sessionId: 'session-retry-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(sendRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_retrying',
        runId: 'run-retry-1',
        sessionId: 'session-retry-1',
        attempt: 2,
        maxAttempts: 5,
        delayMs: 1000,
        status: 429,
      })
    );
  });

  it('omits status field when not provided in retryInfo', async () => {
    const sendRunEvent = vi.fn();
    const activeRun = {
      sessionId: 'session-retry-2',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'retry_scheduled',
        retryInfo: {
          attempt: 3,
          maxAttempts: 5,
          delayMs: 2000,
          // no status — connection-level failure
        },
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-retry-2',
      sendRunEvent,
      sessionId: 'session-retry-2',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    const call = sendRunEvent.mock.calls[0][0];
    expect(call.type).toBe('run_retrying');
    expect(call.attempt).toBe(3);
    expect(call).not.toHaveProperty('status');
  });

  it('emits nothing when retryInfo is absent', async () => {
    const sendRunEvent = vi.fn();
    const activeRun = {
      sessionId: 'session-retry-3',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'retry_scheduled',
        // no retryInfo
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-retry-3',
      sendRunEvent,
      sessionId: 'session-retry-3',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(sendRunEvent).not.toHaveBeenCalled();
  });
});

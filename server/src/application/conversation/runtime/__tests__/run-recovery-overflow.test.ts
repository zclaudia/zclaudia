import { describe, it, expect, vi, beforeEach } from 'vitest';

const { compactForOverflow } = vi.hoisted(() => ({ compactForOverflow: vi.fn() }));
vi.mock('../../compaction/compaction-service.js', () => ({ compactForOverflow }));

import { handleRunException } from '../run-recovery.js';
import { ContextOverflowError } from '../context-overflow.js';

function baseInput(overrides: Record<string, unknown> = {}) {
  const sendRunEvent = vi.fn();
  const handleRetry = vi.fn().mockResolvedValue(undefined);
  return {
    input: {
      activeRun: {
        sessionId: 's1',
        providerType: 'zclaudia',
        agentProfile: { model: 'm' },
        llmProfile: { apiKey: 'k' },
        saveInterval: undefined,
        pendingPermissions: new Map(),
        phase: 'running',
        phaseEmitter: { emit: vi.fn(), onChange: vi.fn() },
        fullContent: '',
        collectedToolCalls: [],
      } as any,
      activeRuns: new Map([['r1', {} as any]]),
      broadcastHeartbeat: vi.fn(),
      client: {} as any,
      ctx: {},
      db: { prepare: () => ({ run: () => undefined }) } as any,
      error: new ContextOverflowError('prompt is too long'),
      formatProviderErrorMessage: (m: string) => m,
      providerRegistry: { getPolicy: () => undefined },
      handleRetry,
      isHardQuotaExceededError: () => false,
      message: { sessionId: 's1' },
      notificationService: { notify: vi.fn() } as any,
      processMonitor: null,
      recoveryState: {},
      runId: 'r1',
      sdkSessionId: undefined,
      sendRunEvent,
      sessionType: 'regular' as const,
      trace: { log: vi.fn() } as any,
      ...overrides,
    },
    sendRunEvent,
    handleRetry,
  };
}

beforeEach(() => {
  compactForOverflow.mockReset();
});

describe('handleRunException — overflow recovery', () => {
  it('compacts and retries when overflow compaction succeeds', async () => {
    compactForOverflow.mockResolvedValue({ outcome: 'compacted', compacted: true });
    const { input, handleRetry } = baseInput();
    const result = await handleRunException(input as any);
    expect(compactForOverflow).toHaveBeenCalledOnce();
    expect(handleRetry).toHaveBeenCalledWith({
      overflowRetryCount: 1,
      sessionResetRetryCount: undefined,
    });
    expect(result.handedOffToRetry).toBe(true);
  });

  it('falls through to failure when compaction cannot cut (no_cut_point)', async () => {
    compactForOverflow.mockResolvedValue({
      outcome: 'skipped',
      compacted: false,
      reason: 'no_cut_point',
    });
    const { input, handleRetry, sendRunEvent } = baseInput();
    const result = await handleRunException(input as any);
    expect(handleRetry).not.toHaveBeenCalled();
    expect(result.handedOffToRetry).toBe(false);
    expect(sendRunEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'run_failed' }));
  });

  it('does not retry past MAX_OVERFLOW_RETRIES', async () => {
    compactForOverflow.mockResolvedValue({ outcome: 'compacted', compacted: true });
    const { input, handleRetry } = baseInput({ recoveryState: { overflowRetryCount: 1 } });
    const result = await handleRunException(input as any);
    expect(compactForOverflow).not.toHaveBeenCalled();
    expect(handleRetry).not.toHaveBeenCalled();
    expect(result.handedOffToRetry).toBe(false);
  });
});

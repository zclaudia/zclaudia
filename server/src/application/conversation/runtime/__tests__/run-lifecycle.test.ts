import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ActiveRun } from '../../transport/types.js';
import type { CancelRunContext } from '../run-lifecycle.js';
import { PhaseEmitter, setPhase } from '../active-run-phase.js';

const broadcastRunMessageMock = vi.fn();
const sendMessageMock = vi.fn();
const upsertAssistantMessageMock = vi.fn();
const cancelBySessionMock = vi.fn();

vi.mock('../../transport/broadcast.js', () => ({
  broadcastRunMessage: broadcastRunMessageMock,
  sendMessage: sendMessageMock,
}));

vi.mock('../../interactions/interaction-dispatcher.js', () => ({
  interactionDispatcher: {
    cancelBySession: cancelBySessionMock,
  },
}));

vi.mock('../../../../infra/storage/metadata-extractor.js', () => ({
  extractAndIndexMetadata: vi.fn(),
  removeIndexedMetadata: vi.fn(),
}));

// upsertAssistantMessage is exported by run-lifecycle itself; we re-import after
// resetting modules so the side-effect-free helper isn't replaced. The cancel
// path runs `upsertAssistantMessage(run, …)` which would touch the (absent) db.
// To avoid that we set `fullContent=''` + empty arrays so the helper short-circuits.
void upsertAssistantMessageMock;

function makeActiveRun(
  overrides: Partial<ActiveRun> & { pendingSteers: AgentMessage[] }
): ActiveRun {
  const runId = overrides.runId ?? 'r1';
  const base = {
    runId,
    clientId: 'client-1',
    client: {
      id: 'client-1',
      ws: { readyState: 1, send: vi.fn() },
      isAlive: true,
      isLocal: true,
      authenticated: true,
    },
    pendingPermissions: new Map(),
    db: {
      prepare: vi.fn(() => ({ get: vi.fn(() => ({ messageVersion: 0 })) })),
    } as never,
    sessionId: overrides.sessionId ?? 's1',
    projectId: 'p1',
    assistantMessageId: 'a1',
    fullContent: '',
    collectedToolCalls: [],
    contentBlocks: [],
    thinkingBlocks: [],
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    recentToolCalls: [],
    loopHeartbeatStreak: 0,
    pendingBackgroundTasks: 0,
    sessionType: 'regular' as const,
    workspaceRoot: '/tmp',
    rememberedDecisions: new Map(),
    allowedOutsideWorkspaceRoots: new Set<string>(),
    eventSeq: 0,
    steerHandle: { steer: vi.fn() },
    phase: 'running' as const,
    phaseEmitter: new PhaseEmitter(),
    ...overrides,
  };
  return base as unknown as ActiveRun;
}

function makeCtx(): CancelRunContext {
  return {
    activeRuns: new Map<string, ActiveRun>(),
    processMonitor: null,
    broadcastHeartbeat: vi.fn(),
    providerRegistry: {
      get: vi.fn(),
    } as never,
  };
}

describe('cancelRun — restoreDraft', () => {
  beforeEach(() => {
    broadcastRunMessageMock.mockReset();
    sendMessageMock.mockReset();
    cancelBySessionMock.mockReset();
  });

  it('includes joined restoreDraft when pendingSteers has entries', async () => {
    const { cancelRun } = await import('../run-lifecycle.js');
    const ctx = makeCtx();
    const run = makeActiveRun({
      runId: 'r1',
      sessionId: 's1',
      pendingSteers: [
        { role: 'user', content: [{ type: 'text', text: 'also fix typo' }] },
        { role: 'user', content: [{ type: 'text', text: 'check imports too' }] },
      ],
    });
    ctx.activeRuns.set('r1', run);

    cancelRun('r1', ctx);

    const failedCall = broadcastRunMessageMock.mock.calls.find(([, m]) => m.type === 'run_failed');
    expect(failedCall).toBeDefined();
    expect(failedCall![1].restoreDraft).toBe('also fix typo\n\ncheck imports too');
    expect(run.pendingSteers).toEqual([]);
    expect(run.steerHandle).toBeUndefined();
  });

  it('omits restoreDraft when pendingSteers is empty', async () => {
    const { cancelRun } = await import('../run-lifecycle.js');
    const ctx = makeCtx();
    const run = makeActiveRun({
      runId: 'r1',
      sessionId: 's1',
      pendingSteers: [],
    });
    ctx.activeRuns.set('r1', run);

    cancelRun('r1', ctx);

    const failedCall = broadcastRunMessageMock.mock.calls.find(([, m]) => m.type === 'run_failed');
    expect(failedCall).toBeDefined();
    expect(failedCall![1].restoreDraft).toBeUndefined();
    expect(run.steerHandle).toBeUndefined();
  });

  it('handles string content in pendingSteers (defensive)', async () => {
    const { cancelRun } = await import('../run-lifecycle.js');
    const ctx = makeCtx();
    const run = makeActiveRun({
      runId: 'r1',
      sessionId: 's1',
      pendingSteers: [{ role: 'user', content: 'plain string steer' as never }],
    });
    ctx.activeRuns.set('r1', run);

    cancelRun('r1', ctx);

    const failedCall = broadcastRunMessageMock.mock.calls.find(([, m]) => m.type === 'run_failed');
    expect(failedCall![1].restoreDraft).toBe('plain string steer');
  });
});

// A1: cancelRun must drive the ActiveRun phase machine through
// `cancelling → cancelled` (happy path) or `cancelling → failed`
// (when the partial-message save throws). A terminal-phase run that
// receives a late cancel must be cleaned up silently without emitting
// any further phase transitions.
describe('cancelRun — phase transitions (A1)', () => {
  beforeEach(() => {
    broadcastRunMessageMock.mockReset();
    sendMessageMock.mockReset();
    cancelBySessionMock.mockReset();
  });

  it('cancelRun → cancelling → cancelled', async () => {
    const { cancelRun } = await import('../run-lifecycle.js');
    const ctx = makeCtx();
    const run = makeActiveRun({
      runId: 'r-phase-happy',
      sessionId: 's1',
      pendingSteers: [],
    });
    ctx.activeRuns.set(run.runId, run);

    cancelRun(run.runId, ctx);

    expect(run.phase).toBe('cancelled');
  });

  it('cancelRun on already-terminal run is a no-op (no illegal-transition warn)', async () => {
    const { cancelRun } = await import('../run-lifecycle.js');
    const ctx = makeCtx();
    const run = makeActiveRun({
      runId: 'r-phase-terminal',
      sessionId: 's1',
      pendingSteers: [],
    });
    // Move to a terminal phase via the validated state machine.
    setPhase(run, 'completed');
    ctx.activeRuns.set(run.runId, run);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    cancelRun(run.runId, ctx);

    expect(run.phase).toBe('completed');
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('illegal phase transition'));
    // Terminal early-return still cleans up activeRuns and pings heartbeat.
    expect(ctx.activeRuns.has(run.runId)).toBe(false);
    // No run_failed broadcast either — there's nothing to tell clients.
    const failedCall = broadcastRunMessageMock.mock.calls.find(([, m]) => m?.type === 'run_failed');
    expect(failedCall).toBeUndefined();
    warnSpy.mockRestore();
  });

  it('cancelRun whose upsertAssistantMessage throws → failed', async () => {
    const { cancelRun } = await import('../run-lifecycle.js');
    const ctx = makeCtx();
    // Force upsertAssistantMessage to throw by giving it nonempty content
    // (so it doesn't short-circuit) and a db whose prepare() throws.
    const throwingDb = {
      prepare: () => {
        throw new Error('db blown up');
      },
    } as never;
    const run = makeActiveRun({
      runId: 'r-phase-failed',
      sessionId: 's1',
      pendingSteers: [],
      db: throwingDb,
      fullContent: 'partial assistant text',
    });
    ctx.activeRuns.set(run.runId, run);

    // The catch in cancelRun logs the error — silence it for clean test output.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    cancelRun(run.runId, ctx);

    expect(run.phase).toBe('failed');
    errSpy.mockRestore();
  });
});

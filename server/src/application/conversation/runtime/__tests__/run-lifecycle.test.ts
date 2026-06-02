import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ActiveRun } from '../../transport/types.js';
import type { CancelRunContext } from '../run-lifecycle.js';

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

function makeActiveRun(overrides: Partial<ActiveRun> & { pendingSteers: AgentMessage[] }): ActiveRun {
  const base = {
    runId: overrides.runId ?? 'r1',
    clientId: 'client-1',
    client: {
      id: 'client-1',
      ws: { readyState: 1, send: vi.fn() },
      isAlive: true,
      isLocal: true,
      authenticated: true,
    },
    pendingPermissions: new Map(),
    db: {} as never,
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
      pendingSteers: [
        { role: 'user', content: 'plain string steer' as never },
      ],
    });
    ctx.activeRuns.set('r1', run);

    cancelRun('r1', ctx);

    const failedCall = broadcastRunMessageMock.mock.calls.find(([, m]) => m.type === 'run_failed');
    expect(failedCall![1].restoreDraft).toBe('plain string steer');
  });
});

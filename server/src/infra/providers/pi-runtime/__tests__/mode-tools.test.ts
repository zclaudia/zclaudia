import { afterEach, describe, expect, it, vi } from 'vitest';

import { interactionDispatcher } from '../../../../application/conversation/interactions/interaction-dispatcher.js';
import { exitPlanMode } from '../../../../domains/sessions/plan-mode-toggle.js';
import { createExitPlanModeTool } from '../mode-tools.js';

vi.mock('../../../../application/conversation/interactions/interaction-dispatcher.js', () => ({
  interactionDispatcher: {
    dispatchAndWait: vi.fn(),
    supersede: vi.fn(),
  },
}));

vi.mock('../../../../domains/sessions/plan-mode-toggle.js', () => ({
  enterPlanMode: vi.fn(),
  exitPlanMode: vi.fn(),
}));

describe('ExitPlanMode tool boundaries', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function tool() {
    return createExitPlanModeTool('/tmp/project', {
      db: {} as never,
      sessionId: 'session-1',
    }) as any;
  }

  it('reports an error when approved plan mode exit fails', async () => {
    vi.mocked(interactionDispatcher.dispatchAndWait).mockResolvedValue({ approved: true });
    vi.mocked(exitPlanMode).mockReturnValue({ ok: false, error: 'session_not_found' });

    const res = await tool().execute('exit-plan-1', { plan: '1. implement the fix' });

    expect(res.details).toMatchObject({
      ok: false,
      error: 'session_not_found',
    });
  });

  it('rejects malformed allowedPrompts before dispatching review', async () => {
    const res = await tool().execute('exit-plan-2', {
      plan: '1. implement the fix',
      allowedPrompts: [{ tool: 'Bash' }],
    });

    expect(res.details).toMatchObject({
      ok: false,
      error: 'invalid_allowed_prompts',
    });
    expect(interactionDispatcher.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('rejects oversized plans before dispatching review', async () => {
    const res = await tool().execute('exit-plan-3', {
      plan: 'x'.repeat(128 * 1024 + 1),
    });

    expect(res.details).toMatchObject({
      ok: false,
      error: 'plan_too_large',
      maxBytes: 128 * 1024,
    });
    expect(interactionDispatcher.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('supersedes any prior pending plan review for the session before dispatching', async () => {
    vi.mocked(interactionDispatcher.dispatchAndWait).mockResolvedValue({ approved: true });
    vi.mocked(exitPlanMode).mockReturnValue({ ok: true, wasActive: true });

    await tool().execute('exit-plan-4', { plan: '1. implement the fix' });

    expect(interactionDispatcher.supersede).toHaveBeenCalledWith(
      'session-1',
      'interaction_plan_review'
    );
    const supersedeOrder = vi.mocked(interactionDispatcher.supersede).mock.invocationCallOrder[0];
    const dispatchOrder = vi.mocked(interactionDispatcher.dispatchAndWait).mock
      .invocationCallOrder[0];
    expect(supersedeOrder).toBeLessThan(dispatchOrder);
  });

  it('dispatches the plan review without a timeout', async () => {
    vi.mocked(interactionDispatcher.dispatchAndWait).mockResolvedValue({ approved: true });
    vi.mocked(exitPlanMode).mockReturnValue({ ok: true, wasActive: true });

    await tool().execute('exit-plan-5', { plan: '1. implement the fix' });

    expect(interactionDispatcher.dispatchAndWait).toHaveBeenCalledWith(
      expect.any(String),
      'session-1',
      expect.objectContaining({ type: 'interaction_plan_review' }),
      null
    );
  });

  it('tells the model to stop and wait when the review times out', async () => {
    vi.mocked(interactionDispatcher.dispatchAndWait).mockResolvedValue({
      error: 'User did not respond within timeout',
    });

    const res = await tool().execute('exit-plan-6', { plan: '1. implement the fix' });

    expect(res.details).toMatchObject({ ok: false, error: 'plan_review_timeout' });
    expect(res.content[0].text).toMatch(/wait/i);
    expect(res.content[0].text).toMatch(/do not proceed/i);
    expect(exitPlanMode).not.toHaveBeenCalled();
  });

  it('reports a superseded review distinctly and does not exit plan mode', async () => {
    vi.mocked(interactionDispatcher.dispatchAndWait).mockResolvedValue({ error: 'superseded' });

    const res = await tool().execute('exit-plan-7', { plan: '1. implement the fix' });

    expect(res.details).toMatchObject({ ok: false, error: 'plan_superseded' });
    expect(exitPlanMode).not.toHaveBeenCalled();
  });

  it('tells the model the run ended when the review is cancelled', async () => {
    vi.mocked(interactionDispatcher.dispatchAndWait).mockResolvedValue({ error: 'Session ended' });

    const res = await tool().execute('exit-plan-8', { plan: '1. implement the fix' });

    expect(res.details).toMatchObject({ ok: false, error: 'plan_review_cancelled' });
    expect(exitPlanMode).not.toHaveBeenCalled();
  });
});

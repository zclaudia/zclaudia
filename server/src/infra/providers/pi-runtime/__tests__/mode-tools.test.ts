import { afterEach, describe, expect, it, vi } from 'vitest';

import { interactionDispatcher } from '../../../../application/conversation/interactions/interaction-dispatcher.js';
import { exitPlanMode } from '../../../../domains/sessions/plan-mode-toggle.js';
import { createExitPlanModeTool } from '../mode-tools.js';

vi.mock('../../../../application/conversation/interactions/interaction-dispatcher.js', () => ({
  interactionDispatcher: {
    dispatchAndWait: vi.fn(),
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
});

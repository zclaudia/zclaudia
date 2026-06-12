import { describe, expect, it } from 'vitest';

import { createEnterPlanModeTool, createExitPlanModeTool } from '../mode-tools.js';
import { createEnterWorktreeTool, createExitWorktreeTool } from '../worktree-tools.js';

describe('mode and worktree bridge tools', () => {
  it('Plan mode tools require session context', async () => {
    const enter = createEnterPlanModeTool('/tmp') as any;
    const exit = createExitPlanModeTool('/tmp') as any;

    const enterResult = await enter.execute('enter-plan', {});
    const exitResult = await exit.execute('exit-plan', {});

    expect(enterResult.details).toMatchObject({ ok: false, error: 'missing_session_context' });
    expect(exitResult.details).toMatchObject({ ok: false, error: 'missing_session_context' });
  });

  it('Worktree tools require session context', async () => {
    const enter = createEnterWorktreeTool('/tmp') as any;
    const exit = createExitWorktreeTool('/tmp') as any;

    const enterResult = await enter.execute('enter-worktree', { name: 'refactor-tools' });
    const exitResult = await exit.execute('exit-worktree', {});

    expect(enterResult.details).toMatchObject({ ok: false, error: 'missing_session_context' });
    expect(exitResult.details).toMatchObject({ ok: false, error: 'missing_session_context' });
  });
});

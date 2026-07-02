import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../../services/goalActions', () => ({ activateGoal: vi.fn() }));
vi.mock('../../../services/api/goals', () => ({
  pauseGoal: vi.fn(),
  resumeGoal: vi.fn(),
  clearGoal: vi.fn(),
}));

import { activateGoal } from '../../../services/goalActions';
import { pauseGoal, resumeGoal } from '../../../services/api/goals';
import { useCommandHandler } from '../useCommandHandler';

function setup() {
  const addMessage = vi.fn();
  const { result } = renderHook(() =>
    useCommandHandler({
      sessionId: 's1',
      commands: [{ command: '/goal', description: '', source: 'local' }],
      currentSession: { id: 's1' } as any,
      currentProject: { id: 'p1', rootPath: '/r' } as any,
      isForcedPlanSession: false,
      mode: 'default',
      addMessage,
      clearMessages: vi.fn(),
      scrollToBottom: vi.fn(),
      startRun: vi.fn(),
      llmProfileId: undefined,
      commandsCacheKey: 'k',
      setDrawerOpen: vi.fn(),
    })
  );
  return { handleCommand: result.current.handleCommand, addMessage };
}

describe('useCommandHandler /goal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('activates a goal from an objective', async () => {
    const { handleCommand } = setup();
    await handleCommand('/goal', 'ship the feature');
    expect(activateGoal).toHaveBeenCalledWith('s1', { objective: 'ship the feature' });
  });

  it('shows usage when no objective is given', async () => {
    const { handleCommand, addMessage } = setup();
    await handleCommand('/goal', '');
    expect(activateGoal).not.toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('Usage: /goal'),
      })
    );
  });

  it('routes the pause subcommand when a goal is active', async () => {
    const { useGoalStore } = await import('../../../stores/goalStore');
    useGoalStore.setState({
      bySession: {
        s1: {
          goal: { id: 'g1', status: 'active' } as any,
          budgetTokensUsed: 0,
          budgetTurnsUsed: 0,
          lastVerdictKind: null,
          lastVerdictReason: null,
        },
      },
    });
    vi.mocked(pauseGoal).mockResolvedValue({ id: 'g1', status: 'paused' } as any);
    const { handleCommand, addMessage } = setup();
    await handleCommand('/goal', 'pause');
    expect(pauseGoal).toHaveBeenCalledWith('s1');
    expect(activateGoal).not.toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        role: 'system',
        content: 'Goal paused.',
      })
    );
  });

  it('routes the resume subcommand when a goal is active', async () => {
    const { useGoalStore } = await import('../../../stores/goalStore');
    useGoalStore.setState({
      bySession: {
        s1: {
          goal: { id: 'g1', status: 'paused' } as any,
          budgetTokensUsed: 0,
          budgetTurnsUsed: 0,
          lastVerdictKind: null,
          lastVerdictReason: null,
        },
      },
    });
    vi.mocked(resumeGoal).mockResolvedValue({ id: 'g1', status: 'active' } as any);
    const { handleCommand, addMessage } = setup();
    await handleCommand('/goal', 'resume');
    expect(resumeGoal).toHaveBeenCalledWith('s1');
    expect(activateGoal).not.toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        role: 'system',
        content: 'Goal resumed.',
      })
    );
  });

  it('treats pause as an objective when no goal is live', async () => {
    const { useGoalStore } = await import('../../../stores/goalStore');
    useGoalStore.setState({ bySession: {} });
    const { handleCommand } = setup();
    await handleCommand('/goal', 'pause');
    expect(activateGoal).toHaveBeenCalledWith('s1', { objective: 'pause' });
    expect(pauseGoal).not.toHaveBeenCalled();
  });
});

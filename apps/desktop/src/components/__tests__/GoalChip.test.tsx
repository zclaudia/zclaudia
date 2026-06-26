import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GoalChip } from '../GoalChip';
import type { Goal } from '@zclaudia/shared';

const baseGoal: Goal = {
  id: 'g1',
  sessionId: 's1',
  objective: 'all tests pass',
  status: 'active',
  tokenBudget: 100000,
  tokensUsed: 12345,
  maxTurns: 50,
  turnsUsed: 7,
  startedAt: Date.now(),
  endedAt: null,
  endReason: null,
  lastVerdictReason: null,
};

describe('GoalChip', () => {
  it('shows Set goal when no goal is active', () => {
    render(<GoalChip goal={null} onOpen={() => {}} onPauseResume={() => {}} />);
    expect(screen.getByText(/set goal/i)).toBeInTheDocument();
  });

  it('shows truncated objective and turn progress when active', () => {
    render(<GoalChip goal={baseGoal} onOpen={() => {}} onPauseResume={() => {}} />);
    expect(screen.getByText(/all tests pass/i)).toBeInTheDocument();
    expect(screen.getByText(/7\s*\/\s*50/)).toBeInTheDocument();
  });

  it('shows Goal completed badge when status is completed', () => {
    render(
      <GoalChip
        goal={{ ...baseGoal, status: 'completed', endReason: 'tests green' }}
        onOpen={() => {}}
        onPauseResume={() => {}}
      />,
    );
    expect(screen.getByText(/goal completed/i)).toBeInTheDocument();
  });

  it('shows Budget reached badge when budget-limited', () => {
    render(
      <GoalChip
        goal={{ ...baseGoal, status: 'budget-limited', endReason: 'tokens' }}
        onOpen={() => {}}
        onPauseResume={() => {}}
      />,
    );
    expect(screen.getByText(/budget reached/i)).toBeInTheDocument();
  });
});

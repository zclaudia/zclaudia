import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Goal } from '@zclaudia/shared';
import { GoalPinnedBar } from '../GoalPinnedBar';

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    sessionId: 's1',
    objective: 'migrate to /goal',
    status: 'active',
    tokenBudget: 5_000_000,
    tokensUsed: 0,
    maxTurns: 50,
    turnsUsed: 0,
    startedAt: 1,
    endedAt: null,
    endReason: null,
    lastVerdictReason: null,
    ...over,
  };
}

const noop = () => {};

describe('GoalPinnedBar', () => {
  it('renders nothing when there is no goal', () => {
    const { container } = render(
      <GoalPinnedBar
        goal={null}
        tokensUsed={0}
        turnsUsed={0}
        onOpen={noop}
        onPauseResume={noop}
        onClear={noop}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows objective, meters, pause and clear when active', () => {
    render(
      <GoalPinnedBar
        goal={makeGoal()}
        tokensUsed={1_200_000}
        turnsUsed={12}
        onOpen={noop}
        onPauseResume={noop}
        onClear={noop}
      />
    );
    expect(screen.getByText('migrate to /goal')).toBeInTheDocument();
    expect(screen.getByText('12 / 50')).toBeInTheDocument();
    expect(screen.getByText('1.2M / 5.0M')).toBeInTheDocument();
    expect(screen.getByLabelText('Pause goal')).toBeInTheDocument();
    expect(screen.getByLabelText('Clear goal')).toBeInTheDocument();
  });

  it('shows a resume button when paused', () => {
    render(
      <GoalPinnedBar
        goal={makeGoal({ status: 'paused' })}
        tokensUsed={0}
        turnsUsed={0}
        onOpen={noop}
        onPauseResume={noop}
        onClear={noop}
      />
    );
    expect(screen.getByLabelText('Resume goal')).toBeInTheDocument();
  });

  it('shows a dismiss button and no meters in a terminal state', () => {
    render(
      <GoalPinnedBar
        goal={makeGoal({ status: 'budget-limited' })}
        tokensUsed={0}
        turnsUsed={50}
        onOpen={noop}
        onPauseResume={noop}
        onClear={noop}
      />
    );
    expect(screen.getByLabelText('Dismiss goal')).toBeInTheDocument();
    expect(screen.queryByLabelText('Pause goal')).not.toBeInTheDocument();
  });

  it('opens the dialog when the objective is clicked', () => {
    const onOpen = vi.fn();
    render(
      <GoalPinnedBar
        goal={makeGoal()}
        tokensUsed={0}
        turnsUsed={0}
        onOpen={onOpen}
        onPauseResume={noop}
        onClear={noop}
      />
    );
    fireEvent.click(screen.getByText('migrate to /goal'));
    expect(onOpen).toHaveBeenCalled();
  });
});

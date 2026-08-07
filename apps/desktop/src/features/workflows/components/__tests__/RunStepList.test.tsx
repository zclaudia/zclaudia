// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { WorkflowDefinition, WorkflowStepRun } from '@zclaudia/shared';
import { RunStepList } from '../RunStepList';

function stepRun(over: Partial<WorkflowStepRun> = {}): WorkflowStepRun {
  return {
    id: 'sr-1',
    runId: 'r-1',
    stepId: 'run_tests',
    stepType: 'shell',
    status: 'completed',
    attempt: 1,
    startedAt: 1_000,
    completedAt: 3_000,
    ...over,
  } as WorkflowStepRun;
}

const definition = {
  entryNodeId: 'run_tests',
  nodes: [
    { id: 'run_tests', name: 'Run Tests', type: 'shell', config: {}, position: { x: 0, y: 0 } },
  ],
  edges: [],
} as unknown as WorkflowDefinition;

describe('RunStepList', () => {
  it('names a step from the definition instead of showing its raw id', () => {
    render(<RunStepList stepRuns={[stepRun()]} definition={definition} />);
    expect(screen.getByText('Run Tests')).toBeInTheDocument();
    expect(screen.queryByText('run_tests')).toBeNull();
  });

  it('falls back to the id for a step the workflow no longer defines', () => {
    // Runs outlive edits, so a recorded step may have no definition entry left.
    render(<RunStepList stepRuns={[stepRun({ stepId: 'removed_step' })]} definition={definition} />);
    expect(screen.getByText('removed_step')).toBeInTheDocument();
  });

  it('keeps the order the steps actually ran in', () => {
    render(
      <RunStepList
        stepRuns={[
          stepRun({ id: 'a', stepId: 'second' }),
          stepRun({ id: 'b', stepId: 'first' }),
        ]}
      />
    );
    const names = screen.getAllByRole('button').map(b => b.textContent);
    expect(names[0]).toContain('second');
    expect(names[1]).toContain('first');
  });

  it('offers approve and reject only while a step is waiting', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const { rerender } = render(
      <RunStepList stepRuns={[stepRun()]} onApprove={onApprove} onReject={onReject} />
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();

    rerender(
      <RunStepList
        stepRuns={[stepRun({ status: 'waiting' })]}
        onApprove={onApprove}
        onReject={onReject}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith('sr-1');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith('sr-1');
  });

  it('disables the pair while a decision is in flight', () => {
    render(
      <RunStepList
        stepRuns={[stepRun({ status: 'waiting' })]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        busyStepRunId="sr-1"
      />
    );
    expect(screen.getByRole('button', { name: /Approve/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });

  it('shows the failure and output once a step is expanded', () => {
    render(
      <RunStepList
        stepRuns={[stepRun({ status: 'failed', error: 'exit code 1', output: { stdout: 'nope' } })]}
        definition={definition}
      />
    );
    expect(screen.queryByText('exit code 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Run Tests/ }));
    expect(screen.getByText('exit code 1')).toBeInTheDocument();
    expect(screen.getByText(/nope/)).toBeInTheDocument();
  });

  it('says so when a run recorded no steps', () => {
    render(<RunStepList stepRuns={[]} />);
    expect(screen.getByText(/No steps recorded/i)).toBeInTheDocument();
  });
});

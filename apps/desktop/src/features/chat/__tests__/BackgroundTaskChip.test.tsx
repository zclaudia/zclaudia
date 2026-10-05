import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BackgroundTaskChip } from '../BackgroundTaskChip';
import {
  useBackgroundTaskStore,
  type BackgroundTask,
} from '../../../stores/backgroundTaskStore';
import { useTaskCenterUiStore } from '../../task-center/taskCenterUiStore';

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 'task-1',
    sessionId: 's1',
    toolUseId: 'tool-1',
    description: 'Explore the codebase',
    kind: 'subagent',
    agentType: 'explore',
    status: 'in_progress',
    startedAt: 1000,
    ...overrides,
  };
}

describe('BackgroundTaskChip', () => {
  beforeEach(() => {
    useBackgroundTaskStore.setState({ tasks: {} });
    useTaskCenterUiStore.setState({ popoverOpen: false });
  });

  it('renders nothing when no background task matches the tool call', () => {
    const { container } = render(<BackgroundTaskChip sessionId="s1" toolUseId="tool-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for tasks of another session or tool call', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        a: makeTask({ id: 'a', sessionId: 's2' }),
        b: makeTask({ id: 'b', toolUseId: 'tool-2' }),
      },
    });
    const { container } = render(<BackgroundTaskChip sessionId="s1" toolUseId="tool-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without a selected session', () => {
    useBackgroundTaskStore.setState({ tasks: { a: makeTask() } });
    const { container } = render(<BackgroundTaskChip sessionId={null} toolUseId="tool-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the running status with the live activity line', () => {
    useBackgroundTaskStore.setState({
      tasks: { a: makeTask({ activity: 'Reading src/index.ts' }) },
    });
    render(<BackgroundTaskChip sessionId="s1" toolUseId="tool-1" />);
    expect(screen.getByTestId('background-task-chip')).toHaveTextContent(
      'Running in background · Reading src/index.ts'
    );
  });

  it('shows the terminal status without an activity line', () => {
    useBackgroundTaskStore.setState({
      tasks: { a: makeTask({ status: 'completed', completedAt: 2000, activity: 'stale' }) },
    });
    render(<BackgroundTaskChip sessionId="s1" toolUseId="tool-1" />);
    const chip = screen.getByTestId('background-task-chip');
    expect(chip).toHaveTextContent('Background task completed');
    expect(chip).not.toHaveTextContent('stale');
  });

  it('picks the most recent task when several share a tool_use_id', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        old: makeTask({ id: 'old', status: 'stopped', startedAt: 1000 }),
        fresh: makeTask({ id: 'fresh', status: 'in_progress', startedAt: 2000 }),
      },
    });
    render(<BackgroundTaskChip sessionId="s1" toolUseId="tool-1" />);
    expect(screen.getByTestId('background-task-chip')).toHaveTextContent('Running in background');
  });

  it('opens the task center popover from the chip action', () => {
    useBackgroundTaskStore.setState({ tasks: { a: makeTask() } });
    render(<BackgroundTaskChip sessionId="s1" toolUseId="tool-1" />);
    fireEvent.click(screen.getByText('View in task center'));
    expect(useTaskCenterUiStore.getState().popoverOpen).toBe(true);
  });
});

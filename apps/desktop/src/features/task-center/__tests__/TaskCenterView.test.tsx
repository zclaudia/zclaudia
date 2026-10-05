import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { TaskCenterView, type TaskCenterViewProps } from '../TaskCenterView';
import type { BackgroundTask, GroupedBackgroundTasks } from '../../../stores/backgroundTaskStore';

const makeTask = (
  id: string,
  overrides: Partial<BackgroundTask> = {}
): BackgroundTask => ({
  id,
  sessionId: 'sess-1',
  description: `Task ${id}`,
  status: 'in_progress',
  startedAt: Date.now(),
  ...overrides,
});

const makeGroups = (overrides: Partial<GroupedBackgroundTasks> = {}): GroupedBackgroundTasks => ({
  running: [],
  paused: [],
  terminal: [],
  ...overrides,
});

const makeProps = (overrides: Partial<TaskCenterViewProps> = {}): TaskCenterViewProps => ({
  groups: makeGroups(),
  hasTerminalTasks: false,
  onStop: vi.fn(),
  onDismiss: vi.fn(),
  onClearFinished: vi.fn(),
  ...overrides,
});

describe('TaskCenterView', () => {
  it('renders groups in running → paused → finished order', () => {
    const props = makeProps({
      groups: makeGroups({
        running: [makeTask('r1')],
        paused: [makeTask('p1', { status: 'paused' })],
        terminal: [makeTask('f1', { status: 'completed' })],
      }),
      hasTerminalTasks: true,
    });
    const { container } = render(<TaskCenterView {...props} />);
    const text = container.textContent ?? '';

    expect(text.indexOf('Running · 1')).toBeLessThan(text.indexOf('Paused · 1'));
    expect(text.indexOf('Paused · 1')).toBeLessThan(text.indexOf('Finished · 1'));
  });

  it('disables Clear finished when there are no terminal tasks', () => {
    const { getByText } = render(<TaskCenterView {...makeProps()} />);
    expect(getByText('Clear finished')).toHaveProperty('disabled', true);
  });

  it('calls onClearFinished from the header action', () => {
    const props = makeProps({
      groups: makeGroups({ terminal: [makeTask('f1', { status: 'completed' })] }),
      hasTerminalTasks: true,
    });
    const { getByText } = render(<TaskCenterView {...props} />);
    fireEvent.click(getByText('Clear finished'));
    expect(props.onClearFinished).toHaveBeenCalledOnce();
  });

  it('offers Stop only for stoppable running tasks', () => {
    const props = makeProps({
      groups: makeGroups({
        running: [
          makeTask('sdk', { stoppable: true }),
          makeTask('bg', { stoppable: false }),
        ],
      }),
    });
    const { getAllByText } = render(<TaskCenterView {...props} />);
    expect(getAllByText('Stop')).toHaveLength(1);
  });

  it('calls onStop with the task when Stop is clicked', () => {
    const task = makeTask('sdk', { stoppable: true });
    const props = makeProps({ groups: makeGroups({ running: [task] }) });
    const { getByText } = render(<TaskCenterView {...props} />);
    fireEvent.click(getByText('Stop'));
    expect(props.onStop).toHaveBeenCalledWith(task);
  });

  it('calls onDismiss for terminal tasks', () => {
    const task = makeTask('f1', { status: 'completed' });
    const props = makeProps({
      groups: makeGroups({ terminal: [task] }),
      hasTerminalTasks: true,
    });
    const { getByText } = render(<TaskCenterView {...props} />);
    fireEvent.click(getByText('Dismiss'));
    expect(props.onDismiss).toHaveBeenCalledWith('f1');
  });

  it('tags tasks that belong to another session', () => {
    const task = makeTask('x1', { sessionId: 'sess-2' });
    const props = makeProps({
      groups: makeGroups({ running: [task] }),
      currentSessionId: 'sess-1',
      resolveSessionLabel: (id: string) => (id === 'sess-2' ? 'deploy-pipeline' : undefined),
    });
    const { getByText } = render(<TaskCenterView {...props} />);
    expect(getByText('deploy-pipeline')).toBeTruthy();
  });

  it('offers Open only on cross-session rows and calls onLocate with the task', () => {
    const own = makeTask('own', { sessionId: 'sess-1' });
    const other = makeTask('other', { sessionId: 'sess-2' });
    const props = makeProps({
      groups: makeGroups({ running: [own, other] }),
      currentSessionId: 'sess-1',
      onLocate: vi.fn(),
    });
    const { getAllByText, queryAllByText } = render(<TaskCenterView {...props} />);

    // Only the cross-session row gets the Open action
    expect(queryAllByText('Open')).toHaveLength(1);
    fireEvent.click(getAllByText('Open')[0]);
    expect(props.onLocate).toHaveBeenCalledWith(other);
  });

  it('omits Open when no onLocate is provided', () => {
    const other = makeTask('other', { sessionId: 'sess-2' });
    const props = makeProps({
      groups: makeGroups({ running: [other] }),
      currentSessionId: 'sess-1',
    });
    const { queryByText } = render(<TaskCenterView {...props} />);
    expect(queryByText('Open')).toBeNull();
  });

  it('expands the detail area when a row with detail is clicked', () => {
    const task = makeTask('r1', { taskCommand: 'pnpm test' });
    const props = makeProps({ groups: makeGroups({ running: [task] }) });
    const { getByText, queryByText } = render(<TaskCenterView {...props} />);

    expect(queryByText('$ pnpm test')).toBeNull();
    fireEvent.click(getByText('Task r1'));
    expect(getByText('$ pnpm test')).toBeTruthy();
  });
});

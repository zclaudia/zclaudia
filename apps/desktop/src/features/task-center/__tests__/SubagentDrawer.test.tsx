import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, render, screen } from '@testing-library/react';
import { useSubagentDetail } from '../useSubagentDetail';
import { TaskDrawerHost } from '../TaskDrawerHost';
import { useRunStore } from '../../../stores/runStore';
import { useBackgroundTaskStore, type BackgroundTask } from '../../../stores/backgroundTaskStore';
import { useTaskCenterUiStore } from '../taskCenterUiStore';
import type { ToolCallState } from '../../../stores/runStore';

vi.mock('../../../hooks/useConnection', () => ({
  useConnection: () => ({ sendMessage: vi.fn(), sendToServer: vi.fn() }),
}));

function taskCall(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    id: 'tool-1',
    toolName: 'Task',
    toolInput: { description: 'Survey auth', subagent_type: 'explore', prompt: 'Map it all' },
    status: 'running',
    ...overrides,
  };
}

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 'task-1',
    sessionId: 's1',
    toolUseId: 'tool-1',
    description: 'Survey auth',
    kind: 'subagent',
    agentType: 'explore',
    status: 'in_progress',
    startedAt: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  useRunStore.setState({ activeToolCalls: {}, toolCallsHistory: {} });
  useBackgroundTaskStore.setState({ tasks: {} });
  useTaskCenterUiStore.setState({ popoverOpen: false, drawerTaskId: null });
});

describe('useSubagentDetail', () => {
  it('resolves the prompt from the active run tool calls', () => {
    useRunStore.setState({ activeToolCalls: { 'run-1': { 'tool-1': taskCall() } } });
    const { result } = renderHook(() => useSubagentDetail(makeTask()));
    expect(result.current).toEqual({ prompt: 'Map it all', resultText: undefined });
  });

  it('resolves result text from history once the Task call settles', () => {
    useRunStore.setState({
      toolCallsHistory: {
        'run-1': [taskCall({ status: 'completed', result: 'Final report' })],
      },
    });
    const { result } = renderHook(() => useSubagentDetail(makeTask()));
    expect(result.current?.resultText).toBe('Final report');
  });

  it('joins content-block results into one text', () => {
    useRunStore.setState({
      toolCallsHistory: {
        'run-1': [
          taskCall({
            status: 'completed',
            result: { content: [{ type: 'text', text: 'Part A. ' }, { type: 'text', text: 'Part B.' }] },
          }),
        ],
      },
    });
    const { result } = renderHook(() => useSubagentDetail(makeTask()));
    expect(result.current?.resultText).toBe('Part A. Part B.');
  });

  it('scans every run, not just the current one', () => {
    useRunStore.setState({
      activeToolCalls: { 'run-a': {}, 'run-b': { 'tool-1': taskCall() } },
    });
    const { result } = renderHook(() => useSubagentDetail(makeTask()));
    expect(result.current?.prompt).toBe('Map it all');
  });

  it('returns null without a toolUseId, a match, or a Task call', () => {
    useRunStore.setState({
      activeToolCalls: {
        'run-1': { 'tool-9': { ...taskCall({ id: 'tool-9', toolName: 'Bash' }) } },
      },
    });
    expect(renderHook(() => useSubagentDetail(makeTask({ toolUseId: undefined }))).result.current).toBeNull();
    expect(renderHook(() => useSubagentDetail(makeTask({ toolUseId: 'tool-missing' }))).result.current).toBeNull();
    expect(renderHook(() => useSubagentDetail(makeTask({ toolUseId: 'tool-9' }))).result.current).toBeNull();
  });

  it('returns null when the task itself is null', () => {
    expect(renderHook(() => useSubagentDetail(null)).result.current).toBeNull();
  });
});

describe('TaskDrawerHost', () => {
  it('renders nothing while no drawer is open', () => {
    const { container } = render(<TaskDrawerHost />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the drawer for the ui store’s drawerTaskId', () => {
    useBackgroundTaskStore.setState({ tasks: { 'task-1': makeTask() } });
    useTaskCenterUiStore.setState({ drawerTaskId: 'task-1' });
    render(<TaskDrawerHost />);
    expect(screen.getByRole('dialog', { name: 'Sub-agent detail' })).toBeInTheDocument();
  });

  it('closes itself when the underlying task disappears', () => {
    useBackgroundTaskStore.setState({ tasks: { 'task-1': makeTask() } });
    useTaskCenterUiStore.setState({ drawerTaskId: 'task-1' });
    render(<TaskDrawerHost />);
    act(() => useBackgroundTaskStore.getState().removeTask('task-1'));
    expect(useTaskCenterUiStore.getState().drawerTaskId).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('taskCenterUiStore drawer state', () => {
  it('openDrawer names the task and closes the popover', () => {
    useTaskCenterUiStore.setState({ popoverOpen: true });
    useTaskCenterUiStore.getState().openDrawer('task-1');
    expect(useTaskCenterUiStore.getState()).toMatchObject({ drawerTaskId: 'task-1', popoverOpen: false });
    useTaskCenterUiStore.getState().closeDrawer();
    expect(useTaskCenterUiStore.getState().drawerTaskId).toBeNull();
  });
});

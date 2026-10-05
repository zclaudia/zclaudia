import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBackgroundTaskStore, type BackgroundTask } from '../../../stores/backgroundTaskStore';
import { useToastStore } from '../../../stores/toastStore';
import { useSelectionStore } from '../../../stores/selectionStore';
import { useTaskCenterUiStore } from '../taskCenterUiStore';
import { useTaskCompletionToasts } from '../useTaskCompletionToasts';

const mockSelectSession = vi.fn();

vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({ selectSession: mockSelectSession }),
}));

const makeTask = (id: string, overrides: Partial<BackgroundTask> = {}): BackgroundTask => ({
  id,
  sessionId: 'sess-1',
  description: `Task ${id}`,
  status: 'in_progress',
  startedAt: Date.now(),
  ...overrides,
});

describe('useTaskCompletionToasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBackgroundTaskStore.setState({ tasks: {} });
    useToastStore.setState({ toasts: [] });
    useSelectionStore.setState({ selectedSessionId: 'sess-1' });
    useTaskCenterUiStore.setState({ popoverOpen: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toasts when a task in another session reaches a terminal state', () => {
    renderHook(() => useTaskCompletionToasts());
    useBackgroundTaskStore.setState({
      tasks: { t1: makeTask('t1', { sessionId: 'sess-2' }) },
    });

    useBackgroundTaskStore.getState().updateTask('t1', { status: 'completed', summary: 'Done' });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].title).toBe('Task t1');
    expect(toasts[0].sessionId).toBe('sess-2');
  });

  it('does not toast for the selected session while the window is focused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    renderHook(() => useTaskCompletionToasts());
    useBackgroundTaskStore.setState({ tasks: { t1: makeTask('t1') } });

    useBackgroundTaskStore.getState().updateTask('t1', { status: 'completed' });

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('toasts for the selected session when the window is unfocused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    renderHook(() => useTaskCompletionToasts());
    useBackgroundTaskStore.setState({ tasks: { t1: makeTask('t1') } });

    useBackgroundTaskStore.getState().updateTask('t1', { status: 'failed' });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
  });

  it('toasts a task added directly in a terminal state', () => {
    renderHook(() => useTaskCompletionToasts());
    useBackgroundTaskStore.getState().addTask(makeTask('t1', { sessionId: 'sess-2', status: 'stopped' }));

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('does not re-toast on updates that stay terminal', () => {
    renderHook(() => useTaskCompletionToasts());
    useBackgroundTaskStore.setState({
      tasks: { t1: makeTask('t1', { sessionId: 'sess-2' }) },
    });
    useBackgroundTaskStore.getState().updateTask('t1', { status: 'completed' });
    useBackgroundTaskStore.getState().updateTask('t1', { summary: 'more info' });

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('toast click jumps to the owning session and opens the task center', () => {
    renderHook(() => useTaskCompletionToasts());
    useBackgroundTaskStore.setState({
      tasks: { t1: makeTask('t1', { sessionId: 'sess-2' }) },
    });
    useBackgroundTaskStore.getState().updateTask('t1', { status: 'completed' });

    const toast = useToastStore.getState().toasts[0];
    toast.onClick?.();

    expect(mockSelectSession).toHaveBeenCalledWith('sess-2');
    expect(useTaskCenterUiStore.getState().popoverOpen).toBe(true);
  });

  it('stops toasting after unmount', () => {
    const { unmount } = renderHook(() => useTaskCompletionToasts());
    useBackgroundTaskStore.setState({
      tasks: { t1: makeTask('t1', { sessionId: 'sess-2' }) },
    });
    unmount();

    useBackgroundTaskStore.getState().updateTask('t1', { status: 'completed' });

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

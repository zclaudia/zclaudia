import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProfileAutosave } from './useProfileAutosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(initial: { enabled?: boolean; valid?: boolean; signature?: string; save?: () => Promise<void> } = {}) {
  const save = initial.save ?? vi.fn().mockResolvedValue(undefined);
  const props = {
    enabled: initial.enabled ?? true,
    valid: initial.valid ?? true,
    signature: initial.signature ?? 'v0',
    save,
    debounceMs: 600,
  };
  const view = renderHook(p => useProfileAutosave(p), { initialProps: props });
  return { save, view, props };
}

describe('useProfileAutosave', () => {
  it('starts saved and does not save the unchanged initial signature', async () => {
    const { save, view } = setup();
    expect(view.result.current.status).toBe('saved');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).not.toHaveBeenCalled();
  });

  it('debounces a change and saves once after the delay', async () => {
    const { save, view } = setup();
    view.rerender({ enabled: true, valid: true, signature: 'v1', save, debounceMs: 600 });
    expect(view.result.current.status).toBe('saving');
    await act(async () => { await vi.advanceTimersByTimeAsync(599); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(view.result.current.status).toBe('saved');
  });

  it('coalesces rapid changes into a single save', async () => {
    const { save, view } = setup();
    view.rerender({ enabled: true, valid: true, signature: 'v1', save, debounceMs: 600 });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    view.rerender({ enabled: true, valid: true, signature: 'v2', save, debounceMs: 600 });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('holds as pending while invalid and does not save', async () => {
    const { save, view } = setup();
    view.rerender({ enabled: true, valid: false, signature: 'v1', save, debounceMs: 600 });
    expect(view.result.current.status).toBe('pending');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).not.toHaveBeenCalled();
  });

  it('does not save when disabled (create mode)', async () => {
    const { save, view } = setup({ enabled: false });
    view.rerender({ enabled: false, valid: true, signature: 'v1', save, debounceMs: 600 });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).not.toHaveBeenCalled();
  });

  it('flush() saves immediately without waiting for the debounce', async () => {
    const { save, view } = setup();
    view.rerender({ enabled: true, valid: true, signature: 'v1', save, debounceMs: 600 });
    await act(async () => { view.result.current.flush(); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('goes to failed on error and retry() re-attempts', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const { view } = setup({ save });
    view.rerender({ enabled: true, valid: true, signature: 'v1', save, debounceMs: 600 });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(view.result.current.status).toBe('failed');
    await act(async () => { view.result.current.retry(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(view.result.current.status).toBe('saved');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProfileAutosave } from './useProfileAutosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(
  initial: {
    enabled?: boolean;
    valid?: boolean;
    signature?: string;
    save?: () => Promise<void>;
  } = {}
) {
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('debounces a change and saves once after the delay', async () => {
    const { save, view } = setup();
    view.rerender({ enabled: true, valid: true, signature: 'v1', save, debounceMs: 600 });
    expect(view.result.current.status).toBe('saving');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(view.result.current.status).toBe('saved');
  });

  it('coalesces rapid changes into a single save', async () => {
    const { save, view } = setup();
    view.rerender({ enabled: true, valid: true, signature: 'v1', save, debounceMs: 600 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    view.rerender({ enabled: true, valid: true, signature: 'v2', save, debounceMs: 600 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('holds as pending while invalid and does not save', async () => {
    const { save, view } = setup();
    view.rerender({ enabled: true, valid: false, signature: 'v1', save, debounceMs: 600 });
    expect(view.result.current.status).toBe('pending');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('does not save when disabled (create mode)', async () => {
    const { save, view } = setup({ enabled: false });
    view.rerender({ enabled: false, valid: true, signature: 'v1', save, debounceMs: 600 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('does not autosave when enabling after hydration; adopts the loaded signature as baseline', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    // Mount disabled with the pre-hydration (empty) signature — mirrors the editor's first render.
    const view = renderHook(p => useProfileAutosave(p), {
      initialProps: { enabled: false, valid: true, signature: 'empty', save, debounceMs: 600 },
    });
    // Hydration: the form populates from the loaded record AND autosave enables in one commit.
    view.rerender({ enabled: true, valid: true, signature: 'loaded', save, debounceMs: 600 });
    expect(view.result.current.status).toBe('saved');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).not.toHaveBeenCalled();
    // A subsequent real edit still autosaves.
    view.rerender({ enabled: true, valid: true, signature: 'edited', save, debounceMs: 600 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush() saves immediately without waiting for the debounce', async () => {
    const { save, view } = setup();
    view.rerender({ enabled: true, valid: true, signature: 'v1', save, debounceMs: 600 });
    await act(async () => {
      view.result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('goes to failed on error and retry() re-attempts', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const { view } = setup({ save });
    view.rerender({ enabled: true, valid: true, signature: 'v1', save, debounceMs: 600 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(view.result.current.status).toBe('failed');
    await act(async () => {
      view.result.current.retry();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(view.result.current.status).toBe('saved');
  });

  it('retry() does not save while invalid', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('x'));
    const { view } = setup({ save });
    view.rerender({ enabled: true, valid: true, signature: 'v1', save, debounceMs: 600 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(view.result.current.status).toBe('failed');
    view.rerender({ enabled: true, valid: false, signature: 'v1', save, debounceMs: 600 });
    await act(async () => {
      view.result.current.retry();
    });
    expect(save).toHaveBeenCalledTimes(1); // not re-attempted while invalid
  });

  it('does not restart the debounce when only the save identity changes', async () => {
    const save1 = vi.fn().mockResolvedValue(undefined);
    const { view } = setup({ save: save1 });
    view.rerender({ enabled: true, valid: true, signature: 'v1', save: save1, debounceMs: 600 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const save2 = vi.fn().mockResolvedValue(undefined); // new closure, SAME signature
    view.rerender({ enabled: true, valid: true, signature: 'v1', save: save2, debounceMs: 600 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    }); // 600 total since the v1 change
    expect(save2).toHaveBeenCalledTimes(1); // fired, not starved
  });

  it('persists a change that arrives during an in-flight save', async () => {
    let resolveFirst!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>(r => {
            resolveFirst = r;
          })
      )
      .mockResolvedValueOnce(undefined);
    const { view } = setup({ save });
    view.rerender({ enabled: true, valid: true, signature: 'v1', save, debounceMs: 600 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledTimes(1); // first save in flight
    view.rerender({ enabled: true, valid: true, signature: 'v2', save, debounceMs: 600 }); // change during save
    await act(async () => {
      resolveFirst();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(save).toHaveBeenCalledTimes(2); // trailing save for v2
    expect(view.result.current.status).toBe('saved');
  });

  it('uses the default debounce (600ms) when debounceMs is omitted', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(p => useProfileAutosave(p), {
      initialProps: { enabled: true, valid: true, signature: 'v0', save },
    });
    view.rerender({ enabled: true, valid: true, signature: 'v1', save });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});

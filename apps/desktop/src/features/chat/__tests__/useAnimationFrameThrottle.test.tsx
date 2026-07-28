import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnimationFrameThrottle } from '../../../hooks/useAnimationFrameThrottle';
import { StrictModeTestWrapper } from '../../../test/StrictModeTestWrapper';

// Controllable requestAnimationFrame: queued callbacks only run when
// flushFrames() is called, and a cancelled frame's callback never runs —
// mirroring the browser. This lets us drive the throttle deterministically.
const frames = new Map<number, FrameRequestCallback>();
let nextId = 0;

function flushFrames(): void {
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, cb] of pending) cb(0);
}

beforeEach(() => {
  frames.clear();
  nextId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++nextId;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAnimationFrameThrottle', () => {
  // Regression: under React StrictMode the mount effects run mount → cleanup →
  // mount. The cleanup cancels the pending frame; if the frame handle isn't
  // reset the scheduling guard stays poisoned by a cancelled handle and
  // `throttled` freezes at its initial value forever (this was the blank-body
  // bug for assistant messages that first mounted mid-`<think>`).
  it('converges to the latest value across updates under StrictMode', () => {
    const { result, rerender } = renderHook(({ value }) => useAnimationFrameThrottle(value), {
      initialProps: { value: 'a' },
      wrapper: StrictModeTestWrapper,
    });

    act(() => flushFrames());

    rerender({ value: 'ab' });
    act(() => flushFrames());

    rerender({ value: 'abc' });
    act(() => flushFrames());

    expect(result.current).toBe('abc');
  });

  it('coalesces multiple updates within a frame to the latest value', () => {
    const { result, rerender } = renderHook(({ value }) => useAnimationFrameThrottle(value), {
      initialProps: { value: 0 },
    });

    // Several updates before the frame fires collapse into one commit.
    rerender({ value: 1 });
    rerender({ value: 2 });
    rerender({ value: 3 });
    act(() => flushFrames());

    expect(result.current).toBe(3);
  });
});

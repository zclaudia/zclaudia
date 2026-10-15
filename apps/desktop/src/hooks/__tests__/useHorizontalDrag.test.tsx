// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  isExcludedHorizontalDragStart,
  useHorizontalDrag,
  type UseHorizontalDragOptions,
} from '../useHorizontalDrag';

class MockTouch implements Touch {
  identifier: number;
  target: EventTarget;
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
  screenX: number;
  screenY: number;
  radiusX = 0;
  radiusY = 0;
  rotationAngle = 0;
  force = 0;

  constructor(target: EventTarget, clientX: number, clientY: number, identifier = 1) {
    this.identifier = identifier;
    this.target = target;
    this.clientX = clientX;
    this.clientY = clientY;
    this.pageX = clientX;
    this.pageY = clientY;
    this.screenX = clientX;
    this.screenY = clientY;
  }
}

beforeAll(() => {
  if (typeof globalThis.Touch === 'undefined') vi.stubGlobal('Touch', MockTouch);
});

afterEach(() => {
  vi.useRealTimers();
});

function Harness({ options }: { options: UseHorizontalDragOptions }) {
  const ref = useHorizontalDrag<HTMLDivElement>(options);
  return (
    <div ref={ref} data-testid="surface">
      <button data-testid="button">Control</button>
      <input data-testid="input" />
      <div data-testid="content">Content</div>
      <div data-testid="scroller" style={{ overflowX: 'auto' }}>
        <div data-testid="scroller-content">Wide</div>
      </div>
    </div>
  );
}

function dispatchTouch(
  target: Element,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  x: number,
  y: number
) {
  const touch = new MockTouch(target, x, y);
  const isEnd = type === 'touchend' || type === 'touchcancel';
  const event = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: isEnd ? [] : [touch],
    changedTouches: [touch],
  });
  // The hook reads the input timestamp; tie it to the (possibly faked) clock.
  Object.defineProperty(event, 'timeStamp', { value: Date.now() });
  act(() => target.dispatchEvent(event));
  return event;
}

function setup(overrides: Partial<UseHorizontalDragOptions> = {}) {
  const callbacks = {
    onDragStart: vi.fn(),
    onDrag: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
  };
  const options: UseHorizontalDragOptions = {
    enabled: true,
    direction: 'right',
    maxDistance: 100,
    completionThreshold: 0.32,
    velocityThreshold: 0.45,
    ...callbacks,
    ...overrides,
  };
  const view = render(<Harness options={options} />);
  return {
    ...view,
    ...callbacks,
    surface: view.getByTestId('surface'),
    content: view.getByTestId('content'),
  };
}

describe('useHorizontalDrag', () => {
  it('completes a right drag to open after crossing the distance threshold', () => {
    const { content, onEnd } = setup();
    dispatchTouch(content, 'touchstart', 40, 100);
    dispatchTouch(content, 'touchmove', 83, 102);
    dispatchTouch(content, 'touchend', 83, 102);
    dispatchTouch(content, 'touchend', 83, 102);

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0][0]).toMatchObject({ distance: 35, shouldComplete: true });
  });

  it('completes a left drag to close', () => {
    const { content, onEnd } = setup({ direction: 'left' });
    dispatchTouch(content, 'touchstart', 90, 100);
    dispatchTouch(content, 'touchmove', 42, 101);
    dispatchTouch(content, 'touchend', 42, 101);

    expect(onEnd.mock.calls[0][0]).toMatchObject({ distance: 40, shouldComplete: true });
  });

  it('reports every drag position continuously, measured from the end of the slop', () => {
    const { content, onDrag } = setup();
    dispatchTouch(content, 'touchstart', 20, 50);
    dispatchTouch(content, 'touchmove', 32, 50);
    dispatchTouch(content, 'touchmove', 50, 51);
    dispatchTouch(content, 'touchmove', 80, 52);

    // The 8px activation travel isn't replayed as a jump when the drag claims.
    expect(onDrag.mock.calls.map(([update]) => update.distance)).toEqual([4, 22, 52]);
    expect(onDrag.mock.calls.map(([update]) => update.progress)).toEqual([0.04, 0.22, 0.52]);
  });

  it('leaves a vertical scroll unclaimed', () => {
    const { content, onDragStart, onDrag, onEnd } = setup();
    dispatchTouch(content, 'touchstart', 50, 50);
    const move = dispatchTouch(content, 'touchmove', 56, 75);
    dispatchTouch(content, 'touchend', 90, 75);

    expect(move.defaultPrevented).toBe(false);
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDrag).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('does not claim movement in the opposite direction', () => {
    const { content, onDrag, onEnd } = setup({ direction: 'right' });
    dispatchTouch(content, 'touchstart', 50, 50);
    dispatchTouch(content, 'touchmove', 25, 50);
    dispatchTouch(content, 'touchend', 10, 50);

    expect(onDrag).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('cancels an active drag exactly once so the consumer can rebound', () => {
    const { content, onDrag, onEnd, onCancel } = setup();
    dispatchTouch(content, 'touchstart', 10, 50);
    dispatchTouch(content, 'touchmove', 35, 50);
    dispatchTouch(content, 'touchcancel', 35, 50);
    dispatchTouch(content, 'touchend', 35, 50);

    expect(onDrag).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('uses both distance and recent release velocity to decide completion', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const slow = setup();
    dispatchTouch(slow.content, 'touchstart', 10, 50);
    vi.setSystemTime(200);
    dispatchTouch(slow.content, 'touchmove', 22, 50);
    vi.setSystemTime(1000);
    dispatchTouch(slow.content, 'touchend', 30, 50);
    expect(slow.onEnd.mock.calls[0][0].shouldComplete).toBe(false);
    slow.unmount();

    vi.setSystemTime(0);
    const fast = setup();
    dispatchTouch(fast.content, 'touchstart', 10, 50);
    vi.setSystemTime(10);
    dispatchTouch(fast.content, 'touchmove', 22, 50);
    vi.setSystemTime(20);
    dispatchTouch(fast.content, 'touchend', 30, 50);
    expect(fast.onEnd.mock.calls[0][0].distance).toBe(12);
    expect(fast.onEnd.mock.calls[0][0].velocity).toBeGreaterThanOrEqual(0.45);
    expect(fast.onEnd.mock.calls[0][0].shouldComplete).toBe(true);
  });

  it('measures a decelerating flick by its push, not its slow tail', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { content, onEnd } = setup({ maxDistance: 300 });
    dispatchTouch(content, 'touchstart', 10, 50);
    vi.setSystemTime(1016);
    dispatchTouch(content, 'touchmove', 30, 50);
    vi.setSystemTime(1032);
    dispatchTouch(content, 'touchmove', 46, 50);
    vi.setSystemTime(1048);
    dispatchTouch(content, 'touchmove', 52, 50);
    vi.setSystemTime(1064);
    dispatchTouch(content, 'touchmove', 54, 50);
    vi.setSystemTime(1070);
    dispatchTouch(content, 'touchend', 54, 50);

    // The final segment alone is 2px/16ms ≈ 0.13; the push averages ~0.69.
    const { velocity, shouldComplete } = onEnd.mock.calls[0][0];
    expect(velocity).toBeCloseTo(44 / 64, 5);
    expect(shouldComplete).toBe(true);
  });

  it('releases with no velocity when the finger stopped before lifting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { content, onEnd } = setup({ maxDistance: 300 });
    dispatchTouch(content, 'touchstart', 10, 50);
    vi.setSystemTime(1016);
    dispatchTouch(content, 'touchmove', 40, 50);
    vi.setSystemTime(1032);
    dispatchTouch(content, 'touchmove', 70, 50);
    vi.setSystemTime(1200);
    dispatchTouch(content, 'touchend', 70, 50);

    expect(onEnd.mock.calls[0][0].velocity).toBe(0);
  });

  it('reports signed distance in both directions when direction is "both"', () => {
    const { content, onDrag, onEnd } = setup({ direction: 'both' });
    dispatchTouch(content, 'touchstart', 50, 50);
    dispatchTouch(content, 'touchmove', 80, 50);
    dispatchTouch(content, 'touchmove', 20, 50);
    dispatchTouch(content, 'touchend', 20, 50);

    // Claimed rightward, so the origin sits 8px right of the touch-down point.
    expect(onDrag.mock.calls.map(([update]) => update.distance)).toEqual([22, -38]);
    expect(onEnd.mock.calls[0][0]).toMatchObject({ distance: -38, progress: -0.38 });
  });

  it('claims a leftward start in "both" that a right-only drag would ignore', () => {
    const { content, onDragStart, onEnd } = setup({ direction: 'both' });
    dispatchTouch(content, 'touchstart', 50, 50);
    dispatchTouch(content, 'touchmove', 25, 50);
    dispatchTouch(content, 'touchend', 10, 50);

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0][0]).toMatchObject({ distance: -32, shouldComplete: true });
  });

  it('clamps both directions to maxDistance', () => {
    const { content, onEnd } = setup({ direction: 'both', maxDistance: 50 });
    dispatchTouch(content, 'touchstart', 200, 50);
    dispatchTouch(content, 'touchmove', 100, 50);
    dispatchTouch(content, 'touchend', 100, 50);

    expect(onEnd.mock.calls[0][0]).toMatchObject({ distance: -50, progress: -1 });
  });

  it('keeps a reverse flick from completing a single-direction drag', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { content, onEnd } = setup({ direction: 'right', maxDistance: 200 });
    dispatchTouch(content, 'touchstart', 100, 50);
    vi.setSystemTime(10);
    dispatchTouch(content, 'touchmove', 120, 50);
    vi.setSystemTime(20);
    dispatchTouch(content, 'touchend', 100, 50);

    expect(onEnd.mock.calls[0][0].velocity).toBeLessThan(0);
    expect(onEnd.mock.calls[0][0].shouldComplete).toBe(false);
  });

  it('can exclude text entry from drags', () => {
    const { getByTestId, onDrag } = setup({
      shouldStart: target => !isExcludedHorizontalDragStart(target),
    });
    const input = getByTestId('input');
    dispatchTouch(input, 'touchstart', 10, 50);
    dispatchTouch(input, 'touchmove', 60, 50);
    dispatchTouch(input, 'touchend', 60, 50);

    expect(onDrag).not.toHaveBeenCalled();
    expect(isExcludedHorizontalDragStart(getByTestId('button'))).toBe(false);
  });

  it('claims a drag that starts on a button and swallows the click it ends in', () => {
    const { getByTestId, onEnd } = setup({
      shouldStart: target => !isExcludedHorizontalDragStart(target),
    });
    const button = getByTestId('button');
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    dispatchTouch(button, 'touchstart', 10, 50);
    dispatchTouch(button, 'touchmove', 60, 50);
    dispatchTouch(button, 'touchend', 60, 50);
    act(() => button.click());

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    // Only the lift's own click; a later tap goes through.
    act(() => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('leaves the motion to a nested scroller that can pan that way', () => {
    const { getByTestId, onDragStart } = setup();
    const scroller = getByTestId('scroller');
    Object.defineProperty(scroller, 'scrollWidth', { value: 400 });
    Object.defineProperty(scroller, 'clientWidth', { value: 100 });
    scroller.scrollLeft = 50;
    const cell = getByTestId('scroller-content');
    dispatchTouch(cell, 'touchstart', 10, 50);
    dispatchTouch(cell, 'touchmove', 60, 50);
    dispatchTouch(cell, 'touchend', 60, 50);
    expect(onDragStart).not.toHaveBeenCalled();

    // Scrolled to its start, the same rightward drag belongs to the surface.
    scroller.scrollLeft = 0;
    dispatchTouch(cell, 'touchstart', 10, 50);
    dispatchTouch(cell, 'touchmove', 60, 50);
    dispatchTouch(cell, 'touchend', 60, 50);
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });
});

import { useCallback, useEffect, useRef, type RefCallback } from 'react';

/**
 * Which way a drag counts. `'both'` recognizes either direction and reports
 * signed values (right positive), for surfaces that can move forward and back
 * from their current state.
 */
export type HorizontalDragDirection = 'left' | 'right' | 'both';

export interface HorizontalDragUpdate {
  /** Directional distance in pixels, clamped to maxDistance. Signed in 'both'. */
  distance: number;
  /** Normalized directional progress from 0 to 1, or -1 to 1 in 'both'. */
  progress: number;
}

export interface HorizontalDragEnd extends HorizontalDragUpdate {
  /** Directional release velocity in px/ms. Signed in 'both'. */
  velocity: number;
  /** True when either the distance or velocity completion rule was met. */
  shouldComplete: boolean;
}

export interface UseHorizontalDragOptions {
  enabled?: boolean;
  direction: HorizontalDragDirection;
  maxDistance: number;
  completionThreshold?: number;
  velocityThreshold?: number;
  activationDistance?: number;
  axisDominanceRatio?: number;
  shouldStart?: (target: EventTarget | null) => boolean;
  onDragStart?: () => void;
  onDrag: (update: HorizontalDragUpdate) => void;
  onEnd: (result: HorizontalDragEnd) => void;
  onCancel: () => void;
}

type GesturePhase = 'idle' | 'pending' | 'dragging';

interface PositionSample {
  x: number;
  time: number;
}

interface GestureState {
  phase: GesturePhase;
  touchId: number | null;
  startX: number;
  startY: number;
  samples: PositionSample[];
}

const INITIAL_STATE: GestureState = {
  phase: 'idle',
  touchId: null,
  startX: 0,
  startY: 0,
  samples: [],
};

/** Release velocity is measured over at most this much recent movement. */
const VELOCITY_WINDOW_MS = 100;
/** A finger held still this long before lifting releases with no velocity. */
const VELOCITY_STOP_MS = 80;
/** Floor for the measured span so two coalesced events can't spike the result. */
const VELOCITY_MIN_SPAN_MS = 8;

const INTERACTIVE_START_SELECTOR =
  'input, textarea, button, a, select, option, [contenteditable]:not([contenteditable="false"]), [role="button"], [data-horizontal-drag-ignore]';

/** True when an opening drag began on a control that should keep the gesture. */
export function isInteractiveHorizontalDragStart(target: EventTarget | null): boolean {
  const closest = (target as Element | null)?.closest;
  return typeof closest === 'function' && closest.call(target, INTERACTIVE_START_SELECTOR) !== null;
}

function touchAt(touches: TouchList, index: number): Touch | null {
  return touches.item?.(index) ?? touches[index] ?? null;
}

function findTouch(touches: TouchList, identifier: number): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touchAt(touches, index);
    if (touch?.identifier === identifier) return touch;
  }
  return null;
}

/** Event time in ms; touch events carry their input timestamp, which tracks the finger more closely than handler time. */
function eventTime(event: Event): number {
  return event.timeStamp > 0 ? event.timeStamp : performance.now();
}

function recordSample(samples: PositionSample[], x: number, time: number) {
  samples.push({ x, time });
  while (samples.length > 2 && time - samples[0].time > VELOCITY_WINDOW_MS) samples.shift();
}

/**
 * Raw (rightward-positive) release velocity in px/ms. A single move segment
 * undercounts a flick because fingers decelerate just before lifting, so this
 * averages the final run of movement in one direction across the recent
 * window — the push the user actually made, not its tail.
 */
function releaseVelocity(samples: PositionSample[], x: number, time: number): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  if (x !== last.x) recordSample(samples, x, time);
  else if (time - last.time > VELOCITY_STOP_MS) return 0;

  const newest = samples[samples.length - 1];
  let oldest = samples.length - 1;
  let runSign = 0;
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    if (newest.time - samples[index].time > VELOCITY_WINDOW_MS) break;
    const stepSign = Math.sign(samples[index + 1].x - samples[index].x);
    if (stepSign !== 0) {
      if (runSign === 0) runSign = stepSign;
      else if (stepSign !== runSign) break;
    }
    oldest = index;
  }

  const span = newest.time - samples[oldest].time;
  if (span <= 0) return 0;
  return (newest.x - samples[oldest].x) / Math.max(span, VELOCITY_MIN_SPAN_MS);
}

function directionalDelta(direction: HorizontalDragDirection, startX: number, x: number): number {
  return direction === 'left' ? startX - x : x - startX;
}

/** Clamp to the travel range, keeping the sign when both directions count. */
function clampDelta(
  direction: HorizontalDragDirection,
  delta: number,
  maxDistance: number
): number {
  if (direction === 'both') {
    return Math.min(maxDistance, Math.max(-maxDistance, delta));
  }
  return Math.min(maxDistance, Math.max(0, delta));
}

/**
 * Recognizes a single-finger horizontal drag without causing React renders on
 * touchmove. Native listeners are used so the claimed horizontal gesture can
 * prevent the WebView's default handling while vertical scrolling stays native.
 */
export function useHorizontalDrag<E extends HTMLElement = HTMLDivElement>(
  options: UseHorizontalDragOptions
): RefCallback<E> {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const cleanupRef = useRef<(() => void) | null>(null);
  const stateRef = useRef<GestureState>({ ...INITIAL_STATE });

  const reset = useCallback((notifyCancel: boolean) => {
    const wasDragging = stateRef.current.phase === 'dragging';
    stateRef.current = { ...INITIAL_STATE };
    if (notifyCancel && wasDragging) optionsRef.current.onCancel();
  }, []);

  const setElement = useCallback<RefCallback<E>>(
    element => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (!element) return;

      const handleTouchStart = (event: TouchEvent) => {
        const current = optionsRef.current;
        if (
          current.enabled === false ||
          event.touches.length !== 1 ||
          stateRef.current.phase !== 'idle'
        ) {
          return;
        }
        if (current.shouldStart && !current.shouldStart(event.target)) return;

        const touch = touchAt(event.touches, 0);
        if (!touch) return;
        stateRef.current = {
          phase: 'pending',
          touchId: touch.identifier,
          startX: touch.clientX,
          startY: touch.clientY,
          samples: [{ x: touch.clientX, time: eventTime(event) }],
        };
      };

      const handleTouchMove = (event: TouchEvent) => {
        const current = optionsRef.current;
        const state = stateRef.current;
        if (state.phase === 'idle') return;
        if (current.enabled === false || event.touches.length !== 1 || state.touchId === null) {
          reset(true);
          return;
        }

        const touch = findTouch(event.touches, state.touchId);
        if (!touch) {
          reset(true);
          return;
        }

        const rawX = touch.clientX - state.startX;
        const rawY = touch.clientY - state.startY;
        const absoluteX = Math.abs(rawX);
        const absoluteY = Math.abs(rawY);
        // Sample before claiming: on a short flick the activation travel is a
        // good share of the whole gesture's speed.
        recordSample(state.samples, touch.clientX, eventTime(event));
        const activationDistance = current.activationDistance ?? 8;
        const axisDominanceRatio = current.axisDominanceRatio ?? 1.2;

        if (state.phase === 'pending') {
          if (Math.max(absoluteX, absoluteY) < activationDistance) return;
          if (absoluteX <= absoluteY * axisDominanceRatio) {
            reset(false);
            return;
          }
          if (
            current.direction !== 'both' &&
            directionalDelta(current.direction, state.startX, touch.clientX) <= 0
          ) {
            reset(false);
            return;
          }
          state.phase = 'dragging';
          current.onDragStart?.();
        }

        const maxDistance = Math.max(1, current.maxDistance);
        const distance = clampDelta(
          current.direction,
          directionalDelta(current.direction, state.startX, touch.clientX),
          maxDistance
        );
        event.preventDefault();
        current.onDrag({ distance, progress: distance / maxDistance });
      };

      const handleTouchEnd = (event: TouchEvent) => {
        const current = optionsRef.current;
        const state = stateRef.current;
        if (state.phase === 'idle' || state.touchId === null) return;

        const touch = findTouch(event.changedTouches, state.touchId);
        if (!touch) return;
        if (state.phase !== 'dragging') {
          reset(false);
          return;
        }

        const maxDistance = Math.max(1, current.maxDistance);
        const distance = clampDelta(
          current.direction,
          directionalDelta(current.direction, state.startX, touch.clientX),
          maxDistance
        );
        const rawVelocity = releaseVelocity(state.samples, touch.clientX, eventTime(event));
        const velocity = current.direction === 'left' ? -rawVelocity : rawVelocity;
        const completionThreshold = current.completionThreshold ?? 0.32;
        const velocityThreshold = current.velocityThreshold ?? 0.45;
        // Single-direction drags only complete when the release pushed the way
        // the drag counts; in 'both' the caller decides what each direction
        // means, so completion just reports that a threshold was cleared.
        const shouldComplete =
          current.direction === 'both'
            ? Math.abs(distance) / maxDistance >= completionThreshold ||
              Math.abs(velocity) >= velocityThreshold
            : distance / maxDistance >= completionThreshold || velocity >= velocityThreshold;

        stateRef.current = { ...INITIAL_STATE };
        current.onEnd({
          distance,
          progress: distance / maxDistance,
          velocity,
          shouldComplete,
        });
      };

      const handleTouchCancel = () => reset(true);

      element.addEventListener('touchstart', handleTouchStart, { passive: true });
      element.addEventListener('touchmove', handleTouchMove, { passive: false });
      element.addEventListener('touchend', handleTouchEnd, { passive: true });
      element.addEventListener('touchcancel', handleTouchCancel, { passive: true });

      cleanupRef.current = () => {
        reset(true);
        element.removeEventListener('touchstart', handleTouchStart);
        element.removeEventListener('touchmove', handleTouchMove);
        element.removeEventListener('touchend', handleTouchEnd);
        element.removeEventListener('touchcancel', handleTouchCancel);
      };
    },
    [reset]
  );

  useEffect(() => {
    if (options.enabled === false) reset(true);
  }, [options.enabled, reset]);

  useEffect(() => () => cleanupRef.current?.(), []);

  return setElement;
}

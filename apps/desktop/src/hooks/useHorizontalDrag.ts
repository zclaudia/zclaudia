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

interface GestureState {
  phase: GesturePhase;
  touchId: number | null;
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  lastVelocity: number;
  lastVelocityTime: number;
}

const INITIAL_STATE: GestureState = {
  phase: 'idle',
  touchId: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastTime: 0,
  lastVelocity: 0,
  lastVelocityTime: 0,
};

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
        const now = Date.now();
        stateRef.current = {
          phase: 'pending',
          touchId: touch.identifier,
          startX: touch.clientX,
          startY: touch.clientY,
          lastX: touch.clientX,
          lastTime: now,
          lastVelocity: 0,
          lastVelocityTime: now,
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

        const now = Date.now();
        const elapsed = now - state.lastTime;
        if (elapsed > 0) {
          state.lastVelocity =
            directionalDelta(current.direction, state.lastX, touch.clientX) / elapsed;
          state.lastVelocityTime = now;
        }
        state.lastX = touch.clientX;
        state.lastTime = now;

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

        const now = Date.now();
        const maxDistance = Math.max(1, current.maxDistance);
        const distance = clampDelta(
          current.direction,
          directionalDelta(current.direction, state.startX, touch.clientX),
          maxDistance
        );
        const elapsed = now - state.lastTime;
        const endSegment = directionalDelta(current.direction, state.lastX, touch.clientX);
        const velocity =
          elapsed > 0 && endSegment !== 0
            ? endSegment / elapsed
            : now - state.lastVelocityTime <= 100
              ? state.lastVelocity
              : 0;
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

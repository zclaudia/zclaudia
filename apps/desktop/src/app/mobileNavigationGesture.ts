export const NAVIGATION_ACTIVATION_PX = 8;
const HORIZONTAL_DOMINANCE = 1.25;
const AMBIGUOUS_LIMIT_PX = 16;
const RELEASE_WINDOW_MS = 80;
const REVERSE_JITTER_PX = 3;

export type NavigationOwner = 'pending' | 'drawer' | 'claudia' | 'native' | 'ignored';
export interface NavigationSample { x: number; time: number }
export interface NavigationRelease {
  /** Signed rightward-positive velocity. Business/controller units are px/s. */
  velocityPxPerSecond: number;
  /** Signed travel in the last stable direction, after activation slop. */
  releaseRunDistancePx: number;
}

const EXCLUDED = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [data-horizontal-drag-ignore], [data-mobile-navigation-ignore], .xterm, .monaco-editor, .cm-editor, [data-terminal], [data-editor], [data-image-zoom]';

function targetElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
}

export function isExcludedNavigationTarget(target: EventTarget | null): boolean {
  return !!targetElement(target)?.closest(EXCLUDED);
}

/** A content scroller that can consume this direction keeps the whole touch. */
export function nestedScrollerCanPan(target: EventTarget | null, boundary: Element, dx: number): boolean {
  let element = targetElement(target);
  while (element && element !== boundary) {
    if (element.scrollWidth > element.clientWidth + 1) {
      const overflow = getComputedStyle(element).overflowX;
      if ((overflow === 'auto' || overflow === 'scroll') &&
        (dx > 0 ? element.scrollLeft > 1 : element.scrollLeft < element.scrollWidth - element.clientWidth - 1)) return true;
    }
    element = element.parentElement;
  }
  return false;
}

export function navigationAxis(dx: number, dy: number): 'horizontal' | 'native' | 'pending' {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (x >= NAVIGATION_ACTIVATION_PX && x > HORIZONTAL_DOMINANCE * y) return 'horizontal';
  if ((y >= NAVIGATION_ACTIVATION_PX && y > HORIZONTAL_DOMINANCE * x) || Math.hypot(x, y) >= AMBIGUOUS_LIMIT_PX) return 'native';
  return 'pending';
}

export function sampleNavigation(samples: NavigationSample[], x: number, time: number): void {
  const last = samples.at(-1);
  // Stationary events must not refresh the last movement time.
  if (!last || last.x !== x) samples.push({ x, time });
  while (samples.length > 2 && time - samples[1].time > RELEASE_WINDOW_MS) samples.shift();
}

/** Last stable movement segment: an intentional reversal wins; tiny jitter does not. */
export function navigationRelease(samples: NavigationSample[], x: number, time: number): NavigationRelease {
  sampleNavigation(samples, x, time);
  const last = samples.at(-1);
  const zero = { velocityPxPerSecond: 0, releaseRunDistancePx: 0 };
  if (!last || time - last.time >= RELEASE_WINDOW_MS || samples.length < 2) return zero;
  const newest = samples.length - 1;
  let oldest = newest;
  let direction = 0;
  for (let index = newest - 1; index >= 0; index -= 1) {
    if (last.time - samples[index].time > RELEASE_WINDOW_MS) break;
    const distance = samples[newest].x - samples[index].x;
    if (!direction) {
      if (Math.abs(distance) < REVERSE_JITTER_PX) continue;
      direction = Math.sign(distance);
      oldest = index;
    } else if (Math.sign(samples[oldest].x - samples[index].x) === -direction) {
      // An insignificant tail reversal is noise; a larger reversal ends the run.
      if (Math.abs(samples[oldest].x - samples[index].x) >= REVERSE_JITTER_PX) break;
    } else {
      oldest = index;
    }
  }
  if (!direction || oldest === newest) return zero;
  const distance = samples[newest].x - samples[oldest].x;
  const span = Math.max(8, samples[newest].time - samples[oldest].time);
  return {
    velocityPxPerSecond: Math.max(-5000, Math.min(5000, distance * 1000 / span)),
    releaseRunDistancePx: distance,
  };
}

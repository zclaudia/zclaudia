/**
 * Mobile drawer detents.
 *
 * The drawer travels along a single scalar `position` measured in pixels of
 * revealed width: 0 is fully closed, `peek` is the standard 300px drawer, and
 * `expandedWidth` is the widened "reading" stage. Positions below `peek` slide
 * the 300px panel in from the left; positions above it grow the panel's width
 * in place. One scalar keeps drag math, snapping, and the CSS variables that
 * paint the panel in agreement.
 *
 * Release carries momentum: the drawer coasts on from where the finger let go
 * (release velocity × `DRAWER_PROJECTION_MS`) and snaps to the detent nearest
 * that projected point, so a short quick swipe still opens. Momentum reaches at
 * most the neighbouring detent, a slow drag that physically crosses two detents
 * lands where the finger left it, and a clear flick always moves one detent in
 * its direction. A hard leftward fling is the one shortcut: it closes the
 * drawer outright instead of parking at `peek`.
 */

export type DrawerStage = 'closed' | 'peek' | 'full';

/**
 * Width of the standard drawer, and the position of the `peek` detent. 256
 * (screen-width-minus-56dp on a 390pt phone would be 334) can't hold a 44px
 * row's dot + name + chevron + a 44px ⋮ button without truncating a name like
 * "Backend on lima-devbox"; 300 is the deliberate trim that still leaves a
 * 90px peek at the live session underneath.
 */
export const DRAWER_PEEK_WIDTH_PX = 300;

/**
 * Upper bound for the expanded stage. Phones expand to the full viewport; on
 * tablets and landscape an uncapped sidebar would be a mostly-empty column.
 */
export const DRAWER_MAX_EXPANDED_WIDTH_PX = 420;

/** Directional intent: at or above this a release always moves one detent. */
export const DRAWER_FLICK_VELOCITY = 0.3;

/** How far release momentum carries the drawer, as ms of travel at release speed. */
export const DRAWER_PROJECTION_MS = 200;

/** A fling this fast to the left dismisses the drawer instead of stepping down. */
export const DRAWER_DISMISS_VELOCITY = 0.9;

/** Expanded width for a viewport, clamped so it never shrinks below `peek`. */
export function drawerExpandedWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return DRAWER_MAX_EXPANDED_WIDTH_PX;
  }
  return Math.max(DRAWER_PEEK_WIDTH_PX, Math.min(viewportWidth, DRAWER_MAX_EXPANDED_WIDTH_PX));
}

/** Whether the viewport is wide enough for the expanded stage to add anything. */
export function drawerHasExpandedStage(expandedWidth: number): boolean {
  return expandedWidth > DRAWER_PEEK_WIDTH_PX;
}

/** Revealed width, in pixels, at rest in a stage. */
export function drawerStagePosition(stage: DrawerStage, expandedWidth: number): number {
  if (stage === 'closed') return 0;
  if (stage === 'peek') return DRAWER_PEEK_WIDTH_PX;
  return expandedWidth;
}

function detents(expandedWidth: number): Array<{ stage: DrawerStage; position: number }> {
  const stages: Array<{ stage: DrawerStage; position: number }> = [
    { stage: 'closed', position: 0 },
    { stage: 'peek', position: DRAWER_PEEK_WIDTH_PX },
  ];
  if (drawerHasExpandedStage(expandedWidth)) {
    stages.push({ stage: 'full', position: expandedWidth });
  }
  return stages;
}

/**
 * Stage to settle into when a drag ends.
 *
 * @param position Revealed width at the moment of release.
 * @param velocity Release velocity in px/ms; positive opens, negative closes.
 * @param expandedWidth Position of the `full` detent for this viewport.
 */
export function resolveDrawerStage(
  position: number,
  velocity: number,
  expandedWidth: number
): DrawerStage {
  const stops = detents(expandedWidth);
  const max = stops[stops.length - 1].position;
  const clamped = Math.min(max, Math.max(0, position));

  if (velocity <= -DRAWER_DISMISS_VELOCITY) return 'closed';

  // `position` can sit exactly on a detent (a flick with no travel), so the
  // neighbour search is strict on both sides.
  const belowStops = stops.filter(stop => stop.position < clamped);
  const below = belowStops.length ? belowStops[belowStops.length - 1] : stops[0];
  const above = stops.find(stop => stop.position > clamped) ?? stops[stops.length - 1];

  // A flick moves one detent the way the finger was going.
  if (velocity <= -DRAWER_FLICK_VELOCITY) return below.stage;
  if (velocity >= DRAWER_FLICK_VELOCITY) return above.stage;

  // Slower releases coast toward a neighbour and settle on the nearest detent.
  const projected = Math.min(
    above.position,
    Math.max(below.position, clamped + velocity * DRAWER_PROJECTION_MS)
  );
  return stops.reduce((nearest, stop) =>
    Math.abs(stop.position - projected) < Math.abs(nearest.position - projected) ? stop : nearest
  ).stage;
}

/** One detent down — what Android back does while the drawer is open. */
export function drawerStageBelow(stage: DrawerStage): DrawerStage {
  return stage === 'full' ? 'peek' : 'closed';
}

export interface DrawerSettleTiming {
  durationMs: number;
  easing: string;
}

/** Settle used when nothing is moving: buttons, back, Escape, a still release. */
export const DRAWER_SETTLE_DURATION_MS = 350;
export const DRAWER_SETTLE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Released settles scale with the distance left: this plus `PER_PX` each pixel. */
const RELEASE_BASE_MS = 180;
const RELEASE_PER_PX_MS = 0.55;
const RELEASE_MIN_MS = 120;
const RELEASE_MAX_MS = 340;
/** First control point x of the release curve; its y sets the starting speed. */
const RELEASE_CURVE_X1 = 0.3;

/**
 * Timing for the settle that follows a release, shaped so the drawer leaves
 * the finger at the speed the finger was moving instead of jumping to a fixed
 * curve's speed. A cubic-bezier's starting slope is y1/x1 (in units of
 * distance/duration), so y1 is picked to match the release velocity; a slow
 * release eases out of rest, a quick one carries straight on. When even the
 * steepest curve without overshoot is slower than the finger, the duration
 * shortens instead.
 *
 * @param distance Pixels between the release point and the target detent.
 * @param velocityTowardTarget Release speed in px/ms; negative or zero when the
 *   finger was moving away from the target or had stopped.
 */
export function drawerReleaseSettle(
  distance: number,
  velocityTowardTarget: number
): DrawerSettleTiming {
  const remaining = Math.abs(distance);
  if (remaining < 1) return { durationMs: 0, easing: DRAWER_SETTLE_EASING };

  const speed = Math.max(0, velocityTowardTarget);
  let durationMs = Math.min(RELEASE_MAX_MS, RELEASE_BASE_MS + remaining * RELEASE_PER_PX_MS);
  const maxSlope = 1 / RELEASE_CURVE_X1;
  let slope = (speed * durationMs) / remaining;
  if (slope > maxSlope) {
    durationMs = Math.max(RELEASE_MIN_MS, (maxSlope * remaining) / speed);
    slope = Math.min(maxSlope, (speed * durationMs) / remaining);
  }
  const y1 = Math.max(0, RELEASE_CURVE_X1 * slope);
  return {
    durationMs: Math.round(durationMs),
    easing: `cubic-bezier(${RELEASE_CURVE_X1}, ${y1.toFixed(3)}, 0.25, 1)`,
  };
}

/**
 * Mobile drawer detents.
 *
 * The drawer travels along a single scalar `position` measured in pixels of
 * revealed width: 0 is fully closed, `peek` is the standard 256px drawer, and
 * `expandedWidth` is the widened "reading" stage. Positions below `peek` slide
 * the 256px panel in from the left; positions above it grow the panel's width
 * in place. One scalar keeps drag math, snapping, and the CSS variables that
 * paint the panel in agreement.
 *
 * Release snaps to the nearest detent so a long drag that physically crosses
 * two detents lands where the finger left it, while a flick moves one detent in
 * the flick's direction. A hard leftward fling is the one shortcut: it closes
 * the drawer outright instead of parking at `peek`.
 */

export type DrawerStage = 'closed' | 'peek' | 'full';

/** Width of the standard drawer, and the position of the `peek` detent. */
export const DRAWER_PEEK_WIDTH_PX = 256;

/**
 * Upper bound for the expanded stage. Phones expand to the full viewport; on
 * tablets and landscape an uncapped sidebar would be a mostly-empty column.
 */
export const DRAWER_MAX_EXPANDED_WIDTH_PX = 420;

/** Directional intent: below this a release is treated as a slow drag. */
export const DRAWER_FLICK_VELOCITY = 0.45;

/** A fling this fast to the left dismisses the drawer instead of stepping down. */
export const DRAWER_DISMISS_VELOCITY = 0.9;

/** Expanded width for a viewport, clamped so it never shrinks below `peek`. */
export function drawerExpandedWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return DRAWER_MAX_EXPANDED_WIDTH_PX;
  }
  return Math.max(
    DRAWER_PEEK_WIDTH_PX,
    Math.min(viewportWidth, DRAWER_MAX_EXPANDED_WIDTH_PX)
  );
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

  // A flick moves one detent the way the finger was going. `position` can sit
  // exactly on a detent (a flick with no travel), so the neighbour search is
  // strict on both sides.
  if (velocity <= -DRAWER_FLICK_VELOCITY) {
    const below = stops.filter(stop => stop.position < clamped);
    return below.length ? below[below.length - 1].stage : 'closed';
  }
  if (velocity >= DRAWER_FLICK_VELOCITY) {
    const above = stops.find(stop => stop.position > clamped);
    return above ? above.stage : stops[stops.length - 1].stage;
  }

  return stops.reduce((nearest, stop) =>
    Math.abs(stop.position - clamped) < Math.abs(nearest.position - clamped) ? stop : nearest
  ).stage;
}

/** One detent down — what Android back does while the drawer is open. */
export function drawerStageBelow(stage: DrawerStage): DrawerStage {
  return stage === 'full' ? 'peek' : 'closed';
}

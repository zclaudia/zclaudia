/** Drawer decisions use signed pixels/second throughout. */
export type DrawerWidthMode = 'compact' | 'wide';
export type DrawerPhase = 'idle' | 'pending' | 'dragging' | 'settling';
export const DRAWER_MOTION = {
  compactWidth: 300, wideWidth: 420, minimumExpansion: 24,
  activationDistance: 8, horizontalRatio: 1.25, ambiguousDistance: 16,
  flickVelocity: 550, flickRunDistance: 16, releaseWindowMs: 80,
  predictionSeconds: 0.16, maximumPredictionRatio: 0.2,
  openThreshold: 0.55, closeThreshold: 0.45, maximumVelocity: 5000,
  spring: { stiffness: 500, damping: 45, mass: 1, restDelta: 0.5, restSpeed: 10 },
} as const;
export const clampDrawerPosition = (position: number, width: number) =>
  Math.min(Math.max(0, width), Math.max(0, Number.isFinite(position) ? position : 0));
export function drawerWidths(availableWidth: number) {
  const available = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;
  const compact = Math.min(DRAWER_MOTION.compactWidth, available);
  const wide = Math.min(DRAWER_MOTION.wideWidth, available);
  return { compact, wide, canExpand: wide - compact >= DRAWER_MOTION.minimumExpansion };
}
export function drawerVisuals(position: number, width: number) {
  const p = clampDrawerPosition(position, width);
  return { x: p - width, opacity: width > 0 ? 0.5 * p / width : 0 };
}
export function boundDrawerVelocity(velocity: number) {
  return Number.isFinite(velocity)
    ? Math.max(-DRAWER_MOTION.maximumVelocity, Math.min(DRAWER_MOTION.maximumVelocity, velocity)) : 0;
}
/** use-gesture velocity is unsigned px/ms; Motion expects signed px/s. */
export function drawerVelocityFromGesture(velocity: number, direction: number) {
  return boundDrawerVelocity(Math.abs(velocity) * Math.sign(direction) * 1000);
}
export function drawerSpringVelocity(position: number, width: number, velocity: number) {
  const v = boundDrawerVelocity(velocity);
  return (position <= 0 && v < 0) || (position >= width && v > 0) ? 0 : v;
}
export function resolveDrawerOpen({ position, width, priorTargetOpen,
  velocityPxPerSecond, releaseRunDistancePx,
}: { position: number; width: number; priorTargetOpen: boolean;
  velocityPxPerSecond: number; releaseRunDistancePx: number }) {
  if (width <= 0) return false;
  const v = boundDrawerVelocity(velocityPxPerSecond);
  if (Math.abs(v) >= DRAWER_MOTION.flickVelocity &&
    Math.abs(releaseRunDistancePx) >= DRAWER_MOTION.flickRunDistance) return v > 0;
  const prediction = Math.max(-width * DRAWER_MOTION.maximumPredictionRatio,
    Math.min(width * DRAWER_MOTION.maximumPredictionRatio, v * DRAWER_MOTION.predictionSeconds));
  const projected = clampDrawerPosition(clampDrawerPosition(position, width) + prediction, width);
  if (projected >= width * DRAWER_MOTION.openThreshold) return true;
  if (projected <= width * DRAWER_MOTION.closeThreshold) return false;
  return priorTargetOpen;
}

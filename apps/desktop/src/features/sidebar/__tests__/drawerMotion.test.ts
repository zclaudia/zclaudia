import { describe, expect, it } from 'vitest';
import { drawerWidths, drawerVisuals, drawerSpringVelocity, drawerVelocityFromGesture, resolveDrawerOpen } from '../drawerMotion';

function release(position: number, priorTargetOpen = false, velocityPxPerSecond = 0, releaseRunDistancePx = 0, width = 300) {
  return resolveDrawerOpen({ position, width, priorTargetOpen, velocityPxPerSecond, releaseRunDistancePx });
}
describe('two-state drawer release', () => {
  it('returns a slow ten-percent drag to its prior target', () => {
    expect(release(30)).toBe(false);
    expect(release(270, true)).toBe(true);
  });
  it('opens above 55%, closes below 45%, and retains prior intent in between', () => {
    expect(release(165)).toBe(true);
    expect(release(164.9)).toBe(false);
    expect(release(135, true)).toBe(false);
    expect(release(135.1, true)).toBe(true);
    expect(release(150, true)).toBe(true);
    expect(release(150, false)).toBe(false);
  });
  it('requires a deliberate final run for a short flick', () => {
    expect(release(20, false, 550, 16)).toBe(true);
    expect(release(20, false, 550, 15)).toBe(false);
    expect(release(280, true, -550, -16)).toBe(false);
    expect(release(280, true, -550, -15)).toBe(true);
  });
  it('uses the final reverse direction rather than total movement', () => {
    expect(release(220, false, -800, -30)).toBe(false);
    expect(release(80, true, 800, 30)).toBe(true);
  });
  it('uses limited projection and handles out-of-range geometry', () => {
    expect(release(130, false, 250)).toBe(true);
    expect(release(170, true, -250)).toBe(false);
    expect(release(-100, true)).toBe(false);
    expect(release(1000)).toBe(true);
    expect(release(0, true, 1000, 30, 0)).toBe(false);
  });
});
describe('drawer geometry and units', () => {
  it('fits narrow screens and exposes a width button only for a useful change', () => {
    expect(drawerWidths(200)).toEqual({ compact: 200, wide: 200, canExpand: false });
    expect(drawerWidths(323).canExpand).toBe(false);
    expect(drawerWidths(324).canExpand).toBe(true);
    expect(drawerWidths(1000)).toEqual({ compact: 300, wide: 420, canExpand: true });
    expect(drawerWidths(NaN).compact).toBe(0);
  });
  it('clamps transform and opacity while keeping fixed width', () => {
    expect(drawerVisuals(210, 420)).toEqual({ x: -210, opacity: 0.25 });
    expect(drawerVisuals(900, 420)).toEqual({ x: 0, opacity: 0.5 });
    expect(drawerVisuals(-20, 420)).toEqual({ x: -420, opacity: 0 });
    expect(drawerVisuals(0, 0)).toEqual({ x: 0, opacity: 0 });
  });
  it('converts px/ms once and removes outward velocity at a boundary', () => {
    expect(drawerVelocityFromGesture(0.7, -1)).toBe(-700);
    expect(drawerVelocityFromGesture(0.7, 1)).toBe(700);
    expect(drawerSpringVelocity(0, 300, -900)).toBe(0);
    expect(drawerSpringVelocity(300, 300, 900)).toBe(0);
    expect(drawerSpringVelocity(100, 300, -900)).toBe(-900);
  });
});

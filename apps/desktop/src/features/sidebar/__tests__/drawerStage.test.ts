import { describe, expect, it } from 'vitest';
import {
  DRAWER_MAX_EXPANDED_WIDTH_PX,
  DRAWER_PEEK_WIDTH_PX,
  drawerExpandedWidth,
  drawerHasExpandedStage,
  drawerReleaseSettle,
  drawerStageBelow,
  drawerStagePosition,
  resolveDrawerStage,
} from '../drawerStage';

const PHONE = 390;
const TABLET = 1024;

describe('drawerExpandedWidth', () => {
  it('expands to the full viewport on a phone', () => {
    expect(drawerExpandedWidth(PHONE)).toBe(PHONE);
  });

  it('caps the expanded width on tablets and landscape', () => {
    expect(drawerExpandedWidth(TABLET)).toBe(DRAWER_MAX_EXPANDED_WIDTH_PX);
  });

  it('never reports less than the peek width', () => {
    expect(drawerExpandedWidth(200)).toBe(DRAWER_PEEK_WIDTH_PX);
    expect(drawerHasExpandedStage(drawerExpandedWidth(200))).toBe(false);
  });

  it('falls back to the cap for an unknown viewport', () => {
    expect(drawerExpandedWidth(0)).toBe(DRAWER_MAX_EXPANDED_WIDTH_PX);
    expect(drawerExpandedWidth(Number.NaN)).toBe(DRAWER_MAX_EXPANDED_WIDTH_PX);
  });
});

describe('drawerStagePosition', () => {
  it('maps each stage to its revealed width', () => {
    expect(drawerStagePosition('closed', PHONE)).toBe(0);
    expect(drawerStagePosition('peek', PHONE)).toBe(DRAWER_PEEK_WIDTH_PX);
    expect(drawerStagePosition('full', PHONE)).toBe(PHONE);
  });
});

describe('resolveDrawerStage', () => {
  it('keeps the current stage when a slow drag has not reached the midpoint', () => {
    expect(resolveDrawerStage(40, 0, PHONE)).toBe('closed');
    expect(resolveDrawerStage(296, 0, PHONE)).toBe('peek');
    expect(resolveDrawerStage(360, 0, PHONE)).toBe('full');
  });

  it('snaps to the detent the finger is nearest', () => {
    expect(resolveDrawerStage(200, 0, PHONE)).toBe('peek');
    expect(resolveDrawerStage(350, 0, PHONE)).toBe('full');
  });

  it('lands on the crossed detent when a slow drag travels past one', () => {
    // Released from `full` after dragging 170px left — nearest detent is peek.
    expect(resolveDrawerStage(220, 0, PHONE)).toBe('peek');
    // Released from `full` after dragging almost the whole way out.
    expect(resolveDrawerStage(60, 0, PHONE)).toBe('closed');
  });

  it('advances one detent on a rightward flick', () => {
    expect(resolveDrawerStage(20, 0.6, PHONE)).toBe('peek');
    expect(resolveDrawerStage(12, 0.3, PHONE)).toBe('peek');
    expect(resolveDrawerStage(DRAWER_PEEK_WIDTH_PX, 0.6, PHONE)).toBe('full');
  });

  it('coasts on release momentum past the midpoint of a short swipe', () => {
    // 110px of travel alone falls back to closed; 0.25px/ms (below a flick)
    // coasts another 50px, past the 150px midpoint.
    expect(resolveDrawerStage(110, 0, PHONE)).toBe('closed');
    expect(resolveDrawerStage(110, 0.25, PHONE)).toBe('peek');
    expect(resolveDrawerStage(190, 0, PHONE)).toBe('peek');
    expect(resolveDrawerStage(190, -0.25, PHONE)).toBe('closed');
  });

  it('lets a barely-moving release settle where the finger left it', () => {
    expect(resolveDrawerStage(60, 0.05, PHONE)).toBe('closed');
    expect(resolveDrawerStage(260, -0.05, PHONE)).toBe('peek');
  });

  it('never jumps straight to full on a flick from closed', () => {
    expect(resolveDrawerStage(30, 2, PHONE)).toBe('peek');
  });

  it('steps back one detent on a gentle leftward flick', () => {
    expect(resolveDrawerStage(PHONE, -0.5, PHONE)).toBe('peek');
    expect(resolveDrawerStage(DRAWER_PEEK_WIDTH_PX, -0.5, PHONE)).toBe('closed');
  });

  it('dismisses on a hard leftward fling from any stage', () => {
    expect(resolveDrawerStage(PHONE, -1.2, PHONE)).toBe('closed');
    expect(resolveDrawerStage(DRAWER_PEEK_WIDTH_PX, -1.2, PHONE)).toBe('closed');
  });

  it('clamps positions outside the travel range', () => {
    expect(resolveDrawerStage(-50, 0, PHONE)).toBe('closed');
    expect(resolveDrawerStage(900, 0, PHONE)).toBe('full');
  });

  it('offers only closed and peek when the viewport is too narrow to expand', () => {
    expect(resolveDrawerStage(250, 0.6, 200)).toBe('peek');
    expect(resolveDrawerStage(DRAWER_PEEK_WIDTH_PX, 0.6, 200)).toBe('peek');
  });
});

describe('drawerStageBelow', () => {
  it('steps down one detent', () => {
    expect(drawerStageBelow('full')).toBe('peek');
    expect(drawerStageBelow('peek')).toBe('closed');
    expect(drawerStageBelow('closed')).toBe('closed');
  });
});

/** Starting speed of a cubic-bezier(x1, y1, …) settle, in px/ms. */
function startSpeed(timing: { durationMs: number; easing: string }, distance: number) {
  const [x1, y1] = timing.easing.match(/[\d.]+/g)!.map(Number);
  return ((y1 / x1) * distance) / timing.durationMs;
}

describe('drawerReleaseSettle', () => {
  it('leaves the finger at the speed it was moving', () => {
    const timing = drawerReleaseSettle(150, 0.5);
    expect(startSpeed(timing, 150)).toBeCloseTo(0.5, 2);
  });

  it('eases out of rest after a still release', () => {
    const timing = drawerReleaseSettle(150, 0);
    expect(startSpeed(timing, 150)).toBe(0);
    expect(timing.durationMs).toBeGreaterThan(0);
  });

  it('treats a release moving away from the target as still', () => {
    expect(drawerReleaseSettle(-120, -1)).toEqual(drawerReleaseSettle(-120, 0));
  });

  it('shortens the settle rather than overshoot for a fast fling', () => {
    const slow = drawerReleaseSettle(200, 0.4);
    const fast = drawerReleaseSettle(200, 3);
    expect(fast.durationMs).toBeLessThan(slow.durationMs);
    const [, y1] = fast.easing.match(/[\d.]+/g)!.map(Number);
    expect(y1).toBeLessThanOrEqual(1);
    expect(startSpeed(fast, 200)).toBeCloseTo(3, 1);
  });

  it('takes longer for more remaining travel', () => {
    expect(drawerReleaseSettle(280, 0).durationMs).toBeGreaterThan(
      drawerReleaseSettle(40, 0).durationMs
    );
  });

  it('does not animate when already at the detent', () => {
    expect(drawerReleaseSettle(0.4, 2).durationMs).toBe(0);
  });
});

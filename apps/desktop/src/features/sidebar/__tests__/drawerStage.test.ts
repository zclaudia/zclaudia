import { describe, expect, it } from 'vitest';
import {
  DRAWER_COMMIT_DISTANCE_PX,
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
  const CLOSED = 0;
  const PEEK = DRAWER_PEEK_WIDTH_PX;
  const FULL = PHONE;

  it('commits a short, slow drag to the next detent instead of falling back', () => {
    expect(resolveDrawerStage(CLOSED + 40, 0, PHONE, CLOSED)).toBe('peek');
    expect(resolveDrawerStage(PEEK - 40, 0, PHONE, PEEK)).toBe('closed');
    expect(resolveDrawerStage(PEEK + 40, 0, PHONE, PEEK)).toBe('full');
    expect(resolveDrawerStage(FULL - 40, 0, PHONE, FULL)).toBe('peek');
  });

  it('commits at the commit distance and not before', () => {
    const edge = DRAWER_COMMIT_DISTANCE_PX;
    expect(resolveDrawerStage(edge, 0, PHONE, CLOSED)).toBe('peek');
    expect(resolveDrawerStage(edge - 1, 0, PHONE, CLOSED)).toBe('closed');
    expect(resolveDrawerStage(PEEK - edge + 1, 0, PHONE, PEEK)).toBe('peek');
  });

  it('commits even when the finger stops before lifting', () => {
    // A still release reports zero velocity; the travel alone carries it.
    expect(resolveDrawerStage(110, 0, PHONE, CLOSED)).toBe('peek');
    expect(resolveDrawerStage(190, 0, PHONE, PEEK)).toBe('closed');
  });

  it('lands on the detent the finger is nearer once a slow drag crosses one', () => {
    // From closed past peek: nearer peek stays peek, nearer full goes full.
    expect(resolveDrawerStage(330, 0, PHONE, CLOSED)).toBe('peek');
    expect(resolveDrawerStage(380, 0, PHONE, CLOSED)).toBe('full');
    // From full almost all the way out.
    expect(resolveDrawerStage(60, 0, PHONE, FULL)).toBe('closed');
    expect(resolveDrawerStage(220, 0, PHONE, FULL)).toBe('peek');
  });

  it('follows the finger when it pulls back against the drag at release', () => {
    expect(resolveDrawerStage(200, -0.15, PHONE, CLOSED)).toBe('closed');
    expect(resolveDrawerStage(120, 0.15, PHONE, PEEK)).toBe('peek');
  });

  it('ignores a slight backward drift at release', () => {
    expect(resolveDrawerStage(80, -0.05, PHONE, CLOSED)).toBe('peek');
    expect(resolveDrawerStage(220, 0.05, PHONE, PEEK)).toBe('closed');
  });

  it('settles a drag too small to read as intent where it started', () => {
    expect(resolveDrawerStage(10, 0, PHONE, CLOSED)).toBe('closed');
    expect(resolveDrawerStage(PEEK - 10, 0, PHONE, PEEK)).toBe('peek');
    expect(resolveDrawerStage(PEEK + 10, 0, PHONE, PEEK)).toBe('peek');
  });

  it('advances one detent on a rightward flick', () => {
    expect(resolveDrawerStage(20, 0.6, PHONE, CLOSED)).toBe('peek');
    expect(resolveDrawerStage(12, 0.3, PHONE, CLOSED)).toBe('peek');
    expect(resolveDrawerStage(PEEK, 0.6, PHONE, PEEK)).toBe('full');
  });

  it('never jumps straight to full on a flick from closed', () => {
    expect(resolveDrawerStage(30, 2, PHONE, CLOSED)).toBe('peek');
  });

  it('steps back one detent on a gentle leftward flick', () => {
    expect(resolveDrawerStage(FULL, -0.5, PHONE, FULL)).toBe('peek');
    expect(resolveDrawerStage(PEEK, -0.5, PHONE, PEEK)).toBe('closed');
  });

  it('dismisses on a hard leftward fling from any stage', () => {
    expect(resolveDrawerStage(FULL, -1.2, PHONE, FULL)).toBe('closed');
    expect(resolveDrawerStage(PEEK, -1.2, PHONE, PEEK)).toBe('closed');
  });

  it('commits from wherever a drawer caught mid-settle was picked up', () => {
    expect(resolveDrawerStage(180, 0, PHONE, 150)).toBe('peek');
    expect(resolveDrawerStage(120, 0, PHONE, 150)).toBe('closed');
  });

  it('clamps positions outside the travel range', () => {
    expect(resolveDrawerStage(-50, 0, PHONE, PEEK)).toBe('closed');
    expect(resolveDrawerStage(900, 0, PHONE, PEEK)).toBe('full');
  });

  it('offers only closed and peek when the viewport is too narrow to expand', () => {
    expect(resolveDrawerStage(250, 0.6, 200, CLOSED)).toBe('peek');
    expect(resolveDrawerStage(PEEK, 0.6, 200, PEEK)).toBe('peek');
    expect(resolveDrawerStage(PEEK, 0, 200, CLOSED)).toBe('peek');
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

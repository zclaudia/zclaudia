import { describe, expect, it } from 'vitest';
import {
  DRAWER_MAX_EXPANDED_WIDTH_PX,
  DRAWER_PEEK_WIDTH_PX,
  drawerExpandedWidth,
  drawerHasExpandedStage,
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
    expect(resolveDrawerStage(DRAWER_PEEK_WIDTH_PX, 0.6, PHONE)).toBe('full');
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

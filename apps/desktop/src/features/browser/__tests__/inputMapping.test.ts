import { describe, it, expect } from 'vitest';
import { cdpModifiers, mapKey, mapPointer, mapWheel } from '../inputMapping';

const noMods = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
const rect = { width: 400, height: 300 };
const viewport = { width: 800, height: 600 };

describe('cdpModifiers', () => {
  it('encodes the CDP bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8)', () => {
    expect(cdpModifiers(noMods)).toBe(0);
    expect(cdpModifiers({ ...noMods, ctrlKey: true, shiftKey: true })).toBe(10);
  });
});

describe('mapPointer', () => {
  it('scales coordinates from canvas rect to page viewport', () => {
    const ev = mapPointer(
      { offsetX: 100, offsetY: 75, button: 0, type: 'pointerdown', ...noMods },
      rect,
      viewport
    );
    expect(ev).toEqual({ kind: 'mouse', type: 'down', x: 200, y: 150, button: 'left', clickCount: 1, modifiers: 0 });
  });

  it('maps move/up and middle/right buttons', () => {
    expect(mapPointer({ offsetX: 0, offsetY: 0, button: 0, type: 'pointermove', ...noMods }, rect, viewport))
      .toMatchObject({ type: 'move' });
    expect(mapPointer({ offsetX: 0, offsetY: 0, button: 2, type: 'pointerup', ...noMods }, rect, viewport))
      .toMatchObject({ type: 'up', button: 'right' });
    expect(mapPointer({ offsetX: 0, offsetY: 0, button: 1, type: 'pointerdown', ...noMods }, rect, viewport))
      .toMatchObject({ button: 'middle' });
  });

  it('letterboxes a fixed device viewport: uniform fit scale, centering offset, margin clamp', () => {
    // 100×300 device viewport in a 400×300 box → fit 1, x0 = 150 (centered).
    const box = { width: 400, height: 300 };
    const device = { width: 100, height: 300 };
    expect(mapPointer({ offsetX: 160, offsetY: 30, button: 0, type: 'pointerdown', ...noMods }, box, device))
      .toMatchObject({ x: 10, y: 30 });
    // Clicks in the letterbox margins clamp to the page edges.
    expect(mapPointer({ offsetX: 10, offsetY: 30, button: 0, type: 'pointerdown', ...noMods }, box, device))
      .toMatchObject({ x: 0 });
    expect(mapPointer({ offsetX: 390, offsetY: 30, button: 0, type: 'pointerdown', ...noMods }, box, device))
      .toMatchObject({ x: 99 });
    // Downscaled viewport: 800×600 in 200×300 → fit 0.25, y0 = 75.
    expect(mapPointer({ offsetX: 100, offsetY: 150, button: 0, type: 'pointerdown', ...noMods }, { width: 200, height: 300 }, viewport))
      .toMatchObject({ x: 400, y: 300 });
  });

  it('returns null for unknown event types', () => {
    expect(mapPointer({ offsetX: 0, offsetY: 0, button: 0, type: 'pointercancel', ...noMods }, rect, viewport)).toBeNull();
  });
});

describe('mapWheel', () => {
  it('scales position and passes deltas through', () => {
    const ev = mapWheel(
      { offsetX: 200, offsetY: 150, deltaX: 3, deltaY: -53, ...noMods },
      rect,
      viewport
    );
    expect(ev).toEqual({ kind: 'wheel', x: 400, y: 300, deltaX: 3, deltaY: -53, modifiers: 0 });
  });
});

describe('mapKey', () => {
  it('includes text for printable keydown', () => {
    expect(mapKey({ type: 'keydown', key: 'a', code: 'KeyA', ...noMods }))
      .toEqual({ kind: 'key', type: 'down', key: 'a', code: 'KeyA', text: 'a', modifiers: 0 });
  });

  it('omits text for non-printable keys and maps keyup', () => {
    expect(mapKey({ type: 'keydown', key: 'ArrowLeft', code: 'ArrowLeft', ...noMods }))
      .toEqual({ kind: 'key', type: 'down', key: 'ArrowLeft', code: 'ArrowLeft', modifiers: 0 });
    expect(mapKey({ type: 'keyup', key: 'a', code: 'KeyA', ...noMods }))
      .toEqual({ kind: 'key', type: 'up', key: 'a', code: 'KeyA', modifiers: 0 });
  });

  it('adds text for Enter/Backspace-like editing keys via key name (Enter → \\r)', () => {
    expect(mapKey({ type: 'keydown', key: 'Enter', code: 'Enter', ...noMods }))
      .toEqual({ kind: 'key', type: 'down', key: 'Enter', code: 'Enter', text: '\r', modifiers: 0 });
  });
});

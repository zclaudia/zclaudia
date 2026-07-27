import { describe, it, expect } from 'vitest';
import { toCdpInput } from '../input-mapping.js';

describe('toCdpInput', () => {
  it('maps mouse down to mousePressed with button and clickCount', () => {
    const calls = toCdpInput({ kind: 'mouse', type: 'down', x: 10, y: 20, button: 'left', clickCount: 1 });
    expect(calls).toEqual([
      {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1, modifiers: 0 },
      },
    ]);
  });

  it('maps mouse move with button none', () => {
    const [call] = toCdpInput({ kind: 'mouse', type: 'move', x: 5, y: 6 });
    expect(call.params).toMatchObject({ type: 'mouseMoved', button: 'none' });
  });

  it('maps wheel to mouseWheel with deltas', () => {
    const [call] = toCdpInput({ kind: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: -120 });
    expect(call).toEqual({
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseWheel', x: 1, y: 2, button: 'none', deltaX: 0, deltaY: -120, modifiers: 0 },
    });
  });

  it('maps printable keydown to keyDown with text (so pages receive input)', () => {
    const [call] = toCdpInput({ kind: 'key', type: 'down', key: 'a', code: 'KeyA', text: 'a' });
    expect(call).toEqual({
      method: 'Input.dispatchKeyEvent',
      params: { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', modifiers: 0 },
    });
  });

  it('maps non-printable keydown to rawKeyDown (no text)', () => {
    const [call] = toCdpInput({ kind: 'key', type: 'down', key: 'ArrowDown', code: 'ArrowDown' });
    expect(call.params).toMatchObject({ type: 'rawKeyDown', key: 'ArrowDown' });
    expect(call.params).not.toHaveProperty('text');
  });

  it('maps keyup and passes modifiers through', () => {
    const [call] = toCdpInput({ kind: 'key', type: 'up', key: 'a', code: 'KeyA', modifiers: 2 });
    expect(call.params).toMatchObject({ type: 'keyUp', modifiers: 2 });
  });
});

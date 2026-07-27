import type { BrowserInputEvent } from '@zclaudia/shared';

interface ModifierKeys {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function cdpModifiers(e: ModifierKeys): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

const BUTTONS: Record<number, 'left' | 'middle' | 'right'> = { 0: 'left', 1: 'middle', 2: 'right' };
const POINTER_TYPES: Record<string, 'move' | 'down' | 'up'> = {
  pointermove: 'move',
  pointerdown: 'down',
  pointerup: 'up',
};

interface Size {
  width: number;
  height: number;
}

function scale(offsetX: number, offsetY: number, rect: Size, viewport: Size): { x: number; y: number } {
  const sx = rect.width > 0 ? viewport.width / rect.width : 1;
  const sy = rect.height > 0 ? viewport.height / rect.height : 1;
  return { x: Math.round(offsetX * sx), y: Math.round(offsetY * sy) };
}

export function mapPointer(
  e: { offsetX: number; offsetY: number; button: number; type: string } & ModifierKeys,
  rect: Size,
  viewport: Size
): BrowserInputEvent | null {
  const type = POINTER_TYPES[e.type];
  if (!type) return null;
  const { x, y } = scale(e.offsetX, e.offsetY, rect, viewport);
  if (type === 'move') return { kind: 'mouse', type, x, y, modifiers: cdpModifiers(e) };
  return {
    kind: 'mouse',
    type,
    x,
    y,
    button: BUTTONS[e.button] ?? 'left',
    clickCount: 1,
    modifiers: cdpModifiers(e),
  };
}

export function mapWheel(
  e: { offsetX: number; offsetY: number; deltaX: number; deltaY: number } & ModifierKeys,
  rect: Size,
  viewport: Size
): BrowserInputEvent {
  const { x, y } = scale(e.offsetX, e.offsetY, rect, viewport);
  return { kind: 'wheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: cdpModifiers(e) };
}

const KEY_TEXT: Record<string, string> = { Enter: '\r' };

export function mapKey(
  e: { type: string; key: string; code: string } & ModifierKeys
): BrowserInputEvent | null {
  if (e.type !== 'keydown' && e.type !== 'keyup') return null;
  const type = e.type === 'keydown' ? 'down' : 'up';
  const printable = e.key.length === 1;
  const text = type === 'down' ? (printable ? e.key : KEY_TEXT[e.key]) : undefined;
  return {
    kind: 'key',
    type,
    key: e.key,
    code: e.code,
    ...(text !== undefined ? { text } : {}),
    modifiers: cdpModifiers(e),
  };
}

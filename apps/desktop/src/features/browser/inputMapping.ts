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

/**
 * Element coords → page coords. The canvas renders with object-contain, so the
 * page occupies a centered scale-to-fit box inside the element; subtract the
 * letterbox offsets and divide by the fit scale. In desktop mode the viewport
 * equals the element box, degrading to the previous 1:1 mapping. Points in the
 * letterbox margin clamp to the page edge.
 */
function scale(offsetX: number, offsetY: number, rect: Size, viewport: Size): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { x: Math.round(offsetX), y: Math.round(offsetY) };
  }
  const fit = Math.min(rect.width / viewport.width, rect.height / viewport.height);
  const x0 = (rect.width - viewport.width * fit) / 2;
  const y0 = (rect.height - viewport.height * fit) / 2;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return {
    x: Math.round(clamp((offsetX - x0) / fit, viewport.width - 1)),
    y: Math.round(clamp((offsetY - y0) / fit, viewport.height - 1)),
  };
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

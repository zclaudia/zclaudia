import type { BrowserInputEvent } from '@zclaudia/shared';

export interface CdpInputCall {
  method: 'Input.dispatchMouseEvent' | 'Input.dispatchKeyEvent';
  params: Record<string, unknown>;
}

const MOUSE_TYPE: Record<'move' | 'down' | 'up', string> = {
  move: 'mouseMoved',
  down: 'mousePressed',
  up: 'mouseReleased',
};

// Chromium ignores editing/navigation keys dispatched without a virtual key
// code (verified live: rawKeyDown Backspace/Arrow without it is inert; with
// windowsVirtualKeyCode it works). Map the common non-printables.
const VIRTUAL_KEYS: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Escape: 27,
  ' ': 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
};

export function toCdpInput(event: BrowserInputEvent): CdpInputCall[] {
  switch (event.kind) {
    case 'mouse':
      return [
        {
          method: 'Input.dispatchMouseEvent',
          params: {
            type: MOUSE_TYPE[event.type],
            x: event.x,
            y: event.y,
            button: event.type === 'move' ? 'none' : (event.button ?? 'left'),
            ...(event.type !== 'move' ? { clickCount: event.clickCount ?? 1 } : {}),
            modifiers: event.modifiers ?? 0,
          },
        },
      ];
    case 'wheel':
      return [
        {
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mouseWheel',
            x: event.x,
            y: event.y,
            button: 'none',
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            modifiers: event.modifiers ?? 0,
          },
        },
      ];
    case 'key': {
      const hasText = event.type === 'down' && !!event.text;
      const virtualKey = VIRTUAL_KEYS[event.key];
      return [
        {
          method: 'Input.dispatchKeyEvent',
          params: {
            type: event.type === 'up' ? 'keyUp' : hasText ? 'keyDown' : 'rawKeyDown',
            key: event.key,
            code: event.code,
            ...(hasText ? { text: event.text } : {}),
            ...(virtualKey !== undefined
              ? { windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey }
              : {}),
            modifiers: event.modifiers ?? 0,
          },
        },
      ];
    }
  }
}

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
      return [
        {
          method: 'Input.dispatchKeyEvent',
          params: {
            type: event.type === 'up' ? 'keyUp' : hasText ? 'keyDown' : 'rawKeyDown',
            key: event.key,
            code: event.code,
            ...(hasText ? { text: event.text } : {}),
            modifiers: event.modifiers ?? 0,
          },
        },
      ];
    }
  }
}

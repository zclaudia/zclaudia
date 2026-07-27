import { useEffect, useRef } from 'react';
import type { BrowserInputEvent } from '@zclaudia/shared';
import { mapKey, mapPointer, mapWheel } from './inputMapping';

interface Props {
  frame: { data: string; deviceWidth: number; deviceHeight: number } | null;
  /** Page viewport in CSS px — what coordinates must be scaled to. */
  viewport: { width: number; height: number };
  onInput(event: BrowserInputEvent): void;
}

export function BrowserViewportView({ frame, viewport, onInput }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw the latest frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${frame.data}`;
  }, [frame]);

  const rect = () => {
    const c = canvasRef.current;
    return { width: c?.clientWidth ?? 1, height: c?.clientHeight ?? 1 };
  };

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      className="w-full h-full outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-default"
      onPointerDown={(e) => {
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        const ev = mapPointer(e.nativeEvent, rect(), viewport);
        if (ev) onInput(ev);
      }}
      onPointerUp={(e) => {
        const ev = mapPointer(e.nativeEvent, rect(), viewport);
        if (ev) onInput(ev);
      }}
      onPointerMove={(e) => {
        const ev = mapPointer(e.nativeEvent, rect(), viewport);
        if (ev) onInput(ev);
      }}
      onWheel={(e) => onInput(mapWheel(e.nativeEvent, rect(), viewport))}
      onKeyDown={(e) => {
        // Keep app-level shortcuts working: let Cmd/Ctrl+L pass upward.
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') return;
        e.preventDefault();
        const ev = mapKey(e.nativeEvent);
        if (ev) onInput(ev);
      }}
      onKeyUp={(e) => {
        const ev = mapKey(e.nativeEvent);
        if (ev) onInput(ev);
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

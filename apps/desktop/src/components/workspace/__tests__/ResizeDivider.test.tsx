import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ResizeDivider } from '../ResizeDivider';

afterEach(() => cleanup());

describe('ResizeDivider', () => {
  it('renders with ew-resize cursor for dir row', () => {
    const { container } = render(<ResizeDivider dir="row" containerSize={1000} onDrag={() => {}} />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle.className).toContain('cursor-ew-resize');
  });

  it('renders with ns-resize cursor for dir col', () => {
    const { container } = render(<ResizeDivider dir="col" containerSize={1000} onDrag={() => {}} />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle.className).toContain('cursor-ns-resize');
  });

  it('calls onDrag with a positive ratio delta when the pointer moves to enlarge the first child (row, move right)', () => {
    const onDrag = vi.fn();
    const { container } = render(<ResizeDivider dir="row" containerSize={1000} onDrag={onDrag} />);
    const handle = container.firstElementChild as HTMLElement;

    // pointerdown at clientX=100
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 50, buttons: 1 });
    // pointermove to clientX=250 → +150px → ratio delta +0.15 (first child grows)
    fireEvent.pointerMove(document, { clientX: 250, clientY: 50, buttons: 1 });

    expect(onDrag).toHaveBeenCalledWith(expect.closeTo(0.15, 5));
  });

  it('calls onDrag with negative delta when the pointer shrinks the first child (col, move up)', () => {
    const onDrag = vi.fn();
    const { container } = render(<ResizeDivider dir="col" containerSize={500} onDrag={onDrag} />);
    const handle = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(handle, { clientX: 50, clientY: 200, buttons: 1 });
    // move up to clientY=100 → deltaY = 100-200 = -100px → ratio delta -0.2
    fireEvent.pointerMove(document, { clientX: 50, clientY: 100, buttons: 1 });

    expect(onDrag).toHaveBeenCalledWith(expect.closeTo(-0.2, 5));
  });

  it('stops firing after pointerup (a later move is ignored)', () => {
    const onDrag = vi.fn();
    const { container } = render(<ResizeDivider dir="row" containerSize={1000} onDrag={onDrag} />);
    const handle = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, buttons: 1 });
    fireEvent.pointerMove(document, { clientX: 100, clientY: 0, buttons: 1 });
    expect(onDrag).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(document, { clientX: 100, clientY: 0 });
    onDrag.mockClear();

    fireEvent.pointerMove(document, { clientX: 500, clientY: 0, buttons: 1 });
    expect(onDrag).not.toHaveBeenCalled();
  });

  it('does not start a drag without a primary button press (buttons mask)', () => {
    const onDrag = vi.fn();
    const { container } = render(<ResizeDivider dir="row" containerSize={1000} onDrag={onDrag} />);
    const handle = container.firstElementChild as HTMLElement;

    // A mouse pointerdown with no primary button held → should not arm a drag.
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, buttons: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 0, buttons: 1, pointerType: 'mouse' });
    expect(onDrag).not.toHaveBeenCalled();
  });
});

import { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMobileNavigationGesture, type MobileNavigationAdapter, type UseMobileNavigationGestureOptions } from '../useMobileNavigationGesture';

afterEach(cleanup);

function adapter(present = false): MobileNavigationAdapter {
  return {
    getGestureState: vi.fn(() => ({ present, targetOpen: present })),
    beginDrag: vi.fn(() => true), updateDrag: vi.fn(), endDrag: vi.fn(), cancelDrag: vi.fn(),
    pausePending: vi.fn(() => true), resumePending: vi.fn(),
  };
}

type Options = Omit<UseMobileNavigationGestureOptions, 'target'>;
function Harness({ options }: { options: Options }) {
  const target = useRef<HTMLDivElement>(null);
  useMobileNavigationGesture({ ...options, target });
  return <div ref={target} data-testid="shell">
    <button data-testid="button" onClick={click}>Button</button>
    <div data-testid="surface" data-mobile-drawer-surface><button data-testid="surface-button">Close</button></div>
    <div data-testid="scroller" style={{ overflowX: 'auto' }}><span data-testid="scroll-child">Code</span></div>
    <input data-testid="input" />
    <div contentEditable data-testid="editable" />
    <div role="slider" data-testid="slider" />
    <div className="xterm" data-testid="terminal" />
    <div className="monaco-editor" data-testid="editor" />
    <div data-horizontal-drag-ignore data-testid="ignore"><button data-testid="ignored-button" /></div>
    <div data-mobile-navigation-ignore data-testid="custom-ignore" />
  </div>;
}
const click = vi.fn();
let clock = 0;
function touch(target: Element, type: string, x: number, y = 0, extra: { count?: number; cancelable?: boolean; time?: number } = {}) {
  const point = { identifier: 1, clientX: x, clientY: y, pageX: x, pageY: y, target } as Touch;
  const second = { ...point, identifier: 2 } as Touch;
  const ended = type === 'touchend' || type === 'touchcancel';
  const event = new TouchEvent(type, {
    bubbles: true, cancelable: extra.cancelable ?? true,
    touches: ended ? [] : extra.count === 2 ? [point, second] : [point],
    targetTouches: ended ? [] : [point], changedTouches: [point],
  });
  Object.defineProperty(event, 'timeStamp', { value: extra.time ?? (clock += 20) });
  act(() => { target.dispatchEvent(event); });
  return event;
}
function setup(overrides: Partial<Options> = {}) {
  click.mockClear();
  clock = 0;
  const drawer = adapter();
  const claudia = adapter();
  const options: Options = { enabled: true, drawer, claudia, ...overrides };
  const view = render(<Harness options={options} />);
  return { ...view, options, drawer: options.drawer, claudia: options.claudia, button: view.getByTestId('button') };
}

describe('unified mobile navigation gesture', () => {
  it('locks drawer ownership when a right swipe reverses beyond its origin', () => {
    const { button, drawer, claudia } = setup();
    touch(button, 'touchstart', 400);
    const move = touch(button, 'touchmove', 440);
    touch(button, 'touchmove', 200);
    touch(button, 'touchend', 200);
    expect(move.defaultPrevented).toBe(true);
    expect(drawer.updateDrag).toHaveBeenNthCalledWith(1, 32);
    expect(drawer.updateDrag).toHaveBeenCalledWith(-208);
    expect(drawer.endDrag).toHaveBeenCalledOnce();
    expect(claudia.beginDrag).not.toHaveBeenCalled();
  });
  it('opens Claudia only from the central 25%-75% and locks it through reversal', () => {
    const { button, drawer, claudia } = setup();
    touch(button, 'touchstart', 400);
    touch(button, 'touchmove', 350);
    touch(button, 'touchmove', 500);
    touch(button, 'touchend', 500);
    expect(claudia.beginDrag).toHaveBeenCalledOnce();
    expect(drawer.beginDrag).not.toHaveBeenCalled();
    touch(button, 'touchstart', 20);
    touch(button, 'touchmove', 0);
    touch(button, 'touchend', 0);
    expect(claudia.beginDrag).toHaveBeenCalledOnce();
  });
  it('gives an already visible panel priority in either direction', () => {
    const drawer = adapter(true);
    const { button, claudia } = setup({ drawer });
    touch(button, 'touchstart', 400); touch(button, 'touchmove', 350); touch(button, 'touchend', 350);
    expect(drawer.beginDrag).toHaveBeenCalledOnce();
    expect(claudia.beginDrag).not.toHaveBeenCalled();
  });
  it('keeps a vertical or ambiguous native scroll native through later horizontal motion', () => {
    const { button, drawer } = setup();
    touch(button, 'touchstart', 400);
    expect(touch(button, 'touchmove', 402, 20).defaultPrevented).toBe(false);
    touch(button, 'touchmove', 490, 20); touch(button, 'touchend', 490, 20);
    expect(drawer.beginDrag).not.toHaveBeenCalled();
  });
  it('does not steal from a scroller on reaching its boundary until the next touch', () => {
    const view = setup();
    const scroller = view.getByTestId('scroller');
    const child = view.getByTestId('scroll-child');
    Object.defineProperties(scroller, { scrollWidth: { value: 800 }, clientWidth: { value: 200 } });
    scroller.scrollLeft = 100;
    touch(child, 'touchstart', 400); touch(child, 'touchmove', 420);
    scroller.scrollLeft = 0;
    touch(child, 'touchmove', 490); touch(child, 'touchend', 490);
    expect(view.drawer.beginDrag).not.toHaveBeenCalled();
    touch(child, 'touchstart', 400); touch(child, 'touchmove', 420); touch(child, 'touchend', 420);
    expect(view.drawer.beginDrag).toHaveBeenCalledOnce();
  });
  it('blocks only the lift click, preserving keyboard activation and the next fresh tap', () => {
    const { button } = setup();
    touch(button, 'touchstart', 400); touch(button, 'touchmove', 440); touch(button, 'touchend', 440);
    fireEvent.click(button, { detail: 0 });
    expect(click).toHaveBeenCalledOnce();
    fireEvent.click(button, { detail: 1 });
    expect(click).toHaveBeenCalledOnce();
    touch(button, 'touchstart', 400); touch(button, 'touchend', 400);
    fireEvent.click(button, { detail: 1 });
    expect(click).toHaveBeenCalledTimes(2);
  });
  it.each(['input', 'editable', 'slider', 'terminal', 'editor', 'ignored-button', 'custom-ignore'])('preserves excluded %s even with drawer visible', testId => {
    const view = setup({ drawer: adapter(true) });
    const element = view.getByTestId(testId);
    touch(element, 'touchstart', 400); touch(element, 'touchmove', 300); touch(element, 'touchend', 300);
    expect(view.drawer.beginDrag).not.toHaveBeenCalled();
  });
  it('cancels immediately when a second finger arrives without another move', () => {
    const { button, drawer } = setup();
    touch(button, 'touchstart', 400); touch(button, 'touchmove', 440);
    touch(button, 'touchstart', 440, 0, { count: 2 });
    expect(drawer.cancelDrag).toHaveBeenCalledOnce();
    touch(button, 'touchend', 440);
    expect(drawer.endDrag).not.toHaveBeenCalled();
  });
  it('cancels a second finger outside the shell without recognizing or preventing it, and removes the observer', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { button, drawer, unmount } = setup();
    touch(button, 'touchstart', 400); touch(button, 'touchmove', 440);
    const outside = touch(document.body, 'touchstart', 20, 0, { count: 2 });
    expect(outside.defaultPrevented).toBe(false);
    expect(drawer.cancelDrag).toHaveBeenCalledOnce();
    touch(button, 'touchend', 440);
    expect(drawer.endDrag).not.toHaveBeenCalled();
    unmount();
    expect(remove).toHaveBeenCalledWith('touchstart', expect.any(Function), true);
    remove.mockRestore();
  });
  it('cancels a claimed drag on touchcancel and releases the next touch', () => {
    const { button, drawer } = setup();
    touch(button, 'touchstart', 400); touch(button, 'touchmove', 440); touch(button, 'touchcancel', 440);
    expect(drawer.cancelDrag).toHaveBeenCalledOnce();
    touch(button, 'touchstart', 400); touch(button, 'touchmove', 440); touch(button, 'touchend', 440);
    expect(drawer.endDrag).toHaveBeenCalledOnce();
  });
  it('pauses only on a visible drawer surface and resumes a pending tap or scroll', () => {
    const drawer = adapter(true);
    const view = setup({ drawer });
    touch(view.button, 'touchstart', 400); touch(view.button, 'touchend', 400);
    expect(drawer.pausePending).not.toHaveBeenCalled();
    const surface = view.getByTestId('surface');
    touch(surface, 'touchstart', 400); touch(surface, 'touchend', 400);
    expect(drawer.pausePending).toHaveBeenCalledOnce();
    expect(drawer.resumePending).toHaveBeenCalledOnce();
    touch(surface, 'touchstart', 400); touch(surface, 'touchmove', 401, 30);
    expect(drawer.resumePending).toHaveBeenCalledTimes(2);
  });
  it('resumes a pending animation on touchcancel', () => {
    const view = setup({ drawer: adapter(true) });
    const surface = view.getByTestId('surface');
    touch(surface, 'touchstart', 400); touch(surface, 'touchcancel', 400);
    expect(view.drawer.resumePending).toHaveBeenCalledOnce();
  });
  it('cancels on overlay gating, disable, layout commands, blur and unmount', () => {
    const view = setup();
    touch(view.button, 'touchstart', 400); touch(view.button, 'touchmove', 440);
    view.rerender(<Harness options={{ ...view.options, blocked: true }} />);
    expect(view.drawer.cancelDrag).toHaveBeenCalledOnce();
    touch(view.button, 'touchend', 440);
    touch(view.button, 'touchstart', 400); touch(view.button, 'touchmove', 440);
    expect(view.drawer.beginDrag).toHaveBeenCalledOnce();
    view.rerender(<Harness options={{ ...view.options, enabled: false }} />);
    touch(view.button, 'touchend', 440);
    view.rerender(<Harness options={view.options} />);
    touch(view.button, 'touchstart', 400); touch(view.button, 'touchmove', 440);
    view.rerender(<Harness options={{ ...view.options, commandVersion: 1 }} />);
    expect(view.drawer.cancelDrag).toHaveBeenCalledTimes(2);
    touch(view.button, 'touchend', 440);
    touch(view.button, 'touchstart', 400); touch(view.button, 'touchmove', 440);
    fireEvent(window, new Event('blur'));
    expect(view.drawer.cancelDrag).toHaveBeenCalledTimes(3);
    touch(view.button, 'touchend', 440);
    touch(view.button, 'touchstart', 400); touch(view.button, 'touchmove', 440);
    view.unmount();
    expect(view.drawer.cancelDrag).toHaveBeenCalledTimes(4);
  });
  it('uses fresh adapter callbacks after rerender during a drag', () => {
    const view = setup();
    touch(view.button, 'touchstart', 400); touch(view.button, 'touchmove', 440);
    const next = adapter();
    view.rerender(<Harness options={{ ...view.options, drawer: next }} />);
    touch(view.button, 'touchend', 440);
    expect(next.endDrag).toHaveBeenCalledOnce();
    expect(view.drawer.endDrag).not.toHaveBeenCalled();
  });
  it('a drawer command immediately cancels Claudia and its stale lift cannot win', () => {
    let version = 0;
    const drawer = adapter();
    drawer.getGestureState = () => ({ present: version > 0, targetOpen: version > 0, operationVersion: version });
    const view = setup({ drawer });
    touch(view.button, 'touchstart', 400); touch(view.button, 'touchmove', 300);
    expect(view.claudia.beginDrag).toHaveBeenCalledOnce();
    version += 1; // e.g. Android Back opens the drawer while Claudia is pending open.
    view.rerender(<Harness options={{ ...view.options }} />);
    expect(view.claudia.cancelDrag).toHaveBeenCalledOnce();
    touch(view.button, 'touchend', 300);
    expect(view.claudia.endDrag).not.toHaveBeenCalled();
  });
  it('detects an external command on touchend even without a React render', () => {
    let version = 0;
    const drawer = adapter();
    drawer.getGestureState = () => ({ present: false, targetOpen: false, operationVersion: version });
    const view = setup({ drawer });
    touch(view.button, 'touchstart', 400); touch(view.button, 'touchmove', 300);
    version += 1;
    touch(view.button, 'touchend', 300);
    expect(view.claudia.cancelDrag).toHaveBeenCalledOnce();
    expect(view.claudia.endDrag).not.toHaveBeenCalled();
  });
  it('invalidates pending input after an external command but preserves its own pause and begin versions', () => {
    let version = 0;
    const drawer = adapter(true);
    drawer.getGestureState = () => ({ present: true, targetOpen: true, operationVersion: version });
    drawer.pausePending = vi.fn(() => { version += 1; return true; });
    drawer.beginDrag = vi.fn(() => { version += 1; return true; });
    const view = setup({ drawer });
    const surface = view.getByTestId('surface');
    touch(surface, 'touchstart', 400);
    view.rerender(<Harness options={{ ...view.options }} />);
    expect(drawer.resumePending).not.toHaveBeenCalled();
    touch(surface, 'touchmove', 350);
    view.rerender(<Harness options={{ ...view.options }} />);
    expect(drawer.cancelDrag).not.toHaveBeenCalled();
    touch(surface, 'touchend', 350);
    expect(drawer.endDrag).toHaveBeenCalledOnce();
    touch(surface, 'touchstart', 400);
    version += 1;
    view.rerender(<Harness options={{ ...view.options }} />);
    expect(drawer.resumePending).toHaveBeenCalledOnce();
    touch(surface, 'touchmove', 350); touch(surface, 'touchend', 350);
    expect(drawer.beginDrag).toHaveBeenCalledOnce();
  });
  it('also observes external Claudia command versions during a drawer drag', () => {
    let version = 0;
    const claudia = adapter();
    claudia.getGestureState = () => ({ present: false, targetOpen: false, operationVersion: version });
    const view = setup({ claudia });
    touch(view.button, 'touchstart', 400); touch(view.button, 'touchmove', 440);
    version += 1;
    touch(view.button, 'touchend', 440);
    expect(view.drawer.cancelDrag).toHaveBeenCalledOnce();
    expect(view.drawer.endDrag).not.toHaveBeenCalled();
  });
  it('never prevents unowned events and cancels when the browser takes a claimed drag', () => {
    const { button, drawer } = setup();
    expect(touch(button, 'touchstart', 400).defaultPrevented).toBe(false);
    expect(touch(button, 'touchmove', 405).defaultPrevented).toBe(false);
    touch(button, 'touchmove', 440);
    touch(button, 'touchmove', 460, 0, { cancelable: false });
    expect(drawer.cancelDrag).toHaveBeenCalledOnce();
    touch(button, 'touchend', 460);
    expect(drawer.endDrag).not.toHaveBeenCalled();
  });
  it('zeros release velocity after a held drag', () => {
    const { button, drawer } = setup();
    touch(button, 'touchstart', 400, 0, { time: 10 });
    touch(button, 'touchmove', 460, 0, { time: 30 });
    touch(button, 'touchend', 460, 0, { time: 130 });
    expect(drawer.endDrag).toHaveBeenCalledWith({ velocityPxPerSecond: 0, releaseRunDistancePx: 0 });
  });
  it.each(['resize', 'visibilitychange'])('releases ownership on %s', eventName => {
    const { button, drawer } = setup();
    touch(button, 'touchstart', 400); touch(button, 'touchmove', 440);
    if (eventName === 'visibilitychange') {
      const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      fireEvent(document, new Event(eventName));
      if (descriptor) Object.defineProperty(document, 'hidden', descriptor);
      else Reflect.deleteProperty(document, 'hidden');
    } else fireEvent(window, new Event(eventName));
    touch(button, 'touchend', 440);
    expect(drawer.cancelDrag).toHaveBeenCalledOnce();
    expect(drawer.endDrag).not.toHaveBeenCalled();
  });
});

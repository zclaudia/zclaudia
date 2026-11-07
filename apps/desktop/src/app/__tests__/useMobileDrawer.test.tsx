import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useLayoutEffect, type PropsWithChildren } from 'react';
import type * as Motion from 'motion';
import { useMobileDrawer } from '../useMobileDrawer';

const animations = vi.hoisted(() => [] as Array<{ target: number; value: { set(v: number): void }; options: { onComplete(): void; onUpdate?(v: number): void }; stop: ReturnType<typeof vi.fn> }>);
vi.mock('motion', async importOriginal => {
  const actual = await importOriginal<typeof Motion>();
  return { ...actual, animate: vi.fn((value, target, options) => {
    const animation = { value, target, options, stop: vi.fn() };
    animations.push(animation);
    return animation;
  }) };
});
const defaults = { isMobile: true, gestureActive: true, isAgentExpanded: false, isFeedOpen: false, isFileViewerFullscreen: false };
const release = { velocityPxPerSecond: 0, releaseRunDistancePx: 0 };
function finishLast() {
  const a = animations.at(-1)!;
  a.value.set(a.target);
  a.options.onComplete();
}

afterEach(cleanup);
beforeEach(() => {
  animations.length = 0;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
});
describe('mobile drawer controller', () => {
  it('does not rerender the app at drag activation and disables width control until release', () => {
    let renders = 0;
    let controller: ReturnType<typeof useMobileDrawer>;
    function Harness() {
      const drawer = useMobileDrawer(defaults);
      const { drawerPanelRef, drawerBackdropRef, widthChangeDisabled } = drawer;
      useLayoutEffect(() => { renders += 1; controller = drawer; });
      return <><div ref={drawerPanelRef}><button data-drawer-width-toggle disabled={widthChangeDisabled}>Width</button></div><div ref={drawerBackdropRef} /></>;
    }
    const view = render(<Harness />);
    act(() => controller.setSidebarOpen(true));
    act(finishLast);
    const before = renders;
    const button = view.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    act(() => { controller.beginDrag(); controller.updateDrag(-40); });
    expect(renders).toBe(before);
    expect(controller.getGestureState().phase).toBe('dragging');
    expect(button.disabled).toBe(true);
    act(() => controller.endDrag(release));
    act(finishLast);
    expect(button.disabled).toBe(false);
  });
  it('rearms lifecycle guards after StrictMode replay and stops on unmount', () => {
    const { result, unmount } = renderHook(() => useMobileDrawer(defaults), {
      wrapper: ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>,
    });
    expect(result.current.canExpand).toBe(true);
    act(() => result.current.setSidebarOpen(true));
    act(finishLast);
    expect(result.current.sidebarOpen).toBe(true);
    act(() => result.current.setSidebarOpen(false));
    const close = animations.at(-1)!;
    unmount();
    expect(close.stop).toHaveBeenCalled();
    act(() => close.options.onComplete());
  });
  it('retains modal presence through the complete closing animation', () => {
    const { result } = renderHook(() => useMobileDrawer(defaults));
    act(() => result.current.setSidebarOpen(true));
    expect(result.current.sidebarOpen).toBe(true);
    act(finishLast);
    act(() => result.current.setSidebarOpen(false));
    expect(result.current.targetOpen).toBe(false);
    expect(result.current.sidebarOpen).toBe(true);
    act(finishLast);
    expect(result.current.sidebarOpen).toBe(false);
    expect(result.current.phase).toBe('idle');
  });
  it.each([0.25, 0.5, 0.75])('picks up a wide close at %s without jumping or changing width', fraction => {
    const { result } = renderHook(() => useMobileDrawer(defaults));
    act(() => result.current.setSidebarOpen(true));
    act(finishLast);
    act(() => result.current.toggleWidth());
    expect(result.current.widthMode).toBe('wide');
    act(() => result.current.setSidebarOpen(false));
    act(() => result.current.drawerPosition.set(390 * fraction));
    const position = result.current.drawerPosition.get();
    act(() => { result.current.beginDrag(); result.current.updateDrag(0); });
    expect(result.current.drawerPosition.get()).toBe(position);
    act(() => result.current.updateDrag(-10));
    expect(result.current.drawerPosition.get()).toBe(position - 10);
    expect(result.current.widthMode).toBe('wide');
  });
  it('ignores a late close completion after a newer open', () => {
    const { result } = renderHook(() => useMobileDrawer(defaults));
    act(() => result.current.setSidebarOpen(true));
    act(finishLast);
    act(() => result.current.setSidebarOpen(false));
    const close = animations.at(-1)!;
    act(() => result.current.drawerPosition.set(120));
    act(() => result.current.setSidebarOpen(true));
    act(() => close.options.onComplete());
    expect(result.current.targetOpen).toBe(true);
    expect(result.current.sidebarOpen).toBe(true);
    expect(result.current.drawerPosition.get()).toBe(120);
    act(finishLast);
    expect(result.current.drawerPosition.get()).toBe(300);
  });
  it('invalidates drag end after an explicit command', () => {
    const { result } = renderHook(() => useMobileDrawer(defaults));
    act(() => { result.current.beginDrag(); result.current.updateDrag(200); });
    expect(result.current.sidebarOpen).toBe(false);
    act(() => result.current.setSidebarOpen(false));
    const count = animations.length;
    act(() => { result.current.updateDrag(290); result.current.endDrag({ velocityPxPerSecond: 1000, releaseRunDistancePx: 80 }); });
    expect(animations).toHaveLength(count);
    expect(result.current.targetOpen).toBe(false);
    expect(result.current.drawerPosition.get()).toBe(200);
  });
  it('restores compact width only after wide closing finishes', () => {
    const { result } = renderHook(() => useMobileDrawer(defaults));
    act(() => result.current.setSidebarOpen(true));
    act(finishLast);
    act(() => result.current.toggleWidth());
    act(() => result.current.setSidebarOpen(false));
    expect(result.current.widthMode).toBe('wide');
    act(finishLast);
    expect(result.current.widthMode).toBe('compact');
    act(() => result.current.setSidebarOpen(true));
    expect(animations.at(-1)!.target).toBe(300);
  });
  it('resets wide mode when resizing completes an in-flight close', () => {
    const { result } = renderHook(() => useMobileDrawer(defaults));
    act(() => result.current.setSidebarOpen(true));
    act(finishLast);
    act(() => result.current.toggleWidth());
    act(() => result.current.setSidebarOpen(false));
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.widthMode).toBe('compact');
    expect(result.current.sidebarOpen).toBe(false);
    expect(result.current.drawerPosition.get()).toBe(0);
  });
  it('resumes a paused animation after vertical/native input, but preserves intervening commands', () => {
    const { result } = renderHook(() => useMobileDrawer(defaults));
    act(() => result.current.setSidebarOpen(true));
    act(() => result.current.drawerPosition.set(100));
    act(() => { expect(result.current.pausePending()).toBe(true); });
    expect(result.current.phase).toBe('pending');
    act(() => result.current.resumePending());
    expect(animations.at(-1)!.target).toBe(300);
    act(() => result.current.pausePending());
    act(() => result.current.setSidebarOpen(false));
    const count = animations.length;
    act(() => result.current.resumePending());
    expect(animations).toHaveLength(count);
    expect(result.current.targetOpen).toBe(false);
  });
  it('cancels disabled drags and resizes to the existing target without a stale completion', () => {
    const { result, rerender } = renderHook(props => useMobileDrawer(props), { initialProps: defaults });
    act(() => { result.current.beginDrag(); result.current.updateDrag(200); });
    rerender({ ...defaults, isFileViewerFullscreen: true });
    expect(result.current.phase).toBe('settling');
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.drawerPosition.get()).toBe(0);
    expect(result.current.sidebarOpen).toBe(false);
    act(() => result.current.endDrag(release));
    expect(result.current.targetOpen).toBe(false);
    rerender({ ...defaults, isMobile: false });
    expect(result.current.getGestureState().enabled).toBe(false);
    expect(result.current.beginDrag()).toBe(false);
  });
  it('finishes at a physical boundary before a fast spring can overshoot', () => {
    const { result } = renderHook(() => useMobileDrawer(defaults));
    act(() => result.current.setSidebarOpen(true));
    const animation = animations.at(-1)!;
    act(() => { animation.value.set(311); animation.options.onUpdate?.(311); });
    expect(result.current.drawerPosition.get()).toBe(300);
    expect(result.current.phase).toBe('idle');
    expect(animation.stop).toHaveBeenCalled();
    act(() => { result.current.beginDrag(); result.current.updateDrag(-5); });
    expect(result.current.drawerPosition.get()).toBe(295);
  });
  it('releases modal state when hidden and remeasures before reduced-motion reopening', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(query => Object.assign(new EventTarget(), {
      matches: query.includes('reduced-motion'), media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as MediaQueryList);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const { result } = renderHook(() => useMobileDrawer(defaults));
    act(() => result.current.setSidebarOpen(true));
    expect(result.current.phase).toBe('idle');
    expect(result.current.drawerPosition.get()).toBe(300);
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.sidebarOpen).toBe(false);
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => result.current.setSidebarOpen(true));
    expect(result.current.drawerPosition.get()).toBe(300);
    expect(result.current.sidebarOpen).toBe(true);
  });
  it('steps back from wide to compact before closing', () => {
    const { result } = renderHook(() => useMobileDrawer(defaults));
    act(() => result.current.setSidebarOpen(true));
    act(finishLast);
    act(() => result.current.toggleWidth());
    act(() => result.current.stepBack());
    expect(result.current.widthMode).toBe('compact');
    expect(result.current.targetOpen).toBe(true);
    act(() => result.current.stepBack());
    expect(result.current.targetOpen).toBe(false);
  });
});

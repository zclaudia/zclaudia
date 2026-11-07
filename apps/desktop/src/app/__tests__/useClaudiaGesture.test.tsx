import { useLayoutEffect } from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Motion from 'motion';
import { useClaudiaGesture } from '../useClaudiaGesture';
import type { MobileNavigationAdapter } from '../useMobileNavigationGesture';

const animations = vi.hoisted(() => [] as Array<{ value: { set(v: number): void }; target: number; options: { velocity: number; onUpdate(v: number): void; onComplete(): void }; stop: ReturnType<typeof vi.fn> }>);
vi.mock('motion', async importOriginal => {
  const actual = await importOriginal<typeof Motion>();
  return { ...actual, animate: vi.fn((value, target, options) => {
    const animation = { value, target, options, stop: vi.fn() };
    animations.push(animation);
    return animation;
  }) };
});
beforeEach(() => { animations.length = 0; });
let adapter: MobileNavigationAdapter;
function Harness({ expanded = false, mounted = true }: { expanded?: boolean; mounted?: boolean }) {
  const gesture = useClaudiaGesture(expanded, true, vi.fn());
  const { adapter: currentAdapter, panelRef, backdropRef } = gesture;
  useLayoutEffect(() => { adapter = currentAdapter; });
  return mounted ? <><div data-testid="panel" ref={panelRef} /><div ref={backdropRef} /></> : null;
}

describe('Claudia gesture', () => {
  it('tracks finger pixels and takes over an interrupted settle without jumping', () => {
    const { getByTestId } = render(<Harness />);
    const panel = getByTestId('panel');
    const initial = window.innerWidth;
    act(() => { adapter.beginDrag(); adapter.updateDrag(-30); });
    expect(panel.style.transform).toBe(`translate3d(${initial - 30}px, 0, 0)`);
    act(() => { adapter.endDrag({ velocityPxPerSecond: 0, releaseRunDistancePx: 0 }); });
    const before = panel.style.transform;
    act(() => { adapter.pausePending?.(); adapter.beginDrag(); adapter.updateDrag(0); });
    expect(panel.style.transform).toBe(before);
    act(() => { adapter.updateDrag(-20); });
    expect(panel.style.transform).toBe(`translate3d(${initial - 50}px, 0, 0)`);
  });
  it('cancels back to its prior target and ignores a replaced animation completion', () => {
    const { getByTestId, rerender, unmount } = render(<Harness />);
    const panel = getByTestId('panel');
    act(() => { adapter.beginDrag(); adapter.updateDrag(-40); adapter.cancelDrag(); });
    const old = animations.at(-1)!;
    rerender(<Harness expanded />);
    const next = animations.at(-1)!;
    expect(old.stop).toHaveBeenCalled();
    act(() => old.options.onComplete());
    expect(panel.style.visibility).toBe('visible');
    act(() => { next.value.set(next.target); next.options.onComplete(); });
    expect(panel.style.transform).toBe('translate3d(0px, 0, 0)');
    unmount();
  });
  it('clamps an overshoot internally before an interrupted animation is resumed', () => {
    const { getByTestId } = render(<Harness />);
    act(() => { adapter.beginDrag(); adapter.updateDrag(-100); adapter.endDrag({ velocityPxPerSecond: -2000, releaseRunDistancePx: -30 }); });
    const first = animations.at(-1)!;
    act(() => { first.value.set(-20); first.options.onUpdate(-20); });
    expect(first.stop).toHaveBeenCalled();
    const panel = getByTestId('panel');
    expect(panel.style.transform).toBe('translate3d(0px, 0, 0)');
    act(() => { adapter.beginDrag(); adapter.updateDrag(10); });
    expect(panel.style.transform).toBe('translate3d(10px, 0, 0)');
    act(() => first.options.onUpdate(-30));
    expect(panel.style.transform).toBe('translate3d(10px, 0, 0)');
  });
  it('reinitializes the panel when the mobile shell remounts', () => {
    const { getByTestId, rerender } = render(<Harness expanded />);
    rerender(<Harness expanded mounted={false} />);
    rerender(<Harness expanded />);
    expect(getByTestId('panel').style.visibility).toBe('visible');
    expect(getByTestId('panel').style.transform).toBe('translate3d(0px, 0, 0)');
  });
  it('restores the target on resize during a drag', () => {
    const { getByTestId } = render(<Harness />);
    act(() => { adapter.beginDrag(); adapter.updateDrag(-30); window.dispatchEvent(new Event('resize')); });
    expect(getByTestId('panel').style.visibility).toBe('hidden');
    expect(getByTestId('panel').style.transform).toBe(`translate3d(${window.innerWidth}px, 0, 0)`);
  });
});

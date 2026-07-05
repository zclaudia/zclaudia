// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';
import { useSavedBridge } from '../useSavedBridge';

interface HookProps {
  loading: boolean;
  containsResult: boolean;
}

function renderBridge<T>(initial: HookProps = { loading: false, containsResult: false }) {
  return renderHook(
    ({ loading, containsResult }: HookProps) =>
      useSavedBridge<T>({ loading, contains: () => containsResult }),
    { initialProps: initial }
  );
}

describe('useSavedBridge', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({ agentsRefreshNonce: 0 });
  });

  it('record then lookup hits for the same identity, misses for others', () => {
    const { result } = renderBridge<{ name: string }>();

    act(() => {
      result.current.record('b1', 'id1', { name: 'One' });
    });

    expect(result.current.lookup('b1', 'id1')).toEqual({ name: 'One' });
    expect(result.current.lookup('b1', 'other')).toBeUndefined();
    expect(result.current.lookup('b2', 'id1')).toBeUndefined();
  });

  it('id-only record resolves to true (marker semantics)', () => {
    const { result } = renderBridge<never>();

    act(() => {
      result.current.record('b1', 'id1');
    });

    expect(result.current.lookup('b1', 'id1')).toBe(true);
  });

  it('does not clear while the refetch has not settled (no loading transition seen)', () => {
    const { result, rerender } = renderBridge<never>();

    act(() => {
      result.current.record('b1', 'id1');
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });
    // Same props re-render without any loading phase — the record must survive
    // (this is the render right after the save; the refetch hasn't started).
    rerender({ loading: false, containsResult: false });

    expect(result.current.lookup('b1', 'id1')).toBe(true);
  });

  it('clears once the fetched data contains the id', () => {
    const { result, rerender } = renderBridge<never>();

    act(() => {
      result.current.record('b1', 'id1');
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });
    expect(result.current.lookup('b1', 'id1')).toBe(true);

    rerender({ loading: false, containsResult: true });

    expect(result.current.lookup('b1', 'id1')).toBeUndefined();
  });

  it('clears when a post-save cycle settles WITHOUT the id (loading true -> false)', () => {
    const { result, rerender } = renderBridge<never>();

    act(() => {
      result.current.record('b1', 'id1');
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });

    // Refetch starts (nonce already >= nonceAtSave)…
    rerender({ loading: true, containsResult: false });
    expect(result.current.lookup('b1', 'id1')).toBe(true);

    // …and settles without delivering the id — the bridge must let go so the
    // consumer's stale/error rendering takes over (no eternal Loading chrome).
    rerender({ loading: false, containsResult: false });
    expect(result.current.lookup('b1', 'id1')).toBeUndefined();
  });

  it('a settle also clears when the save happened during an in-flight cycle', () => {
    const { result, rerender } = renderBridge<never>({ loading: true, containsResult: false });

    act(() => {
      result.current.record('b1', 'id1');
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });
    // Loading was already true at record time; re-render at loading=true marks
    // the refetch as observed, then the settle clears.
    rerender({ loading: true, containsResult: false });
    rerender({ loading: false, containsResult: false });

    expect(result.current.lookup('b1', 'id1')).toBeUndefined();
  });

  it('value-carrying record keeps returning the value until cleared', () => {
    const { result, rerender } = renderBridge<{ name: string }>();

    act(() => {
      result.current.record('b1', 'id1', { name: 'One' });
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });
    rerender({ loading: true, containsResult: false });
    expect(result.current.lookup('b1', 'id1')).toEqual({ name: 'One' });

    // Settle without the id: the value is gone with the record (consumer falls
    // back to its empty/error state).
    rerender({ loading: false, containsResult: false });
    expect(result.current.lookup('b1', 'id1')).toBeUndefined();
  });

  it("re-recording after a settle resets tracking (the old cycle's settle does not count)", () => {
    const { result, rerender } = renderBridge<never>();

    // First save's cycle runs and settles without the id — record cleared.
    act(() => {
      result.current.record('b1', 'id1');
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });
    rerender({ loading: true, containsResult: false });
    rerender({ loading: false, containsResult: false });
    expect(result.current.lookup('b1', 'id1')).toBeUndefined();

    // A second save at loading=false: the already-observed old settle must not
    // clear the fresh record on the next loading=false render.
    act(() => {
      result.current.record('b1', 'id2');
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });
    rerender({ loading: false, containsResult: false });
    expect(result.current.lookup('b1', 'id2')).toBe(true);

    // The new cycle then runs and settles — now it clears.
    rerender({ loading: true, containsResult: false });
    rerender({ loading: false, containsResult: false });
    expect(result.current.lookup('b1', 'id2')).toBeUndefined();
  });

  it('clear() drops the record immediately', () => {
    const { result } = renderBridge<never>();

    act(() => {
      result.current.record('b1', 'id1');
    });
    expect(result.current.lookup('b1', 'id1')).toBe(true);

    act(() => {
      result.current.clear();
    });
    expect(result.current.lookup('b1', 'id1')).toBeUndefined();
  });
});

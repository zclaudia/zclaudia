import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StrictModeTestWrapper } from '../../test/StrictModeTestWrapper';
import { useIsMounted } from '../useIsMounted';

describe('useIsMounted', () => {
  it('stays armed after the StrictMode setup-cleanup-setup replay', () => {
    const { result } = renderHook(() => useIsMounted(), {
      wrapper: StrictModeTestWrapper,
    });

    expect(result.current()).toBe(true);
  });

  it('reports false after the real unmount', () => {
    const { result, unmount } = renderHook(() => useIsMounted());
    const isMounted = result.current;

    act(() => unmount());

    expect(isMounted()).toBe(false);
  });
});

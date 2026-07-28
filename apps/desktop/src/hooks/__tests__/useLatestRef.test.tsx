import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StrictModeTestWrapper } from '../../test/StrictModeTestWrapper';
import { useLatestRef } from '../useLatestRef';

describe('useLatestRef', () => {
  it('keeps stable identity while exposing the latest committed value under StrictMode', () => {
    const { result, rerender } = renderHook(({ value }) => useLatestRef(value), {
      initialProps: { value: 'a' },
      wrapper: StrictModeTestWrapper,
    });
    const ref = result.current;

    rerender({ value: 'b' });

    expect(result.current).toBe(ref);
    expect(result.current.current).toBe('b');
  });
});

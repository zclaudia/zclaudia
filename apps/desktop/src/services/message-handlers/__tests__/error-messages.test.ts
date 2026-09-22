import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleErrorMessage } from '../error-messages';
import { useToastStore } from '../../../stores/toastStore';
import { useBackgroundRequestStore } from '../../../stores/backgroundRequestStore';

const ctx = { logTag: 'test' } as never;

describe('handleErrorMessage', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    useBackgroundRequestStore.setState({ pending: {} });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('surfaces background conversion failures as toasts (the button has no failure state)', () => {
    expect(
      handleErrorMessage(
        { type: 'error', code: 'BACKGROUND_UNSUPPORTED', message: 'The claude runtime cannot…' },
        ctx
      )
    ).toBe(true);
    expect(
      handleErrorMessage({ type: 'error', code: 'NO_INFLIGHT_COMMAND', message: 'gone' }, ctx)
    ).toBe(true);
    expect(useToastStore.getState().toasts.map(t => [t.type, t.message])).toEqual([
      ['error', 'gone'],
      ['error', 'The claude runtime cannot…'],
    ]);
  });

  it('releases in-flight background requests so the card unlocks for a retry', () => {
    useBackgroundRequestStore.getState().markRequested('s1', 't1');
    handleErrorMessage({ type: 'error', code: 'NO_INFLIGHT_COMMAND', message: 'gone' }, ctx);
    expect(useBackgroundRequestStore.getState().pending).toEqual({});

    useBackgroundRequestStore.getState().markRequested('s1', 't2');
    handleErrorMessage({ type: 'error', code: 'NOT_READY', message: 'x' }, ctx);
    expect(Object.keys(useBackgroundRequestStore.getState().pending)).toEqual(['t2']);
  });

  it('keeps other server errors console-only', () => {
    expect(handleErrorMessage({ type: 'error', code: 'NOT_READY', message: 'x' }, ctx)).toBe(true);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('ignores non-error messages', () => {
    expect(handleErrorMessage({ type: 'pong' } as never, ctx)).toBe(false);
  });
});

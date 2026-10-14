import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  useComposerMountDraft,
  useComposerPrefill,
  useSessionInitialDraft,
} from '../useComposerPrefill';
import { useComposerStore } from '../../../../stores/composerStore';

const reset = () => useComposerStore.setState({ drafts: {}, pendingPrefills: {} });

beforeEach(reset);

describe('useComposerPrefill (one-shot pending prefill)', () => {
  it('surfaces a pending prefill, then consumes it on the next tick', async () => {
    const { result, rerender } = renderHook(sid => useComposerPrefill(sid), {
      initialProps: 's1',
    });
    expect(result.current.pendingPrefill).toBeUndefined();
    expect(result.current.prefillConsumed).toBe(false);

    act(() => result.current.pushPrefill('run plan'));
    rerender('s1');
    expect(result.current.pendingPrefill?.content).toBe('run plan');
    expect(result.current.prefillConsumed).toBe(false);

    await waitFor(() => expect(result.current.prefillConsumed).toBe(true));
    expect(result.current.pendingPrefill).toBeUndefined();
    expect(useComposerStore.getState().pendingPrefills.s1).toBeUndefined();
  });

  it('resets consumption gating when the session switches', async () => {
    act(() => useComposerStore.getState().setPendingPrefill('s1', 'hello'));
    const { result, rerender } = renderHook(sid => useComposerPrefill(sid), {
      initialProps: 's1',
    });
    await waitFor(() => expect(result.current.prefillConsumed).toBe(true));

    rerender('s2');
    expect(result.current.prefillConsumed).toBe(false);
    expect(result.current.pendingPrefill).toBeUndefined();
  });
});

describe('useSessionInitialDraft (latched per-session snapshot)', () => {
  it('recaptures the persisted draft on session switch and ignores later store updates', () => {
    useComposerStore.getState().setDraft('s1', { content: 'one', attachments: [] });
    const { result, rerender } = renderHook(sid => useSessionInitialDraft(sid), {
      initialProps: 's1',
    });
    expect(result.current?.content).toBe('one');

    // Store updates after the switch must never clobber the latched snapshot.
    act(() => useComposerStore.getState().setDraft('s1', { content: 'edited', attachments: [] }));
    expect(result.current?.content).toBe('one');

    act(() => useComposerStore.getState().setDraft('s2', { content: 'two', attachments: [] }));
    rerender('s2');
    expect(result.current?.content).toBe('two');
  });
});

describe('useComposerMountDraft (capture-once keyed composer prefill)', () => {
  it('lets a not-yet-restored rejected draft win over the persisted draft', () => {
    useComposerStore.getState().setDraft('k', { content: 'stored', attachments: [] });
    const { result } = renderHook(() =>
      useComposerMountDraft('k', { input: 'rejected text', draftAttachments: [] })
    );
    expect(result.current).toEqual({ content: 'rejected text', attachments: [] });
  });

  it('falls back to the persisted draft once the rejected draft was restored', () => {
    useComposerStore.getState().setDraft('k', { content: 'stored', attachments: [] });
    const { result } = renderHook(() =>
      useComposerMountDraft('k', { input: 'rejected text', draftRestored: true })
    );
    expect(result.current?.content).toBe('stored');
  });

  it('captures once per mount: later store changes do not replace the snapshot', () => {
    const { result, rerender } = renderHook(
      ({ sid, rejected }) => useComposerMountDraft(sid, rejected),
      { initialProps: { sid: 'k', rejected: null as { input: string } | null } }
    );
    expect(result.current).toBeUndefined();
    act(() => useComposerStore.getState().setDraft('k', { content: 'late', attachments: [] }));
    rerender({ sid: 'k', rejected: { input: 'now rejected' } });
    expect(result.current).toBeUndefined();
  });
});

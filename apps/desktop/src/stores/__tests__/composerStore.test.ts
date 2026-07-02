import { describe, it, expect, beforeEach } from 'vitest';
import { useComposerStore } from '../composerStore';

const reset = () => useComposerStore.setState({ drafts: {}, pendingPrefills: {} });

describe('composerStore', () => {
  beforeEach(reset);

  it('stores a draft with content', () => {
    useComposerStore.getState().setDraft('s1', { content: 'hi', attachments: [] });
    expect(useComposerStore.getState().drafts.s1).toEqual({ content: 'hi', attachments: [] });
  });

  it('drops an empty draft instead of storing it', () => {
    useComposerStore.getState().setDraft('s1', { content: 'x', attachments: [] });
    useComposerStore.getState().setDraft('s1', { content: '   ', attachments: [] });
    expect(useComposerStore.getState().drafts.s1).toBeUndefined();
  });

  it('clears a draft', () => {
    useComposerStore.getState().setDraft('s1', { content: 'x', attachments: [] });
    useComposerStore.getState().clearDraft('s1');
    expect(useComposerStore.getState().drafts.s1).toBeUndefined();
  });

  it('retains a draft that has attachments but no text content', () => {
    const att = {
      id: 'a1',
      type: 'image' as const,
      name: 'x.png',
      data: 'd',
      mimeType: 'image/png',
    };
    useComposerStore.getState().setDraft('s1', { content: '', attachments: [att] });
    expect(useComposerStore.getState().drafts.s1).toEqual({ content: '', attachments: [att] });
  });

  it('sets and clears a pending prefill', () => {
    useComposerStore.getState().setPendingPrefill('s1', 'run plan');
    expect(useComposerStore.getState().pendingPrefills.s1?.content).toBe('run plan');
    useComposerStore.getState().clearPendingPrefill('s1');
    expect(useComposerStore.getState().pendingPrefills.s1).toBeUndefined();
  });
});

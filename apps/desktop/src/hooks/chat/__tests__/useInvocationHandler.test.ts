import { describe, expect, it } from 'vitest';
import type { InvocableDescriptor } from '@zclaudia/shared/providers';
import {
  activeSelection,
  buildCanonicalInvocationSubmission,
  buildRawMessageSubmission,
} from '../useInvocationHandler';

function descriptor(overrides: Partial<InvocableDescriptor> = {}): InvocableDescriptor {
  return {
    id: 'inv1:review',
    kind: 'runtime.command',
    runtimeType: 'claude',
    name: 'review',
    label: 'Review',
    displayTrigger: '/review',
    origin: { owner: 'project', scope: 'project' },
    execution: {
      mode: 'native-text',
      fidelity: 'exact',
      arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'verbatim' } },
    },
    availability: { available: true },
    ...overrides,
  };
}

describe('invocation submission builders', () => {
  it('submits canonical ID, revision, fingerprint, and one argument representation', () => {
    const message = buildCanonicalInvocationSubmission(
      'session-1',
      {
        descriptor: descriptor(),
        typedTrigger: '/review',
        arguments: { type: 'raw', value: 'focus on auth' },
      },
      { revision: 'rev-1', contextFingerprint: 'fp-1' }
    );
    expect(message.protocolVersion).toBe(2);
    if (message.turnInput.type !== 'invocation') throw new Error('expected invocation turn input');
    expect(message.turnInput.request).toEqual({
      invocableId: 'inv1:review',
      catalogRevision: 'rev-1',
      contextFingerprint: 'fp-1',
      arguments: { type: 'raw', value: 'focus on auth' },
    });
    // A canonical submission never carries mode or workingDirectory overrides.
    expect('mode' in message).toBe(false);
    expect('workingDirectory' in message).toBe(false);
  });

  it('submits raw text by default and literal mode only on explicit request', () => {
    const resolve = buildRawMessageSubmission('session-1', '/zc:help');
    expect(resolve.turnInput).toEqual({ type: 'message', text: '/zc:help' });

    const literal = buildRawMessageSubmission('session-1', '/zc:help', { sendLiterally: true });
    expect(literal.turnInput).toEqual({
      type: 'message',
      text: '/zc:help',
      reservedNamespaceMode: 'literal',
    });
  });

  it('preserves uploaded attachments on canonical and literal submissions', () => {
    const attachments = [
      { fileId: 'file-1', name: 'design.png', mimeType: 'image/png', type: 'image' as const },
    ];
    const canonical = buildCanonicalInvocationSubmission(
      'session-1',
      {
        descriptor: descriptor(),
        typedTrigger: '/review',
        arguments: { type: 'raw', value: '' },
      },
      { revision: 'rev-1', contextFingerprint: 'fp-1' },
      { attachments }
    );
    expect(canonical.turnInput).toMatchObject({ type: 'invocation', attachments });

    const literal = buildRawMessageSubmission('session-1', '/skill:review', {
      sendLiterally: true,
      attachments,
    });
    expect(literal.turnInput).toMatchObject({
      type: 'message',
      text: '/skill:review',
      attachments,
      reservedNamespaceMode: 'literal',
    });
  });

  it('keeps the canonical selection only while the typed text still matches', () => {
    const selection = {
      descriptor: descriptor(),
      typedTrigger: '/review',
      arguments: { type: 'raw' as const, value: '' },
    };
    expect(activeSelection(selection, '/review')).toBe(selection);
    expect(activeSelection(selection, '/review focus')).toBe(selection);
    expect(activeSelection(selection, '/reviews')).toBeUndefined();
    expect(activeSelection(undefined, '/review')).toBeUndefined();
  });
});

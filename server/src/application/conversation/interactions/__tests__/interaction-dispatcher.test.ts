import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { InteractionPromptMessage } from '@zclaudia/shared/interaction/forms';
import { interactionDispatcher } from '../interaction-dispatcher.js';

function promptEvent(interactionId: string, sessionId: string): InteractionPromptMessage {
  return {
    type: 'interaction_prompt',
    interactionId,
    sessionId,
    source: 'tool_call',
    createdAt: Date.now(),
    title: 'Question',
    fields: [],
    submitLabel: 'Submit',
    responseMode: 'interaction_response',
    variant: 'form',
  };
}

describe('interaction-dispatcher', () => {
  beforeEach(() => {
    interactionDispatcher.setSendFunction(() => {});
    interactionDispatcher.cancelBySession('session-1');
    interactionDispatcher.cancelBySession('session-2');
    interactionDispatcher.setSendFunction(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers pending state before sending so synchronous responses are not lost', async () => {
    interactionDispatcher.setSendFunction((sessionId, event) => {
      expect(sessionId).toBe('session-1');
      expect(event.type).toBe('interaction_prompt');
      expect(interactionDispatcher.resolve('interaction-1', { approved: true })).toBe(true);
    });

    await expect(
      interactionDispatcher.dispatchAndWait(
        'interaction-1',
        'session-1',
        {
          type: 'interaction_prompt',
          interactionId: 'interaction-1',
          sessionId: 'session-1',
          source: 'tool_call',
          createdAt: Date.now(),
          title: 'Question',
          fields: [],
          submitLabel: 'Submit',
          responseMode: 'interaction_response',
          variant: 'form',
        },
        1000
      )
    ).resolves.toEqual({ approved: true });
  });

  it('cleans up pending state when send fails', async () => {
    interactionDispatcher.setSendFunction(() => {
      throw new Error('send failed');
    });

    await expect(
      interactionDispatcher.dispatchAndWait(
        'interaction-2',
        'session-2',
        {
          type: 'interaction_prompt',
          interactionId: 'interaction-2',
          sessionId: 'session-2',
          source: 'tool_call',
          createdAt: Date.now(),
          title: 'Question',
          fields: [],
          submitLabel: 'Submit',
          responseMode: 'interaction_response',
          variant: 'form',
        },
        1000
      )
    ).resolves.toEqual({ error: 'send failed' });

    expect(interactionDispatcher.pendingCount).toBe(0);
    expect(interactionDispatcher.hasPending('session-2')).toBe(false);
  });

  it('broadcasts interaction_resolved with reason timeout when the user never responds', async () => {
    const sent: ServerMessage[] = [];
    interactionDispatcher.setSendFunction((_sessionId, event) => {
      sent.push(event);
    });

    await expect(
      interactionDispatcher.dispatchAndWait('i-timeout', 'session-1', promptEvent('i-timeout', 'session-1'), 20)
    ).resolves.toEqual({ error: 'User did not respond within timeout' });

    expect(sent).toContainEqual({
      type: 'interaction_resolved',
      interactionId: 'i-timeout',
      sessionId: 'session-1',
      reason: 'timeout',
    });
    expect(interactionDispatcher.hasPending('session-1')).toBe(false);
  });

  it('broadcasts interaction_resolved with reason cancelled when the session ends', async () => {
    const sent: ServerMessage[] = [];
    interactionDispatcher.setSendFunction((_sessionId, event) => {
      sent.push(event);
    });

    const pending = interactionDispatcher.dispatchAndWait(
      'i-cancel',
      'session-1',
      promptEvent('i-cancel', 'session-1'),
      60_000
    );
    interactionDispatcher.cancelBySession('session-1');

    await expect(pending).resolves.toEqual({ error: 'Session ended' });
    expect(sent).toContainEqual({
      type: 'interaction_resolved',
      interactionId: 'i-cancel',
      sessionId: 'session-1',
      reason: 'cancelled',
    });
  });

  it('supersede resolves prior pending interactions of the same type and broadcasts the reason', async () => {
    const sent: ServerMessage[] = [];
    interactionDispatcher.setSendFunction((_sessionId, event) => {
      sent.push(event);
    });

    const oldReview = interactionDispatcher.dispatchAndWait(
      'i-old-review',
      'session-1',
      {
        type: 'interaction_plan_review',
        interactionId: 'i-old-review',
        sessionId: 'session-1',
        source: 'tool_call',
        createdAt: Date.now(),
        plan: 'old plan',
      },
      60_000
    );
    const otherType = interactionDispatcher.dispatchAndWait(
      'i-other-type',
      'session-1',
      promptEvent('i-other-type', 'session-1'),
      60_000
    );
    const otherSession = interactionDispatcher.dispatchAndWait(
      'i-other-session',
      'session-2',
      {
        type: 'interaction_plan_review',
        interactionId: 'i-other-session',
        sessionId: 'session-2',
        source: 'tool_call',
        createdAt: Date.now(),
        plan: 'other session plan',
      },
      60_000
    );

    interactionDispatcher.supersede('session-1', 'interaction_plan_review');

    await expect(oldReview).resolves.toEqual({ error: 'superseded' });
    expect(sent).toContainEqual({
      type: 'interaction_resolved',
      interactionId: 'i-old-review',
      sessionId: 'session-1',
      reason: 'superseded',
    });

    // Different type and different session stay pending.
    expect(interactionDispatcher.hasPending('session-1')).toBe(true);
    expect(interactionDispatcher.hasPending('session-2')).toBe(true);
    expect(interactionDispatcher.resolve('i-other-type', { approved: true })).toBe(true);
    expect(interactionDispatcher.resolve('i-other-session', { approved: true })).toBe(true);
    await otherType;
    await otherSession;
  });

  it('never times out when timeoutMs is null', async () => {
    vi.useFakeTimers();
    const pending = interactionDispatcher.dispatchAndWait(
      'i-no-timeout',
      'session-1',
      promptEvent('i-no-timeout', 'session-1'),
      null
    );

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(interactionDispatcher.hasPending('session-1')).toBe(true);

    expect(interactionDispatcher.resolve('i-no-timeout', { approved: true })).toBe(true);
    await expect(pending).resolves.toEqual({ approved: true });
  });

  it('does not broadcast a resolution reason when the user responds normally', async () => {
    const sent: ServerMessage[] = [];
    interactionDispatcher.setSendFunction((_sessionId, event) => {
      sent.push(event);
      interactionDispatcher.resolve('i-normal', { approved: true });
    });

    await expect(
      interactionDispatcher.dispatchAndWait('i-normal', 'session-1', promptEvent('i-normal', 'session-1'), 1000)
    ).resolves.toEqual({ approved: true });

    expect(sent.filter(e => e.type === 'interaction_resolved')).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleInteractionResponse } from '../permissions.js';
import { interactionDispatcher } from '../../interactions/interaction-dispatcher.js';
import { broadcastRunMessage } from '../../transport/broadcast.js';
import type { ActiveRun, ConnectedClient } from '../../transport/types.js';

vi.mock('../../transport/broadcast.js', () => ({
  broadcastRunMessage: vi.fn(),
}));

function makeActiveRuns(sessionId: string): Map<string, ActiveRun> {
  return new Map([['run-1', { sessionId } as ActiveRun]]);
}

const clients = new Map<string, ConnectedClient>();

describe('handleInteractionResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interactionDispatcher.setSendFunction(() => {});
    interactionDispatcher.cancelBySession('session-1');
  });

  it('broadcasts interaction_resolved without a reason when the response lands', async () => {
    const pending = interactionDispatcher.dispatchAndWait(
      'i-live',
      'session-1',
      {
        type: 'interaction_plan_review',
        interactionId: 'i-live',
        sessionId: 'session-1',
        source: 'tool_call',
        createdAt: Date.now(),
        plan: 'plan',
      },
      1000
    );

    handleInteractionResponse(
      {
        type: 'interaction_response',
        interactionId: 'i-live',
        sessionId: 'session-1',
        response: { approved: true },
      },
      makeActiveRuns('session-1'),
      clients
    );

    await expect(pending).resolves.toEqual({ approved: true });
    expect(broadcastRunMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      {
        type: 'interaction_resolved',
        interactionId: 'i-live',
        sessionId: 'session-1',
      }
    );
  });

  it('broadcasts interaction_resolved with reason stale when the interaction is unknown', () => {
    handleInteractionResponse(
      {
        type: 'interaction_response',
        interactionId: 'i-zombie',
        sessionId: 'session-1',
        response: { approved: true },
      },
      makeActiveRuns('session-1'),
      clients
    );

    expect(broadcastRunMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      {
        type: 'interaction_resolved',
        interactionId: 'i-zombie',
        sessionId: 'session-1',
        reason: 'stale',
      }
    );
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { useInteractionStore } from '../interactionStore';

describe('interactionStore', () => {
  beforeEach(() => {
    useInteractionStore.setState({ interactions: {}, expiredReasons: {} });
  });

  it('markExpired keeps the interaction and records the reason', () => {
    useInteractionStore.setState({
      interactions: {
        'server-plan': {
          type: 'interaction_plan_review',
          interactionId: 'server-plan',
          sessionId: 'session-1',
          source: 'tool_call',
          createdAt: 1,
          plan: 'Server plan',
        },
      },
    });

    useInteractionStore.getState().markExpired('server-plan', 'timeout');

    expect(useInteractionStore.getState().interactions).toHaveProperty('server-plan');
    expect(useInteractionStore.getState().expiredReasons['server-plan']).toBe('timeout');
  });

  it('resolveInteraction removes the interaction and its expired reason', () => {
    useInteractionStore.setState({
      interactions: {
        'server-plan': {
          type: 'interaction_plan_review',
          interactionId: 'server-plan',
          sessionId: 'session-1',
          source: 'tool_call',
          createdAt: 1,
          plan: 'Server plan',
        },
      },
      expiredReasons: { 'server-plan': 'timeout' },
    });

    useInteractionStore.getState().resolveInteraction('server-plan');

    expect(useInteractionStore.getState().interactions).not.toHaveProperty('server-plan');
    expect(useInteractionStore.getState().expiredReasons).not.toHaveProperty('server-plan');
  });

  it('clearSession drops expired reasons for the interactions it removes', () => {
    useInteractionStore.setState({
      interactions: {
        'server-plan': {
          type: 'interaction_plan_review',
          interactionId: 'server-plan',
          sessionId: 'session-1',
          source: 'tool_call',
          createdAt: 1,
          plan: 'Server plan',
        },
        'other-session-plan': {
          type: 'interaction_plan_review',
          interactionId: 'other-session-plan',
          sessionId: 'session-2',
          source: 'tool_call',
          createdAt: 1,
          plan: 'Other plan',
        },
      },
      expiredReasons: { 'server-plan': 'timeout', 'other-session-plan': 'cancelled' },
    });

    useInteractionStore.getState().clearSession('session-1');

    expect(useInteractionStore.getState().expiredReasons).not.toHaveProperty('server-plan');
    expect(useInteractionStore.getState().expiredReasons['other-session-plan']).toBe('cancelled');
  });

  it('clears only client-synth plan reviews for the given session', () => {
    useInteractionStore.setState({
      interactions: {
        'client-plan': {
          type: 'interaction_plan_review',
          interactionId: 'client-plan',
          sessionId: 'session-1',
          source: 'client_synth',
          createdAt: 1,
          plan: 'Client plan',
        },
        'server-plan': {
          type: 'interaction_plan_review',
          interactionId: 'server-plan',
          sessionId: 'session-1',
          source: 'tool_call',
          createdAt: 1,
          plan: 'Server plan',
        },
        'other-client-plan': {
          type: 'interaction_plan_review',
          interactionId: 'other-client-plan',
          sessionId: 'session-2',
          source: 'client_synth',
          createdAt: 1,
          plan: 'Other client plan',
        },
        prompt: {
          type: 'interaction_prompt',
          interactionId: 'prompt',
          sessionId: 'session-1',
          source: 'provider_native',
          createdAt: 1,
          title: 'Question',
          fields: [],
        },
      },
    });

    useInteractionStore.getState().clearClientSynthPlanReviewsForSession('session-1');

    expect(useInteractionStore.getState().interactions).not.toHaveProperty('client-plan');
    expect(useInteractionStore.getState().interactions).toHaveProperty('server-plan');
    expect(useInteractionStore.getState().interactions).toHaveProperty('other-client-plan');
    expect(useInteractionStore.getState().interactions).toHaveProperty('prompt');
  });
});

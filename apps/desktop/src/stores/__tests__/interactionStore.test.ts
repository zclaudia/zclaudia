import { beforeEach, describe, expect, it } from 'vitest';
import { useInteractionStore } from '../interactionStore';

describe('interactionStore', () => {
  beforeEach(() => {
    useInteractionStore.setState({ interactions: {}, expiredReasons: {}, owners: {} });
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

  it('restores pending approvals from a matching backend, session, and run snapshot', () => {
    const approval = {
      type: 'interaction_approval' as const,
      interactionId: 'approval-1',
      sessionId: 'session-b',
      source: 'tool_call' as const,
      createdAt: 1,
      title: 'Approve',
      message: 'Review action',
    };

    useInteractionStore
      .getState()
      .reconcilePendingApprovals(
        'backend-b',
        [{ runId: 'run-b', sessionId: 'session-b' }],
        [{ runId: 'run-b', interaction: approval }]
      );

    expect(useInteractionStore.getState().interactions['approval-1']).toEqual(approval);
    expect(useInteractionStore.getState().owners['approval-1']).toEqual({
      serverId: 'backend-b',
      runId: 'run-b',
    });
  });

  it('treats omitted approvals as unknown and empty snapshots as scoped authoritative state', () => {
    const approval = {
      type: 'interaction_approval' as const,
      interactionId: 'approval-b',
      sessionId: 'session-b',
      source: 'tool_call' as const,
      createdAt: 1,
      title: 'Approve',
      message: 'Review action',
    };
    const store = useInteractionStore.getState();
    store.upsertInteraction(approval, { serverId: 'backend-b', runId: 'run-b' });

    store.reconcilePendingApprovals(
      'backend-b',
      [{ runId: 'run-b', sessionId: 'session-b' }],
      undefined
    );
    expect(useInteractionStore.getState().interactions).toHaveProperty('approval-b');

    // A's empty snapshot must not clear B's pending approval.
    useInteractionStore
      .getState()
      .reconcilePendingApprovals('backend-a', [{ runId: 'run-a', sessionId: 'session-a' }], []);
    expect(useInteractionStore.getState().interactions).toHaveProperty('approval-b');

    // B's explicit empty snapshot for the exact active run clears it.
    useInteractionStore
      .getState()
      .reconcilePendingApprovals('backend-b', [{ runId: 'run-b', sessionId: 'session-b' }], []);
    expect(useInteractionStore.getState().interactions).not.toHaveProperty('approval-b');
  });

  it('clears only the terminal run approval when backend session IDs collide', () => {
    const approval = (id: string, sessionId: string) => ({
      type: 'interaction_approval' as const,
      interactionId: id,
      sessionId,
      source: 'tool_call' as const,
      createdAt: 1,
      title: 'Approve',
      message: 'Review action',
    });
    useInteractionStore.getState().upsertInteraction(approval('approval-a', 'shared-session'), {
      serverId: 'backend-a',
      runId: 'run-a',
    });
    useInteractionStore.getState().upsertInteraction(approval('approval-b', 'shared-session'), {
      serverId: 'backend-b',
      runId: 'run-b',
    });

    useInteractionStore.getState().clearSession('shared-session', {
      serverId: 'backend-a',
      runId: 'run-a',
    });

    expect(useInteractionStore.getState().interactions).not.toHaveProperty('approval-a');
    expect(useInteractionStore.getState().interactions).toHaveProperty('approval-b');
  });

  it('uses exact run/session pairs and clears stale approvals after their run leaves the snapshot', () => {
    const approval = (id: string) => ({
      type: 'interaction_approval' as const,
      interactionId: id,
      sessionId: 'shared-session',
      source: 'tool_call' as const,
      createdAt: 1,
      title: 'Approve',
      message: 'Review action',
    });
    useInteractionStore.getState().upsertInteraction(approval('old-run'), {
      serverId: 'backend-a',
      runId: 'run-old',
    });

    useInteractionStore
      .getState()
      .reconcilePendingApprovals(
        'backend-a',
        [{ runId: 'run-new', sessionId: 'shared-session' }],
        [{ runId: 'run-new', interaction: approval('new-run') }]
      );

    expect(useInteractionStore.getState().interactions).not.toHaveProperty('old-run');
    expect(useInteractionStore.getState().interactions).toHaveProperty('new-run');
  });

  it('retains approvals for each exact run/session pair when a session has concurrent runs', () => {
    const approval = (id: string) => ({
      type: 'interaction_approval' as const,
      interactionId: id,
      sessionId: 'shared-session',
      source: 'tool_call' as const,
      createdAt: 1,
      title: 'Approve',
      message: 'Review action',
    });

    useInteractionStore.getState().reconcilePendingApprovals(
      'backend-a',
      [
        { runId: 'run-a', sessionId: 'shared-session' },
        { runId: 'run-b', sessionId: 'shared-session' },
      ],
      [
        { runId: 'run-a', interaction: approval('approval-a') },
        { runId: 'run-b', interaction: approval('approval-b') },
      ]
    );

    expect(useInteractionStore.getState().interactions).toHaveProperty('approval-a');
    expect(useInteractionStore.getState().interactions).toHaveProperty('approval-b');
  });
});

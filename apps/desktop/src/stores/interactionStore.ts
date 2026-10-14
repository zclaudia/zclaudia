import { create } from 'zustand';
import type { InteractionMessage } from '@zclaudia/shared/interaction/forms';
import type { InteractionResolvedReason } from '@zclaudia/shared/interaction/forms';

interface InteractionOwner {
  serverId: string;
  runId?: string;
}

interface InteractionState {
  /** All active interactions keyed by interactionId */
  interactions: Record<string, InteractionMessage>;
  /**
   * Interactions the server can no longer answer (timed out, run cancelled,
   * stale). Kept visible so the card can render as expired instead of
   * silently vanishing or showing live buttons that do nothing.
   */
  expiredReasons: Record<string, InteractionResolvedReason>;
  /** Backend/run provenance used to reconcile snapshots without cross-clearing peers. */
  owners: Record<string, InteractionOwner>;

  /** Upsert an interaction (TodoUpdate with same ID overwrites previous) */
  upsertInteraction: (event: InteractionMessage, owner?: InteractionOwner) => void;
  /** Mark an interaction as resolved (remove it) */
  resolveInteraction: (interactionId: string) => void;
  /** Keep the interaction but flag it as no longer answerable */
  markExpired: (interactionId: string, reason: InteractionResolvedReason) => void;
  /** Check if an interaction exists */
  has: (interactionId: string) => boolean;
  /** Get all interactions for a session */
  getBySession: (sessionId: string) => InteractionMessage[];
  /** Clear all interactions for a session */
  clearSession: (sessionId: string, owner?: { serverId: string; runId: string }) => void;
  /** Clear client-synthesised Cursor plan reviews after the user responds manually */
  clearClientSynthPlanReviewsForSession: (sessionId: string) => void;
  reconcilePendingApprovals: (
    serverId: string,
    activeRuns: Array<{ runId: string; sessionId: string }>,
    pendingApprovals?: Array<{ runId: string; interaction: InteractionMessage }>
  ) => void;
}

export const useInteractionStore = create<InteractionState>((set, get) => ({
  interactions: {},
  expiredReasons: {},
  owners: {},

  upsertInteraction: (event, owner) =>
    set(state => ({
      interactions: { ...state.interactions, [event.interactionId]: event },
      owners: owner ? { ...state.owners, [event.interactionId]: owner } : state.owners,
    })),

  resolveInteraction: interactionId =>
    set(state => {
      const { [interactionId]: _, ...rest } = state.interactions;
      const { [interactionId]: _reason, ...restReasons } = state.expiredReasons;
      const { [interactionId]: _owner, ...restOwners } = state.owners;
      return { interactions: rest, expiredReasons: restReasons, owners: restOwners };
    }),

  markExpired: (interactionId, reason) =>
    set(state => ({
      expiredReasons: { ...state.expiredReasons, [interactionId]: reason },
    })),

  has: interactionId => interactionId in get().interactions,

  getBySession: sessionId =>
    Object.values(get().interactions).filter(i => i.sessionId === sessionId),

  clearSession: (sessionId, owner) =>
    set(state => {
      const filtered: Record<string, InteractionMessage> = {};
      for (const [id, interaction] of Object.entries(state.interactions)) {
        // Different-session interactions: always keep
        if (interaction.sessionId !== sessionId) {
          filtered[id] = interaction;
          continue;
        }
        if (
          owner &&
          interaction.type === 'interaction_approval' &&
          (state.owners[id]?.serverId !== owner.serverId || state.owners[id]?.runId !== owner.runId)
        ) {
          // A terminal event from one backend/run must not erase a peer
          // backend's approval, even if session IDs happen to collide.
          filtered[id] = interaction;
          continue;
        }
        // Same-session: keep unresolved client-synthesised plan reviews so the
        // user can still act on them after the cursor run completes (cursor
        // does not block server-side on createPlan; the user's decision is
        // resolved client-side via handleSendMessage).
        if (
          interaction.type === 'interaction_plan_review' &&
          interaction.source === 'client_synth'
        ) {
          filtered[id] = interaction;
          continue;
        }
        // Other same-session interactions: drop (existing behaviour).
      }
      const expiredReasons: InteractionState['expiredReasons'] = {};
      for (const [id, reason] of Object.entries(state.expiredReasons)) {
        if (id in filtered) expiredReasons[id] = reason;
      }
      const owners: InteractionState['owners'] = {};
      for (const [id, owner] of Object.entries(state.owners)) {
        if (id in filtered) owners[id] = owner;
      }
      return { interactions: filtered, expiredReasons, owners };
    }),

  clearClientSynthPlanReviewsForSession: sessionId =>
    set(state => {
      const filtered: Record<string, InteractionMessage> = {};
      for (const [id, interaction] of Object.entries(state.interactions)) {
        if (
          interaction.sessionId === sessionId &&
          interaction.type === 'interaction_plan_review' &&
          interaction.source === 'client_synth'
        ) {
          continue;
        }
        filtered[id] = interaction;
      }
      const owners: InteractionState['owners'] = {};
      for (const [id, owner] of Object.entries(state.owners)) {
        if (id in filtered) owners[id] = owner;
      }
      return { interactions: filtered, owners };
    }),

  reconcilePendingApprovals: (serverId, activeRuns, pendingApprovals) => {
    // Older servers omit this optional field. Omission is not an empty
    // snapshot and must never clear an interaction received live.
    if (pendingApprovals === undefined) return;
    set(state => {
      const activeRunPairs = new Set(activeRuns.map(run => `${run.runId}\u0000${run.sessionId}`));
      const valid = pendingApprovals.filter(
        entry =>
          activeRunPairs.has(`${entry.runId}\u0000${entry.interaction.sessionId}`) &&
          entry.interaction.type === 'interaction_approval'
      );
      const validIds = new Set(valid.map(entry => entry.interaction.interactionId));
      const interactions = { ...state.interactions };
      const owners = { ...state.owners };
      const expiredReasons = { ...state.expiredReasons };

      for (const [id, event] of Object.entries(interactions)) {
        const owner = owners[id];
        if (event.type !== 'interaction_approval' || owner?.serverId !== serverId) continue;
        // When the optional field is present, it is an authoritative snapshot
        // for this backend's dispatcher, including approvals from runs that
        // have since terminated. Retain other backends; remove absent IDs from
        // this backend even when its session no longer has an active run.
        if (!validIds.has(id)) {
          delete interactions[id];
          delete owners[id];
          delete expiredReasons[id];
        }
      }

      for (const { runId, interaction } of valid) {
        interactions[interaction.interactionId] = interaction;
        owners[interaction.interactionId] = { serverId, runId };
        delete expiredReasons[interaction.interactionId];
      }
      return { interactions, owners, expiredReasons };
    });
  },
}));

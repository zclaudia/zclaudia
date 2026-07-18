import { create } from 'zustand';
import type { InteractionMessage } from '@zclaudia/shared';
import type { InteractionResolvedReason } from '@zclaudia/shared/interaction/forms';

interface InteractionState {
  /** All active interactions keyed by interactionId */
  interactions: Record<string, InteractionMessage>;
  /**
   * Interactions the server can no longer answer (timed out, run cancelled,
   * stale). Kept visible so the card can render as expired instead of
   * silently vanishing or showing live buttons that do nothing.
   */
  expiredReasons: Record<string, InteractionResolvedReason>;

  /** Upsert an interaction (TodoUpdate with same ID overwrites previous) */
  upsertInteraction: (event: InteractionMessage) => void;
  /** Mark an interaction as resolved (remove it) */
  resolveInteraction: (interactionId: string) => void;
  /** Keep the interaction but flag it as no longer answerable */
  markExpired: (interactionId: string, reason: InteractionResolvedReason) => void;
  /** Check if an interaction exists */
  has: (interactionId: string) => boolean;
  /** Get all interactions for a session */
  getBySession: (sessionId: string) => InteractionMessage[];
  /** Clear all interactions for a session */
  clearSession: (sessionId: string) => void;
  /** Clear client-synthesised Cursor plan reviews after the user responds manually */
  clearClientSynthPlanReviewsForSession: (sessionId: string) => void;
}

export const useInteractionStore = create<InteractionState>((set, get) => ({
  interactions: {},
  expiredReasons: {},

  upsertInteraction: event =>
    set(state => ({
      interactions: { ...state.interactions, [event.interactionId]: event },
    })),

  resolveInteraction: interactionId =>
    set(state => {
      const { [interactionId]: _, ...rest } = state.interactions;
      const { [interactionId]: _reason, ...restReasons } = state.expiredReasons;
      return { interactions: rest, expiredReasons: restReasons };
    }),

  markExpired: (interactionId, reason) =>
    set(state => ({
      expiredReasons: { ...state.expiredReasons, [interactionId]: reason },
    })),

  has: interactionId => interactionId in get().interactions,

  getBySession: sessionId =>
    Object.values(get().interactions).filter(i => i.sessionId === sessionId),

  clearSession: sessionId =>
    set(state => {
      const filtered: Record<string, InteractionMessage> = {};
      for (const [id, interaction] of Object.entries(state.interactions)) {
        // Different-session interactions: always keep
        if (interaction.sessionId !== sessionId) {
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
      return { interactions: filtered, expiredReasons };
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
      return { interactions: filtered };
    }),
}));

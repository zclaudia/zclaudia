import { create } from 'zustand';

export interface DraftAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  data: string;
  mimeType: string;
}

export interface SessionDraft {
  content: string;
  attachments: DraftAttachment[];
}

interface ComposerState {
  // Input drafts per session (preserved across session switches)
  drafts: Record<string, SessionDraft>;
  // Pending one-shot prefill into the chat input (e.g. "Execute plan" button).
  // Consumed by ChatInputArea on next render and immediately cleared.
  // `ts` distinguishes successive prefills with identical content.
  pendingPrefills: Record<string, { content: string; ts: number }>;

  setDraft: (sessionId: string, draft: SessionDraft) => void;
  clearDraft: (sessionId: string) => void;
  setPendingPrefill: (sessionId: string, content: string) => void;
  clearPendingPrefill: (sessionId: string) => void;
}

// Owns transient chat-input state (per-session drafts + one-shot prefills).
export const useComposerStore = create<ComposerState>(set => ({
  drafts: {},
  pendingPrefills: {},

  setDraft: (sessionId, draft) =>
    set(state => {
      const hasContent = draft.content.trim().length > 0;
      const hasAttachments = draft.attachments.length > 0;
      if (!hasContent && !hasAttachments) {
        const { [sessionId]: _, ...rest } = state.drafts;
        return { drafts: rest };
      }
      return { drafts: { ...state.drafts, [sessionId]: draft } };
    }),

  clearDraft: sessionId =>
    set(state => {
      const { [sessionId]: _, ...rest } = state.drafts;
      return { drafts: rest };
    }),

  setPendingPrefill: (sessionId, content) =>
    set(state => ({
      pendingPrefills: {
        ...state.pendingPrefills,
        [sessionId]: { content, ts: Date.now() },
      },
    })),

  clearPendingPrefill: sessionId =>
    set(state => {
      if (!state.pendingPrefills[sessionId]) return state;
      const { [sessionId]: _, ...rest } = state.pendingPrefills;
      return { pendingPrefills: rest };
    }),
}));

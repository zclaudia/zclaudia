/**
 * LLM profile metadata store — commands, capabilities, and LLM profile list.
 * Extracted from projectStore to separate llm-profile concerns from project/session state.
 *
 * NOTE: internal field/action names (`providersByBackend`, `getProviders`,
 * `providerCommands`, `providerCapabilities`) are retained because the underlying
 * runtime concept of "provider" (the agent runtime adapter) is still wired through
 * `/api/providers/...` routes for commands/capabilities. The store wraps both
 * LLM-profile data and runtime provider metadata.
 */
import { create } from 'zustand';
import type { LlmProfileConfig, ProviderCapabilities, SlashCommand } from '@zclaudia/shared';
import { useServerStore } from './serverStore';

interface LlmProfileMetaState {
  providersByBackend: Record<string, LlmProfileConfig[]>;
  providerCommands: Record<string, SlashCommand[]>;
  providerCapabilities: Record<string, ProviderCapabilities>;

  setProviders: (providers: LlmProfileConfig[], backendId?: string | null) => void;
  getProviders: (backendId?: string | null) => LlmProfileConfig[];
  setProviderCommands: (llmProfileId: string, commands: SlashCommand[]) => void;
  setProviderCapabilities: (llmProfileId: string, capabilities: ProviderCapabilities) => void;
}

const EMPTY_PROVIDERS: LlmProfileConfig[] = [];

function resolveBackendId(backendId?: string | null): string | null {
  if (backendId) return backendId;
  const getState = (useServerStore as { getState?: () => { activeServerId?: string | null } }).getState;
  return getState?.().activeServerId ?? null;
}

export const useLlmProfileMetaStore = create<LlmProfileMetaState>((set, get) => ({
  providersByBackend: {},
  providerCommands: {},
  providerCapabilities: {},

  setProviders: (providers, backendId) => set((state) => {
    const resolvedBackendId = resolveBackendId(backendId);
    if (!resolvedBackendId) return state;
    return {
      providersByBackend: {
        ...state.providersByBackend,
        [resolvedBackendId]: providers,
      },
    };
  }),

  getProviders: (backendId) => {
    const resolvedBackendId = resolveBackendId(backendId);
    if (!resolvedBackendId) return EMPTY_PROVIDERS;
    return get().providersByBackend[resolvedBackendId] ?? EMPTY_PROVIDERS;
  },

  setProviderCommands: (llmProfileId, commands) =>
    set((state) => ({
      providerCommands: {
        ...state.providerCommands,
        [llmProfileId]: commands,
      },
    })),

  setProviderCapabilities: (llmProfileId, capabilities) =>
    set((state) => ({
      providerCapabilities: {
        ...state.providerCapabilities,
        [llmProfileId]: capabilities,
      },
    })),
}));

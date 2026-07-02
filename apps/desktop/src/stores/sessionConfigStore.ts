import { create } from 'zustand';
import type { SystemInfo, UsageInfo, ContextWindowSource } from '@zclaudia/shared';

export interface CompactionNotice {
  sessionId: string;
  reason: string;
  breakerOpen: boolean;
  nextRetryAtMs?: number;
  receivedAt: number;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextWindow?: number;
  /**
   * Which layer in the resolution chain supplied `contextWindow`. Surfaced in
   * the context popover's card footer so users can tell when we're guessing
   * (fallback) vs reading from their LLM profile / pi-ai registry.
   */
  contextWindowSource?: ContextWindowSource;
  /**
   * When `contextWindowSource === 'pi_ai_registry'`, the pi-ai provider id
   * whose registry entry matched. `undefined` on same-provider hits. Carried
   * for completeness; the indicator no longer surfaces the provider name.
   */
  contextWindowMatchedProvider?: string;
  latestInputTokens?: number;
  latestOutputTokens?: number;
  latestCacheReadTokens?: number;
  latestCacheWriteTokens?: number;
  contextUsedTokens?: number;
}

interface SessionConfigState {
  systemInfoBySession: Record<string, SystemInfo>;
  modeBySession: Record<string, string>;
  runtimeModes: Record<string, string>;
  sessionUsage: Record<string, SessionUsage>;
  compactionNotice: Record<string, CompactionNotice>;

  setSystemInfo: (sessionId: string, info: SystemInfo) => void;
  clearSystemInfo: (sessionId: string) => void;
  getSystemInfo: (sessionId: string) => SystemInfo | null;

  setMode: (sessionId: string, mode: string) => void;
  getMode: (sessionId: string) => string;
  setRuntimeMode: (sessionId: string, mode: string) => void;
  getRuntimeMode: (sessionId: string) => string;
  clearRuntimeMode: (sessionId: string) => void;

  addSessionUsage: (sessionId: string, usage: UsageInfo) => void;
  clearSessionUsage: (sessionId: string) => void;

  setCompactionNotice: (sessionId: string, notice: CompactionNotice) => void;
  clearCompactionNotice: (sessionId: string) => void;
}

export const useSessionConfigStore = create<SessionConfigState>((set, get) => ({
  systemInfoBySession: {},
  modeBySession: {},
  runtimeModes: {},
  sessionUsage: {},
  compactionNotice: {},

  // System info actions
  setSystemInfo: (sessionId, info) =>
    set(state => {
      const usageNext = { ...state.sessionUsage };
      if (typeof info.contextWindow === 'number' && info.contextWindow > 0) {
        const existing = usageNext[sessionId];
        if (existing) {
          usageNext[sessionId] = {
            ...existing,
            contextWindow: info.contextWindow,
            contextWindowSource: info.contextWindowSource,
            contextWindowMatchedProvider: info.contextWindowMatchedProvider,
          };
        } else {
          usageNext[sessionId] = {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: info.contextWindow,
            contextWindowSource: info.contextWindowSource,
            contextWindowMatchedProvider: info.contextWindowMatchedProvider,
          };
        }
      }
      return {
        systemInfoBySession: { ...state.systemInfoBySession, [sessionId]: info },
        sessionUsage: usageNext,
      };
    }),
  clearSystemInfo: sessionId =>
    set(state => {
      const { [sessionId]: _, ...rest } = state.systemInfoBySession;
      return { systemInfoBySession: rest };
    }),
  getSystemInfo: sessionId => get().systemInfoBySession[sessionId] || null,

  // Mode actions (per session). Default getMode returns '' so ModeSelector
  // can fall back to capabilities.defaultModeId when no override is set.
  setMode: (sessionId, mode) =>
    set(state => ({
      modeBySession: { ...state.modeBySession, [sessionId]: mode },
    })),
  getMode: sessionId => get().modeBySession[sessionId] ?? '',
  setRuntimeMode: (sessionId, mode) =>
    set(state => ({
      runtimeModes: { ...state.runtimeModes, [sessionId]: mode },
    })),
  getRuntimeMode: sessionId => get().runtimeModes[sessionId] || '',
  clearRuntimeMode: sessionId =>
    set(state => {
      const { [sessionId]: _removedMode, ...remainingRuntimeModes } = state.runtimeModes;
      return { runtimeModes: remainingRuntimeModes };
    }),

  // Usage tracking
  addSessionUsage: (sessionId, usage) =>
    set(state => {
      const existing = state.sessionUsage[sessionId] || {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      return {
        sessionUsage: {
          ...state.sessionUsage,
          [sessionId]: {
            inputTokens: existing.inputTokens + usage.input,
            outputTokens: existing.outputTokens + usage.output,
            cacheReadTokens: (existing.cacheReadTokens ?? 0) + (usage.cacheRead ?? 0),
            cacheWriteTokens: (existing.cacheWriteTokens ?? 0) + (usage.cacheWrite ?? 0),
            contextWindow: existing.contextWindow,
            contextWindowSource: existing.contextWindowSource,
            contextWindowMatchedProvider: existing.contextWindowMatchedProvider,
            latestInputTokens: usage.input,
            latestOutputTokens: usage.output,
            latestCacheReadTokens: usage.cacheRead ?? 0,
            latestCacheWriteTokens: usage.cacheWrite ?? 0,
            contextUsedTokens: usage.contextUsedTokens ?? existing.contextUsedTokens,
          },
        },
      };
    }),
  clearSessionUsage: sessionId =>
    set(state => {
      const { [sessionId]: _, ...rest } = state.sessionUsage;
      return { sessionUsage: rest };
    }),

  setCompactionNotice: (sessionId, notice) =>
    set(state => ({ compactionNotice: { ...state.compactionNotice, [sessionId]: notice } })),

  clearCompactionNotice: sessionId =>
    set(state => {
      const { [sessionId]: _removed, ...rest } = state.compactionNotice;
      return { compactionNotice: rest };
    }),
}));

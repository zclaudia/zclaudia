import { create } from 'zustand';
import type { ContentBlock, RunHealthStatus, ToolEffect, ToolSemantic } from '@zclaudia/shared';
import { useSessionConfigStore } from './sessionConfigStore';
import { useChatMessageStore, findLastAssistantMessageIndex } from './chatMessageStore';

// Tool call state for displaying in the UI
export interface ToolCallState {
  id: string;            // tool_use_id
  toolName: string;
  toolInput: unknown;
  status: 'running' | 'completed' | 'error';
  result?: unknown;
  isError?: boolean;
  activity?: string;     // Subagent activity text (e.g. "Reading file X...")
  /**
   * Provider-declared semantic category (e.g. `'plan_proposal'`). Lets the
   * UI pick a renderer without string-matching provider-specific tool names.
   */
  semantic?: ToolSemantic;
  effect?: ToolEffect;
}

// Run health info from server heartbeat
export interface RunHealth {
  sessionId: string;
  startedAt: number;
  lastActivityAt: number;
  health: RunHealthStatus;
  loopPattern?: string;
}

export interface RunRetryStatus {
  sessionId: string;
  /** Upcoming attempt number (2..maxAttempts). */
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  /** HTTP status that triggered the retry; absent for connection failures. */
  status?: number;
  /** Client-side receipt time, for countdown rendering. */
  receivedAt: number;
}

interface ChatState {
  // Active runs: runId → sessionId (supports concurrent runs)
  activeRuns: Record<string, string>;
  // Background run IDs: runs that should not affect the session's loading state
  backgroundRunIds: Set<string>;
  // Run health info from server heartbeat: runId → RunHealth
  runHealth: Record<string, RunHealth>;
  // Retry status while LLM call is in backoff: runId → RunRetryStatus
  runRetryStatus: Record<string, RunRetryStatus>;
  // Active tool calls per run: runId → { toolUseId → ToolCallState }
  activeToolCalls: Record<string, Record<string, ToolCallState>>;
  // Tool calls history per run: runId → ToolCallState[] (preserves order)
  toolCallsHistory: Record<string, ToolCallState[]>;
  // Content blocks per run: runId → ContentBlock[] (text/tool_use interleaved sequence)
  runContentBlocks: Record<string, ContentBlock[]>;

  // Actions — Run lifecycle
  startRun: (runId: string, sessionId: string, isBackground?: boolean) => void;
  endRun: (runId: string) => void;
  updateRunHealth: (runId: string, health: RunHealth) => void;
  updateRunRetryStatus: (runId: string, status: RunRetryStatus) => void;
  clearRunRetryStatus: (runId: string) => void;

  // Actions — Tool calls (per run)
  addToolCall: (runId: string, toolUseId: string, toolName: string, toolInput: unknown, semantic?: ToolSemantic, effect?: ToolEffect) => void;
  updateToolCallResult: (runId: string, toolUseId: string, result: unknown, isError?: boolean, effect?: ToolEffect) => void;
  updateToolCallActivity: (runId: string, toolUseId: string, activity: string) => void;

  // Actions — Content blocks (per run)
  appendTextBlock: (runId: string, content: string) => void;
  addToolUseBlock: (runId: string, toolUseId: string) => void;

  // Finalize run data onto the assistant message (single atomic update)
  finalizeRunToMessage: (runId: string) => void;

  // Getters
  isSessionLoading: (sessionId: string) => boolean;
  getSessionRunId: (sessionId: string) => string | null;
  getSessionHealth: (sessionId: string) => RunHealth | null;
  getSessionToolCalls: (sessionId: string) => ToolCallState[];
  getSessionContentBlocks: (sessionId: string) => ContentBlock[];
  getSessionToolCallHistory: (sessionId: string) => ToolCallState[];
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeRuns: {},
  backgroundRunIds: new Set<string>(),
  runHealth: {},
  runRetryStatus: {},
  activeToolCalls: {},
  toolCallsHistory: {},
  runContentBlocks: {},

  // ── Run lifecycle ──────────────────────────────────────────────

  startRun: (runId, sessionId, isBackground) => {
    const newBackgroundRunIds = new Set(get().backgroundRunIds);
    if (isBackground) newBackgroundRunIds.add(runId);
    set((state) => ({
      activeRuns: { ...state.activeRuns, [runId]: sessionId },
      backgroundRunIds: newBackgroundRunIds,
      activeToolCalls: { ...state.activeToolCalls, [runId]: {} },
      toolCallsHistory: { ...state.toolCallsHistory, [runId]: [] },
      runContentBlocks: { ...state.runContentBlocks, [runId]: [] },
    }));
  },

  endRun: (runId) => {
    const sessionId = useChatStore.getState().activeRuns[runId];
    set((state) => {
      const { [runId]: _removedRun, ...remainingRuns } = state.activeRuns;
      const { [runId]: _removedTC, ...remainingTC } = state.activeToolCalls;
      const { [runId]: _removedHist, ...remainingHist } = state.toolCallsHistory;
      const { [runId]: _removedCB, ...remainingCB } = state.runContentBlocks;
      const { [runId]: _removedHealth, ...remainingHealth } = state.runHealth;
      const { [runId]: _removedRetry, ...remainingRetry } = state.runRetryStatus;
      const newBackgroundRunIds = new Set(state.backgroundRunIds);
      newBackgroundRunIds.delete(runId);
      return {
        activeRuns: remainingRuns,
        backgroundRunIds: newBackgroundRunIds,
        activeToolCalls: remainingTC,
        toolCallsHistory: remainingHist,
        runContentBlocks: remainingCB,
        runHealth: remainingHealth,
        runRetryStatus: remainingRetry,
      };
    });
    if (sessionId) useSessionConfigStore.getState().clearRuntimeMode(sessionId);
  },

  updateRunHealth: (runId, health) =>
    set((state) => {
      const existing = state.runHealth[runId];
      if (existing
        && existing.health === health.health
        && existing.lastActivityAt === health.lastActivityAt
        && existing.loopPattern === health.loopPattern
      ) {
        return state;
      }
      return { runHealth: { ...state.runHealth, [runId]: health } };
    }),

  updateRunRetryStatus: (runId, status) =>
    set((state) => ({ runRetryStatus: { ...state.runRetryStatus, [runId]: status } })),

  clearRunRetryStatus: (runId) =>
    set((state) => {
      if (!state.runRetryStatus[runId]) return state;
      const { [runId]: _removed, ...rest } = state.runRetryStatus;
      return { runRetryStatus: rest };
    }),

  // ── Tool call actions (per run) ────────────────────────────────

  addToolCall: (runId, toolUseId, toolName, toolInput, semantic, effect) =>
    set((state) => {
      const newToolCall: ToolCallState = {
        id: toolUseId,
        toolName,
        toolInput,
        status: 'running',
        semantic,
        effect,
      };
      const runToolCalls = state.activeToolCalls[runId] || {};
      const runHistory = state.toolCallsHistory[runId] || [];
      // Business idempotency: skip push if toolUseId already in history
      const alreadyInHistory = runHistory.some(tc => tc.id === toolUseId);
      return {
        activeToolCalls: {
          ...state.activeToolCalls,
          [runId]: { ...runToolCalls, [toolUseId]: newToolCall },
        },
        toolCallsHistory: {
          ...state.toolCallsHistory,
          [runId]: alreadyInHistory ? runHistory : [...runHistory, newToolCall],
        },
      };
    }),

  updateToolCallResult: (runId, toolUseId, result, isError, effect) =>
    set((state) => {
      const runToolCalls = state.activeToolCalls[runId];
      if (!runToolCalls) return state;
      const existing = runToolCalls[toolUseId];
      if (!existing) return state;
      // Business idempotency: skip if already completed/error
      if (existing.status === 'completed' || existing.status === 'error') return state;

      const updatedToolCall = {
        ...existing,
        status: isError ? 'error' as const : 'completed' as const,
        result,
        isError,
        effect: effect ?? existing.effect,
      };

      const runHistory = state.toolCallsHistory[runId] || [];
      return {
        activeToolCalls: {
          ...state.activeToolCalls,
          [runId]: { ...runToolCalls, [toolUseId]: updatedToolCall },
        },
        toolCallsHistory: {
          ...state.toolCallsHistory,
          [runId]: runHistory.map(tc => tc.id === toolUseId ? updatedToolCall : tc),
        },
      };
    }),

  updateToolCallActivity: (runId, toolUseId, activity) =>
    set((state) => {
      const runToolCalls = state.activeToolCalls[runId];
      if (!runToolCalls) return state;
      const existing = runToolCalls[toolUseId];
      if (!existing || existing.status !== 'running') return state;

      const updated = { ...existing, activity };
      const runHistory = state.toolCallsHistory[runId] || [];
      return {
        activeToolCalls: {
          ...state.activeToolCalls,
          [runId]: { ...runToolCalls, [toolUseId]: updated },
        },
        toolCallsHistory: {
          ...state.toolCallsHistory,
          [runId]: runHistory.map(tc => tc.id === toolUseId ? updated : tc),
        },
      };
    }),

  // ── Content block actions (per run) ──────────────────────────

  appendTextBlock: (runId, content) =>
    set((state) => {
      const blocks = state.runContentBlocks[runId] || [];
      const lastBlock = blocks[blocks.length - 1];
      let updatedBlocks: ContentBlock[];
      if (lastBlock && lastBlock.type === 'text') {
        updatedBlocks = [...blocks.slice(0, -1), { type: 'text', content: lastBlock.content + content }];
      } else {
        updatedBlocks = [...blocks, { type: 'text', content }];
      }
      return {
        runContentBlocks: { ...state.runContentBlocks, [runId]: updatedBlocks },
      };
    }),

  addToolUseBlock: (runId, toolUseId) =>
    set((state) => {
      const blocks = state.runContentBlocks[runId] || [];
      // Business idempotency: skip if toolUseId already in content blocks
      if (blocks.some(b => b.type === 'tool_use' && b.toolUseId === toolUseId)) {
        return state;
      }
      return {
        runContentBlocks: {
          ...state.runContentBlocks,
          [runId]: [...blocks, { type: 'tool_use', toolUseId }],
        },
      };
    }),

  // Finalize run data (tool calls + content blocks) onto the assistant message in one atomic update.
  // Prefers existing data when it's more complete (e.g., from API/metadata loaded before mid-stream join).
  finalizeRunToMessage: (runId) => {
    const runState = useChatStore.getState();
    const sessionId = runState.activeRuns[runId];
    if (!sessionId) return;
    const runHistory = runState.toolCallsHistory[runId] || [];
    const blocks = runState.runContentBlocks[runId] || [];
    useChatMessageStore.setState((state) => {
      const sessionMessages = state.messages[sessionId] || [];
      if (sessionMessages.length === 0) return state;
      const assistantIdx = findLastAssistantMessageIndex(sessionMessages);
      if (assistantIdx === -1) return state;
      const assistantMessage = sessionMessages[assistantIdx];
      const existingToolCalls = assistantMessage.toolCalls || [];
      const toolCalls = runHistory.length >= existingToolCalls.length ? [...runHistory] : existingToolCalls;
      const existingBlocks = assistantMessage.contentBlocks || [];
      const contentBlocks = blocks.length >= existingBlocks.length ? [...blocks] : existingBlocks;
      const updatedMessages = [
        ...sessionMessages.slice(0, assistantIdx),
        { ...assistantMessage, toolCalls, contentBlocks },
        ...sessionMessages.slice(assistantIdx + 1),
      ];
      return { messages: { ...state.messages, [sessionId]: updatedMessages } };
    });
  },

  isSessionLoading: (sessionId) => {
    const { activeRuns, backgroundRunIds } = get();
    return Object.entries(activeRuns).some(
      ([runId, sid]) => sid === sessionId && !backgroundRunIds.has(runId)
    );
  },

  getSessionRunId: (sessionId) => {
    const { activeRuns } = get();
    for (const [runId, sid] of Object.entries(activeRuns)) {
      if (sid === sessionId) return runId;
    }
    return null;
  },

  getSessionHealth: (sessionId) => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return null;
    return state.runHealth[runId] || null;
  },

  getSessionToolCalls: (sessionId) => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return [];
    return Object.values(state.activeToolCalls[runId] || {});
  },

  getSessionContentBlocks: (sessionId) => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return [];
    return state.runContentBlocks[runId] || [];
  },

  getSessionToolCallHistory: (sessionId) => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return [];
    return state.toolCallsHistory[runId] || [];
  },
}));

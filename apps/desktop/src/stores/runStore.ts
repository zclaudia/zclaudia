import { create } from 'zustand';
import type { ContentBlock, RunHealthStatus, ToolEffect, ToolSemantic } from '@zclaudia/shared';
import type {
  AssistantTurnItem,
  ToolCallView,
  TranscriptEvent,
  TranscriptState,
} from '@zclaudia/agent-transcript-kit';
import {
  applyTranscriptEvent,
  initialTranscriptState,
  orderedToolCalls,
} from '@zclaudia/agent-transcript-kit';
import { useSessionConfigStore } from './sessionConfigStore';
import { useChatMessageStore, findLastAssistantMessageIndex } from './chatMessageStore';

// Tool call state for displaying in the UI
export interface ToolCallState {
  id: string; // tool_use_id
  toolName: string;
  toolInput: unknown;
  status: 'running' | 'completed' | 'error';
  result?: unknown;
  isError?: boolean;
  activity?: string; // Subagent activity text (e.g. "Reading file X...")
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

interface RunState {
  // Active runs: runId → sessionId (supports concurrent runs)
  activeRuns: Record<string, string>;
  // Run → persisted assistant row. Terminal events must update this exact row.
  assistantMessageIds: Record<string, string>;
  // Background run IDs: runs that should not affect the session's loading state
  backgroundRunIds: Set<string>;
  // Run health info from server heartbeat: runId → RunHealth
  runHealth: Record<string, RunHealth>;
  // Retry status while LLM call is in backoff: runId → RunRetryStatus
  runRetryStatus: Record<string, RunRetryStatus>;
  /**
   * Per-run transcript source of truth (@zclaudia/agent-transcript-kit): one
   * single-turn TranscriptState per run, turnId = runId. The three fields
   * below are projections of it and must not be mutated directly.
   */
  runTranscripts: Record<string, TranscriptState>;
  /** ToolEffect has no kit slot yet; carried host-side and merged in projection. */
  runToolEffects: Record<string, Record<string, ToolEffect>>;
  // Active tool calls per run (projected): runId → { toolUseId → ToolCallState }
  activeToolCalls: Record<string, Record<string, ToolCallState>>;
  // Tool calls history per run (projected): runId → ToolCallState[] (block order)
  toolCallsHistory: Record<string, ToolCallState[]>;
  // Content blocks per run (projected): runId → ContentBlock[] (text/tool_use interleaved)
  runContentBlocks: Record<string, ContentBlock[]>;

  // Actions — Run lifecycle
  startRun: (
    runId: string,
    sessionId: string,
    isBackground?: boolean,
    assistantMessageId?: string
  ) => void;
  endRun: (runId: string) => void;
  updateRunHealth: (runId: string, health: RunHealth) => void;
  updateRunRetryStatus: (runId: string, status: RunRetryStatus) => void;
  clearRunRetryStatus: (runId: string) => void;

  // Actions — Tool calls (per run)
  addToolCall: (
    runId: string,
    toolUseId: string,
    toolName: string,
    toolInput: unknown,
    semantic?: ToolSemantic,
    effect?: ToolEffect
  ) => void;
  updateToolCallResult: (
    runId: string,
    toolUseId: string,
    result: unknown,
    isError?: boolean,
    effect?: ToolEffect
  ) => void;
  updateToolCallActivity: (runId: string, toolUseId: string, activity: string) => void;

  // Actions — Content blocks (per run)
  appendTextBlock: (runId: string, content: string) => void;
  addToolUseBlock: (runId: string, toolUseId: string) => void;

  // Finalize run data onto the assistant message (single atomic update).
  // `final` is the server-authoritative content from run_completed; when
  // present it wins over locally accumulated deltas (which may have lost a
  // tail frame in transit). `final.sessionId` lets the terminal event apply
  // even when run tracking was already torn down (e.g. by a heartbeat that
  // raced ahead of run_completed).
  finalizeRunToMessage: (
    runId: string,
    final?: {
      sessionId?: string;
      assistantMessageId?: string;
      messageVersion?: number;
      content?: string;
      contentBlocks?: ContentBlock[];
      error?: string;
    }
  ) => void;

  // Getters
  isSessionLoading: (sessionId: string) => boolean;
  getSessionRunId: (sessionId: string) => string | null;
  getSessionHealth: (sessionId: string) => RunHealth | null;
  getSessionToolCalls: (sessionId: string) => ToolCallState[];
  getSessionContentBlocks: (sessionId: string) => ContentBlock[];
  getSessionToolCallHistory: (sessionId: string) => ToolCallState[];
}

// ── Kit transcript projection ─────────────────────────────────────

function runTurn(transcript: TranscriptState, runId: string): AssistantTurnItem | undefined {
  const item = transcript.items.find(entry => entry.kind === 'assistant_turn' && entry.id === runId);
  return item as AssistantTurnItem | undefined;
}

function toToolCallState(
  tool: ToolCallView,
  effects: Record<string, ToolEffect> | undefined
): ToolCallState {
  return {
    id: tool.id,
    toolName: tool.name,
    toolInput: tool.input,
    // The store never grew a 'cancelled' status; kit-cancelled projects as error.
    status:
      tool.status === 'running' ? 'running' : tool.status === 'success' ? 'completed' : 'error',
    result: tool.result,
    isError: tool.status === 'error' ? true : undefined,
    activity: tool.summary,
    semantic: tool.semantic as ToolSemantic | undefined,
    effect: effects?.[tool.id],
  };
}

function projectBlocks(turn: AssistantTurnItem | undefined): ContentBlock[] {
  if (!turn) return [];
  return turn.blocks.map(block =>
    block.kind === 'text'
      ? { type: 'text' as const, content: block.text }
      : block.kind === 'thinking'
        ? {
            type: 'thinking' as const,
            content: block.text,
            ...(block.signature !== undefined ? { signature: block.signature } : {}),
          }
        : { type: 'tool_use' as const, toolUseId: block.toolCallId }
  );
}

/**
 * Fold kit events into the run's transcript and refresh the projected
 * blocks/tool-call fields. Returns {} (no update) when the reducer no-ops,
 * so replayed duplicates keep referential equality for selectors.
 */
function applyRunEvents(
  state: RunState,
  runId: string,
  events: TranscriptEvent[],
  effects?: Record<string, Record<string, ToolEffect>>
): Partial<RunState> {
  const previous = state.runTranscripts[runId] ?? initialTranscriptState;
  const transcript = events.reduce(
    (current, event) => applyTranscriptEvent(current, event),
    previous
  );
  const nextEffects = effects ?? state.runToolEffects;
  if (transcript === previous && nextEffects === state.runToolEffects) return {};
  const turn = runTurn(transcript, runId);
  const history = turn
    ? orderedToolCalls(turn).map(tool => toToolCallState(tool, nextEffects[runId]))
    : [];
  return {
    runTranscripts: { ...state.runTranscripts, [runId]: transcript },
    runToolEffects: nextEffects,
    runContentBlocks: { ...state.runContentBlocks, [runId]: projectBlocks(turn) },
    activeToolCalls: {
      ...state.activeToolCalls,
      [runId]: Object.fromEntries(history.map(tool => [tool.id, tool])),
    },
    toolCallsHistory: { ...state.toolCallsHistory, [runId]: history },
  };
}

export const useRunStore = create<RunState>((set, get) => ({
  activeRuns: {},
  assistantMessageIds: {},
  backgroundRunIds: new Set<string>(),
  runHealth: {},
  runRetryStatus: {},
  runTranscripts: {},
  runToolEffects: {},
  activeToolCalls: {},
  toolCallsHistory: {},
  runContentBlocks: {},

  // ── Run lifecycle ──────────────────────────────────────────────

  startRun: (runId, sessionId, isBackground, assistantMessageId) => {
    const newBackgroundRunIds = new Set(get().backgroundRunIds);
    if (isBackground) newBackgroundRunIds.add(runId);
    // A (re)start resets the run's buckets, matching the pre-kit behavior:
    // stale-seq replays are filtered before reaching the store, so a fresh
    // run_started means a genuinely fresh accumulation.
    const transcript = applyTranscriptEvent(initialTranscriptState, {
      type: 'turn_started',
      turnId: runId,
    });
    set(state => ({
      activeRuns: { ...state.activeRuns, [runId]: sessionId },
      assistantMessageIds: assistantMessageId
        ? { ...state.assistantMessageIds, [runId]: assistantMessageId }
        : state.assistantMessageIds,
      backgroundRunIds: newBackgroundRunIds,
      runTranscripts: { ...state.runTranscripts, [runId]: transcript },
      runToolEffects: { ...state.runToolEffects, [runId]: {} },
      activeToolCalls: { ...state.activeToolCalls, [runId]: {} },
      toolCallsHistory: { ...state.toolCallsHistory, [runId]: [] },
      runContentBlocks: { ...state.runContentBlocks, [runId]: [] },
    }));
  },

  endRun: runId => {
    const sessionId = get().activeRuns[runId];
    set(state => {
      const { [runId]: _removedRun, ...remainingRuns } = state.activeRuns;
      const { [runId]: _removedMessageId, ...remainingMessageIds } = state.assistantMessageIds;
      const { [runId]: _removedTranscript, ...remainingTranscripts } = state.runTranscripts;
      const { [runId]: _removedEffects, ...remainingEffects } = state.runToolEffects;
      const { [runId]: _removedTC, ...remainingTC } = state.activeToolCalls;
      const { [runId]: _removedHist, ...remainingHist } = state.toolCallsHistory;
      const { [runId]: _removedCB, ...remainingCB } = state.runContentBlocks;
      const { [runId]: _removedHealth, ...remainingHealth } = state.runHealth;
      const { [runId]: _removedRetry, ...remainingRetry } = state.runRetryStatus;
      const newBackgroundRunIds = new Set(state.backgroundRunIds);
      newBackgroundRunIds.delete(runId);
      return {
        activeRuns: remainingRuns,
        assistantMessageIds: remainingMessageIds,
        backgroundRunIds: newBackgroundRunIds,
        runTranscripts: remainingTranscripts,
        runToolEffects: remainingEffects,
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
    set(state => {
      const existing = state.runHealth[runId];
      if (
        existing &&
        existing.health === health.health &&
        existing.lastActivityAt === health.lastActivityAt &&
        existing.loopPattern === health.loopPattern
      ) {
        return state;
      }
      return { runHealth: { ...state.runHealth, [runId]: health } };
    }),

  updateRunRetryStatus: (runId, status) =>
    set(state => ({ runRetryStatus: { ...state.runRetryStatus, [runId]: status } })),

  clearRunRetryStatus: runId =>
    set(state => {
      if (!state.runRetryStatus[runId]) return state;
      const { [runId]: _removed, ...rest } = state.runRetryStatus;
      return { runRetryStatus: rest };
    }),

  // ── Tool call actions (per run) ────────────────────────────────

  addToolCall: (runId, toolUseId, toolName, toolInput, semantic, effect) =>
    set(state => {
      const effects = effect
        ? {
            ...state.runToolEffects,
            [runId]: { ...state.runToolEffects[runId], [toolUseId]: effect },
          }
        : undefined;
      return applyRunEvents(
        state,
        runId,
        [
          {
            type: 'tool_started',
            turnId: runId,
            toolCallId: toolUseId,
            name: toolName,
            input: toolInput,
            semantic,
          },
        ],
        effects
      );
    }),

  updateToolCallResult: (runId, toolUseId, result, isError, effect) =>
    set(state => {
      // Business idempotency (first-wins, unlike the kit's latest-wins): the
      // result is ignored for unknown tools and for already-terminal ones.
      const existing = state.activeToolCalls[runId]?.[toolUseId];
      if (!existing || existing.status !== 'running') return state;
      const effects = effect
        ? {
            ...state.runToolEffects,
            [runId]: { ...state.runToolEffects[runId], [toolUseId]: effect },
          }
        : undefined;
      return applyRunEvents(
        state,
        runId,
        [
          {
            type: 'tool_finished',
            turnId: runId,
            toolCallId: toolUseId,
            result,
            isError,
          },
        ],
        effects
      );
    }),

  updateToolCallActivity: (runId, toolUseId, activity) =>
    set(state => {
      // Activity is a live progress line; ignore it for tools that are not
      // (or no longer) running, matching the pre-kit behavior.
      const existing = state.activeToolCalls[runId]?.[toolUseId];
      if (!existing || existing.status !== 'running') return state;
      return applyRunEvents(state, runId, [
        { type: 'tool_activity', turnId: runId, toolCallId: toolUseId, summary: activity },
      ]);
    }),

  // ── Content block actions (per run) ──────────────────────────

  appendTextBlock: (runId, content) =>
    set(state =>
      applyRunEvents(state, runId, [{ type: 'text_delta', turnId: runId, delta: content }])
    ),

  addToolUseBlock: (runId, toolUseId) =>
    set(state =>
      // tool_started both registers the tool and appends its block; when
      // addToolCall already ran (the normal order) this is a strict no-op.
      applyRunEvents(state, runId, [
        { type: 'tool_started', turnId: runId, toolCallId: toolUseId, name: '' },
      ])
    ),

  // Finalize run data (tool calls + content blocks) onto the assistant message in one atomic update.
  // Prefers existing data when it's more complete (e.g., from API/metadata loaded before mid-stream join).
  finalizeRunToMessage: (runId, final) => {
    const trackedSessionId = get().activeRuns[runId];
    const sessionId = trackedSessionId ?? final?.sessionId;
    if (!sessionId) return;
    const assistantMessageId = final?.assistantMessageId ?? get().assistantMessageIds[runId];
    const runHistory = get().toolCallsHistory[runId] || [];
    const blocks = get().runContentBlocks[runId] || [];
    useChatMessageStore.setState(state => {
      const sessionMessages = state.messages[sessionId] || [];
      if (sessionMessages.length === 0) return state;
      // Legacy events without an assistantMessageId may only use the old
      // last-assistant fallback while the run is still actively tracked. A
      // late terminal event for an old run must never overwrite a newer run.
      const assistantIdx = assistantMessageId
        ? sessionMessages.findIndex(message => message.id === assistantMessageId)
        : trackedSessionId
          ? findLastAssistantMessageIndex(sessionMessages)
          : -1;
      if (assistantIdx === -1) return state;
      const assistantMessage = sessionMessages[assistantIdx];
      const existingToolCalls = assistantMessage.toolCalls || [];
      const toolCalls =
        runHistory.length >= existingToolCalls.length ? [...runHistory] : existingToolCalls;
      const existingBlocks = assistantMessage.contentBlocks || [];
      const contentBlocks = final?.contentBlocks?.length
        ? [...final.contentBlocks]
        : blocks.length >= existingBlocks.length
          ? [...blocks]
          : existingBlocks;
      let content = final?.content !== undefined ? final.content : assistantMessage.content;
      if (final?.error && !content.includes(`**Error:** ${final.error}`)) {
        content += `\n\n**Error:** ${final.error}`;
      }
      const updatedMessages = [
        ...sessionMessages.slice(0, assistantIdx),
        { ...assistantMessage, content, toolCalls, contentBlocks },
        ...sessionMessages.slice(assistantIdx + 1),
      ];
      const existingPagination = state.pagination[sessionId];
      const pagination =
        final?.messageVersion != null
          ? {
              ...state.pagination,
              [sessionId]: {
                ...(existingPagination ?? { total: sessionMessages.length, hasMore: false }),
                messageVersion: Math.max(
                  final.messageVersion,
                  existingPagination?.messageVersion ?? 0
                ),
                isLoadingMore: false,
              },
            }
          : state.pagination;
      return { messages: { ...state.messages, [sessionId]: updatedMessages }, pagination };
    });
  },

  isSessionLoading: sessionId => {
    const { activeRuns, backgroundRunIds } = get();
    return Object.entries(activeRuns).some(
      ([runId, sid]) => sid === sessionId && !backgroundRunIds.has(runId)
    );
  },

  getSessionRunId: sessionId => {
    const { activeRuns } = get();
    for (const [runId, sid] of Object.entries(activeRuns)) {
      if (sid === sessionId) return runId;
    }
    return null;
  },

  getSessionHealth: sessionId => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return null;
    return state.runHealth[runId] || null;
  },

  getSessionToolCalls: sessionId => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return [];
    return Object.values(state.activeToolCalls[runId] || {});
  },

  getSessionContentBlocks: sessionId => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return [];
    return state.runContentBlocks[runId] || [];
  },

  getSessionToolCallHistory: sessionId => {
    const state = get();
    const runId = state.getSessionRunId(sessionId);
    if (!runId) return [];
    return state.toolCallsHistory[runId] || [];
  },
}));

import { useMemo } from 'react';
import { useRunStore, type ToolCallState } from '../../stores/runStore';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { useSessionConfigStore } from '../../stores/sessionConfigStore';
import { useSessionOverridesStore } from '../../stores/sessionOverridesStore';
import { useProjectStore } from '../../stores/projectStore';
import { useLlmProfileMetaStore } from '../../stores/llmProfileMetaStore';
import { useServerStore } from '../../stores/serverStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useProviderCapabilities } from './useProviderCapabilities';
import type { MessageWithToolCalls } from '../../stores/chatMessageStore';
import type { ContentBlock } from '@zclaudia/shared';

const EMPTY_MESSAGES: MessageWithToolCalls[] = [];
const EMPTY_TOOL_CALLS: ToolCallState[] = [];
const EMPTY_CONTENT_BLOCKS: ContentBlock[] = [];

interface UseChatSessionParams {
  sessionId: string;
  isConnected: boolean;
}

export function useChatSession({ sessionId, isConnected }: UseChatSessionParams) {
  // ── Session-scoped store selectors ──
  const sessionMessages = useChatMessageStore((s) => s.messages[sessionId] || EMPTY_MESSAGES);
  const sessionRunId = useRunStore((s) => s.getSessionRunId(sessionId));
  const isSessionRunning = useRunStore((s) => {
    return Object.values(s.activeRuns).some((sid) => sid === sessionId);
  });
  const isLoading = useRunStore((s) => {
    const { activeRuns, backgroundRunIds } = s;
    return Object.entries(activeRuns).some(([runId, sid]) => sid === sessionId && !backgroundRunIds.has(runId));
  });
  const sessionHealth = useRunStore((s) => s.getSessionHealth(sessionId));
  const sessionRetryStatus = useRunStore((s) => {
    const runId = s.getSessionRunId(sessionId);
    if (!runId) return null;
    return s.runRetryStatus[runId] || null;
  });
  const sessionToolCallsRecord = useRunStore((s) => {
    const runId = s.getSessionRunId(sessionId);
    if (!runId) return null;
    return s.activeToolCalls[runId] || null;
  });
  const sessionToolCalls = useMemo(
    () => (sessionToolCallsRecord ? Object.values(sessionToolCallsRecord) : EMPTY_TOOL_CALLS),
    [sessionToolCallsRecord]
  );
  const sessionContentBlocks = useRunStore((s) => {
    const runId = s.getSessionRunId(sessionId);
    if (!runId) return EMPTY_CONTENT_BLOCKS;
    return s.runContentBlocks[runId] || EMPTY_CONTENT_BLOCKS;
  });
  const sessionToolCallHistory = useRunStore((s) => {
    const runId = s.getSessionRunId(sessionId);
    if (!runId) return EMPTY_TOOL_CALLS;
    return s.toolCallsHistory[runId] || EMPTY_TOOL_CALLS;
  });
  const currentUsage = useSessionConfigStore((s) => s.sessionUsage[sessionId] || null);
  const currentSystemInfo = useSessionConfigStore((s) => s.systemInfoBySession[sessionId] || null);

  // Store actions
  const addMessage = useChatMessageStore((s) => s.addMessage);
  const clearMessages = useChatMessageStore((s) => s.clearMessages);
  const setMode = useSessionConfigStore((s) => s.setMode);
  const selectedMode = useSessionConfigStore((s) => s.modeBySession[sessionId] ?? '');
  const runtimeMode = useSessionConfigStore((s) => s.runtimeModes[sessionId] || '');
  const permissionOverride = useSessionOverridesStore((s) => s.permissionOverrides[sessionId] ?? null);
  const setPermissionOverride = useSessionOverridesStore((s) => s.setPermissionOverride);

  // ── Derived values ──
  const useStreamingSegmented = isLoading && sessionContentBlocks.length > 1 && sessionToolCallHistory.length > 0;

  const lastSessionMessage = sessionMessages.length > 0 ? sessionMessages[sessionMessages.length - 1] : null;
  const lastStreamingBlock = sessionContentBlocks.length > 0
    ? sessionContentBlocks[sessionContentBlocks.length - 1]
    : null;
  const streamingContentSignature = lastStreamingBlock
    ? `${lastStreamingBlock.type}:${lastStreamingBlock.type === 'text' ? lastStreamingBlock.content : 'toolUseId' in lastStreamingBlock ? lastStreamingBlock.toolUseId : ''}`
    : '';

  // ── Project store ──
  const sessions = useProjectStore((s) => s.sessions);
  const projects = useProjectStore((s) => s.projects);
  const legacyProviders = useProjectStore((s) => s.providers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const scopedProviders = useLlmProfileMetaStore((s) => s.getProviders(activeServerId));
  const providers = scopedProviders.length > 0 ? scopedProviders : legacyProviders;

  const currentSession = sessions.find(s => s.id === sessionId);
  const currentProject = currentSession
    ? projects.find(p => p.id === currentSession.projectId) ?? null
    : null;
  const isForcedPlanSession = currentSession?.projectRole === 'task' && currentSession?.planStatus === 'planning';
  // `runtimeMode` reflects provider-side transient state within the current run
  // (for example, Claude calling EnterPlanMode mid-run). Backend mode_change
  // events now also sync to selectedMode (via setMode in messageHandler) so the
  // UI selector stays consistent with the backend's actual mode.
  const effectiveMode = isForcedPlanSession ? 'plan' : selectedMode;
  const usageOrDefault = currentUsage || {
    inputTokens: 0,
    outputTokens: 0,
    latestInputTokens: 0,
    latestOutputTokens: 0,
    contextWindow: undefined,
    contextWindowSource: undefined,
    contextWindowMatchedProvider: undefined,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    latestCacheReadTokens: undefined,
    latestCacheWriteTokens: undefined,
  };
  const fileReferenceRoot = currentSession?.workingDirectory || currentProject?.rootPath;
  const fileReferenceBackendId = useOwnershipStore(
    (s) => currentSession?.projectId ? s.getProjectBackendId(currentSession.projectId) : null,
  );

  // ── Provider capabilities ──
  const { llmProfileId, capabilities, commands, commandsCacheKey } = useProviderCapabilities({ sessionId, isConnected });

  return {
    // Messages & run state
    sessionMessages,
    lastSessionMessage,
    sessionRunId,
    isSessionRunning,
    isLoading,
    sessionHealth,
    sessionRetryStatus,

    // Streaming / tool calls
    sessionToolCalls,
    sessionContentBlocks,
    sessionToolCallHistory,
    useStreamingSegmented,
    lastStreamingBlock,
    streamingContentSignature,

    // Session / project context
    currentSession,
    currentProject,
    providers,
    isForcedPlanSession,
    fileReferenceRoot,
    fileReferenceBackendId,

    // Provider
    llmProfileId,
    capabilities,
    commands,
    commandsCacheKey,

    // Mode / usage
    mode: selectedMode,
    selectedMode,
    runtimeMode,
    effectiveMode,
    permissionOverride,
    currentUsage: usageOrDefault,
    currentSystemInfo,

    // Store actions
    addMessage,
    clearMessages,
    setMode,
    setPermissionOverride,
  };
}

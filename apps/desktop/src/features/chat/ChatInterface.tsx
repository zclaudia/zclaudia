import { useRef, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { ChatActionsProvider, type ChatActionsContextValue } from './ChatActionsContext';
import { AlertTriangle } from 'lucide-react';
import { ChatInputArea } from './ChatInputArea';
import { ChatMessagePane } from './ChatMessagePane';
import { PoppedOutPlaceholder } from './PoppedOutPlaceholder';
import { InterruptedBanner } from './InterruptedBanner';
import { PlanStatusBar } from './PlanStatusBar';
import { SessionHeader } from './SessionHeader';
import { BackgroundTaskPanel } from '../../components/BackgroundTaskPanel';
import { DraftLockPrompt } from '../../components/draft/DraftLockPrompt';
import { TaskCardStrip } from '../supervision/components/TaskCardStrip';
import { forkSession, branchSession } from '../../services/api';
import { useSessionConfigStore } from '../../stores/sessionConfigStore';
import { useComposerStore, type SessionDraft } from '../../stores/composerStore';
import { useServerStore } from '../../stores/serverStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useUIStore } from '../../stores/uiStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useChatSession } from '../../hooks/chat/useChatSession';
import { useSendMessage } from '../../hooks/chat/useSendMessage';
import { useCommandHandler } from '../../hooks/chat/useCommandHandler';
import { useMessagePagination, restoreToolCalls } from '../../hooks/chat/useMessagePagination';
import { useSessionActions } from '../../hooks/chat/useSessionActions';
import { usePlanStatus } from '../../hooks/chat/usePlanStatus';
import { useKeyboardShortcuts } from '../../hooks/chat/useKeyboardShortcuts';
import { useMobileViewport } from '../../hooks/chat/useMobileViewport';
import { useSessionRoute } from '../../hooks/chat/useSessionRoute';
import type { ClientMessage } from '@zclaudia/shared';
import { useProjectStore } from '../../stores/projectStore';
import { useToastStore } from '../../stores/toastStore';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import * as api from '../../services/api';

interface ChatInterfaceProps {
  sessionId: string;
  onReturnToDashboard?: (projectId: string) => void;
  onOpenSidebar?: () => void;
  beforeComposer?: ReactNode;
}

export function ChatInterface({ sessionId, onReturnToDashboard, onOpenSidebar, beforeComposer }: ChatInterfaceProps) {
  const {
    sendMessage: activeServerSendMessage,
    sendToServer,
    handlePermissionDecision,
  } = useConnection();
  const isMobile = useIsMobile();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setDrawerOpen = useTerminalStore((s) => s.setDrawerOpen);
  const advancedInput = useUIStore((s) => s.advancedInput);
  const poppedOutSessions = useUIStore((s) => s.poppedOutSessions);
  const route = useSessionRoute(sessionId);
  const routedBackendId = route.backendId;
  const isConnected = route.canSend;

  const wsSendMessage = useCallback((message: ClientMessage) => {
    if (routedBackendId) {
      sendToServer(routedBackendId, message);
      return;
    }
    activeServerSendMessage(message);
  }, [activeServerSendMessage, routedBackendId, sendToServer]);

  // Draft editor state
  const draftShowLockPrompt = useDraftEditorStore((s) => s.showLockPrompt);
  const draftExists = useDraftEditorStore((s) => s.draftExists[sessionId] ?? false);
  const checkDraftExists = useDraftEditorStore((s) => s.checkDraftExists);

  useEffect(() => {
    checkDraftExists(sessionId);
  }, [sessionId, checkDraftExists]);

  // ── Core hooks ──
  const session = useChatSession({ sessionId, isConnected });
  const {
    sessionMessages, lastSessionMessage, sessionRunId, isSessionRunning, isLoading, sessionHealth, sessionRetryStatus,
    sessionToolCalls, sessionContentBlocks, sessionToolCallHistory, useStreamingSegmented,
    lastStreamingBlock, streamingContentSignature,
    currentSession, currentProject, isForcedPlanSession, fileReferenceRoot, fileReferenceBackendId,
    llmProfileId, capabilities, commands, commandsCacheKey,
    effectiveMode, permissionOverride, currentUsage, currentSystemInfo,
    addMessage, clearMessages, setMode, setPermissionOverride,
  } = session;

  // Mobile viewport management
  const chatRootRef = useRef<HTMLDivElement>(null);
  useMobileViewport(chatRootRef, isMobile);

  // Keyboard shortcuts
  useKeyboardShortcuts({ projectId: currentSession?.projectId, projectRoot: currentProject?.rootPath });

  // Per-session pending permission/question requests — memoize to avoid new array reference each render
  const allPendingRequests = usePermissionStore(state => state.pendingRequests);
  const permissionRequests = useMemo(
    () => allPendingRequests.filter(r => r.sessionId === sessionId || !r.sessionId),
    [allPendingRequests, sessionId],
  );
  // Message pagination & scroll management
  const pagination = useMessagePagination({ sessionId, isConnected, isMobile });
  const { scrollToBottom, resetRefs: resetPaginationRefs } = pagination;

  // Message sending
  const send = useSendMessage({
    sessionId, isConnected, isLoading, sessionRunId, isSessionRunning, lastSessionMessage,
    mode: effectiveMode, permissionOverride, currentSession, addMessage, scrollToBottom, wsSendMessage,
  });
  const {
    handleSendMessage, handleCancelRun, handleResendLastMessage,
    startRun, clearInterruptedStatus,
    restoreMessage, uploadError, resendTargetMessage, resendText, resendChecking,
    resetSendState,
  } = send;

  const chatActionsValue = useMemo<ChatActionsContextValue>(() => ({
    handleSendMessage,
    setMode: useSessionConfigStore.getState().setMode,
  }), [handleSendMessage]);

  // UI state
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [isRenamingSession, setIsRenamingSession] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [initialDraft, setInitialDraft] = useState<SessionDraft | undefined>(undefined);

  // Reset per-session ephemeral state when switching sessions
  useEffect(() => {
    resetSendState();
    setInitialDraft(useComposerStore.getState().drafts[sessionId]);
    resetPaginationRefs();
    setIsRenamingSession(false);
    setRenameValue('');
  }, [sessionId, resetSendState, resetPaginationRefs]);

  // Task planning sessions are hard-locked to Plan mode.
  useEffect(() => {
    if (isForcedPlanSession && effectiveMode !== 'plan') {
      setMode(sessionId, 'plan');
    }
  }, [isForcedPlanSession, effectiveMode, sessionId, setMode]);

  // Command handler
  const { handleCommand, handleResetProviderSession, handleWorktreeChange } = useCommandHandler({
    sessionId, commands, currentSession, currentProject, isForcedPlanSession,
    mode: effectiveMode, addMessage, clearMessages, scrollToBottom, startRun,
    llmProfileId, commandsCacheKey, setDrawerOpen,
  });

  // Plan status
  const {
    taskPlanStatus, planStatusLoading, submitPlanLoading, discardPlanLoading,
    handleRestorePlan, handleDiscardPlan, handleSubmitPlan,
  } = usePlanStatus({
    sessionId, isConnected, isForcedPlanSession, currentSession,
    currentProjectId: currentProject?.id, messagesLength: sessionMessages.length,
    addMessage, scrollToBottom, handleSendMessage,
  });

  // Session actions
  const {
    handleSessionRename, handleExportSession, handleArchiveSession,
    handlePopOut, handleFocusPoppedOutWindow, handleBringBackHere,
  } = useSessionActions({
    sessionId, isConnected, currentSession, currentProject,
    activeServerId, renameValue, setIsRenamingSession, isSessionRunning,
  });

  const poppedOutLabel = poppedOutSessions.get(sessionId);

  // ── SP-A fork/branch handlers ──

  const handleFork = useCallback(async (treeEntryId: string) => {
    const name = window.prompt('Name for the forked session (leave blank for auto):')?.trim() || undefined;
    try {
      const newSession = await forkSession(sessionId, treeEntryId, name);
      // Register the new session in the project store and switch to it
      useProjectStore.getState().addSession(newSession);
      useProjectStore.getState().selectSession(newSession.id, newSession.projectId);
      useToastStore.getState().add({
        title: 'Session forked',
        message: newSession.name || 'New session created from this point',
        type: 'success',
        sessionId: newSession.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      useToastStore.getState().add({ title: 'Fork failed', message: msg, type: 'error', icon: 'error' });
      console.error('[ChatInterface] fork failed:', err);
    }
  }, [sessionId]);

  const handleBranch = useCallback(async (treeEntryId: string) => {
    const confirmed = window.confirm(
      'Branch from here (rewind)?\n\nThis rewinds the conversation to this point and rewrites the timeline. The old branch is kept and can be returned to.'
    );
    if (!confirmed) return;
    try {
      await branchSession(sessionId, treeEntryId);
      // Reload messages for this session (full replace) — mirrors the initial-load path in useMessagePagination
      const result = await api.getSessionMessages(sessionId, { limit: 50 });
      const restoredMessages = restoreToolCalls(result.messages);
      useChatMessageStore.getState().setMessages(sessionId, restoredMessages, result.pagination);
      useToastStore.getState().add({
        title: 'Session rewound',
        message: 'The conversation has been branched from this point.',
        type: 'success',
        sessionId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      useToastStore.getState().add({ title: 'Branch failed', message: msg, type: 'error', icon: 'error' });
      console.error('[ChatInterface] branch failed:', err);
    }
  }, [sessionId]);

  // Brand-new session with no messages and nothing running: center the composer
  // in the viewport (Cursor-style) instead of pinning it to the bottom.
  const isEmptySession =
    !!currentSession &&
    !currentSession.isReadOnly &&
    pagination.initialLoadDone &&
    sessionMessages.length === 0 &&
    permissionRequests.length === 0 &&
    !isLoading;

  return (
    <ChatActionsProvider value={chatActionsValue}>
    <div ref={chatRootRef} className="flex flex-col flex-1 min-w-0 h-full bg-background">
      {/* Popped-out placeholder */}
      {poppedOutLabel && (
        <PoppedOutPlaceholder
          label={poppedOutLabel}
          onFocus={handleFocusPoppedOutWindow}
          onBringBack={handleBringBackHere}
        />
      )}
      {!poppedOutLabel && <>
      {/* Task card strip for supervisor main session */}
      {currentSession?.projectRole === 'main' && currentProject?.id && (
        <TaskCardStrip projectId={currentProject.id} />
      )}

      {/* Interrupted session banner */}
      {currentSession?.lastRunStatus === 'interrupted' && (
        <InterruptedBanner
          onResume={async () => {
            await startRun({
              type: 'run_start',
              clientRequestId: crypto.randomUUID(),
              sessionId,
              input: 'continue',
              mode: effectiveMode || undefined,
              workingDirectory: currentSession?.workingDirectory || undefined,
            });
          }}
          onDismiss={async () => {
            try { await clearInterruptedStatus(); } catch {
              // Ignore transient backend errors while dismissing the local banner.
            }
          }}
        />
      )}

      {/* Session action bar */}
      {currentSession && (
        <SessionHeader
          currentSession={currentSession}
          currentProject={currentProject}
          isMobile={isMobile}
          isLoading={isLoading}
          isRenamingSession={isRenamingSession}
          renameValue={renameValue}
          showSessionMenu={showSessionMenu}
          onOpenSidebar={onOpenSidebar}
          onReturnToDashboard={onReturnToDashboard}
          onRenameStart={(name) => { setRenameValue(name); setIsRenamingSession(true); }}
          onRenameChange={setRenameValue}
          onRenameConfirm={handleSessionRename}
          onRenameCancel={() => setIsRenamingSession(false)}
          onResetProviderSession={handleResetProviderSession}
          onExport={handleExportSession}
          onArchive={handleArchiveSession}
          archiveDisabled={isSessionRunning}
          onPopOut={handlePopOut}
          onToggleSessionMenu={() => setShowSessionMenu(!showSessionMenu)}
          systemInfo={currentSystemInfo}
          contextPercent={
            currentUsage.contextWindow && currentUsage.contextWindow > 0
              ? Math.min(100, Math.round(((currentUsage.latestInputTokens ?? 0) / currentUsage.contextWindow) * 100))
              : null
          }
        />
      )}

      {/* Plan status indicator */}
      {currentSession?.projectRole === 'task' && currentSession.planStatus === 'planning' && (
        <PlanStatusBar
          taskPlanStatus={taskPlanStatus}
          planStatusLoading={planStatusLoading}
          submitPlanLoading={submitPlanLoading}
          discardPlanLoading={discardPlanLoading}
          isLoading={isLoading}
          onRestorePlan={handleRestorePlan}
          onDiscardPlan={handleDiscardPlan}
          onSubmitPlan={handleSubmitPlan}
        />
      )}

      {/* Messages — memo'd to isolate from input re-renders */}
      <ChatMessagePane
        sessionId={sessionId}
        messagesEndRef={pagination.messagesEndRef}
        messagesContainerRef={pagination.messagesContainerRef}
        initialLoadDone={pagination.initialLoadDone}
        showScrollToBottom={pagination.showScrollToBottom}
        scrollMetrics={pagination.scrollMetrics}
        highlightedMessageId={pagination.highlightedMessageId}
        loadError={pagination.loadError}
        sessionPagination={pagination.sessionPagination}
        scrollToBottom={scrollToBottom}
        jumpToBottomInstant={pagination.jumpToBottomInstant}
        loadMoreMessages={pagination.loadMoreMessages}
        handleScroll={pagination.handleScroll}
        handleMessageWheel={pagination.handleMessageWheel}
        retryLoad={pagination.retryLoad}
        sessionMessages={sessionMessages}
        lastSessionMessage={lastSessionMessage}
        lastStreamingBlock={lastStreamingBlock}
        streamingContentSignature={streamingContentSignature}
        useStreamingSegmented={useStreamingSegmented}
        sessionContentBlocks={sessionContentBlocks}
        sessionToolCallHistory={sessionToolCallHistory}
        sessionToolCalls={sessionToolCalls}
        sessionHealth={sessionHealth}
        sessionRetryStatus={sessionRetryStatus}
        isLoading={isLoading}
        resendTargetMessageId={resendTargetMessage?.id}
        resendDisabled={!resendText || resendChecking}
        onResendTarget={handleResendLastMessage}
        onCancelRun={handleCancelRun}
        permissionRequests={permissionRequests}
        onPermissionDecision={handlePermissionDecision}
        fileReferenceRoot={fileReferenceRoot}
        fileReferenceBackendId={fileReferenceBackendId}
        onFork={handleFork}
        onBranch={handleBranch}
        collapsed={isEmptySession}
      />

      {/* Background Tasks Panel */}
      <BackgroundTaskPanel sessionId={sessionId} onStopTask={(task) => {
        wsSendMessage({
          type: 'stop_background_task',
          sessionId,
          taskId: task.id,
          cliPid: task.cliPid,
          taskRootPid: task.taskRootPid,
          taskCommand: task.taskCommand,
        });
      }} />

      {beforeComposer}

      {/* Upload error banner */}
      {uploadError && (
        <div className="mx-2 md:mx-4 mt-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
          <AlertTriangle size={16} strokeWidth={2} className="flex-shrink-0" />
          <span className="flex-1">{uploadError}</span>
          <button onClick={() => send.resetSendState()} className="text-destructive hover:text-destructive/80 font-medium">Dismiss</button>
        </div>
      )}

      {/* Input area */}
      {currentSession && (
        <ChatInputArea
          sessionId={sessionId}
          currentSession={currentSession}
          currentProject={currentProject}
          isMobile={isMobile}
          isLoading={isLoading}
          isConnected={isConnected}
          isForcedPlanSession={isForcedPlanSession}
          mode={effectiveMode}
          capabilities={capabilities}
          permissionOverride={permissionOverride}
          commands={commands}
          fileReferenceRoot={fileReferenceRoot}
          fileReferenceBackendId={fileReferenceBackendId}
          sessionRunId={sessionRunId}
          currentUsage={currentUsage}
          advancedInput={advancedInput}
          restoreMessage={restoreMessage}
          initialDraft={initialDraft}
          draftExists={draftExists}
          onSetMode={setMode}
          onSetPermissionOverride={setPermissionOverride}
          onWorktreeChange={handleWorktreeChange}
          onSendMessage={handleSendMessage}
          onCancelRun={handleCancelRun}
          onCommand={handleCommand}
          centered={isEmptySession}
        />
      )}
      </>}

      {/* Draft lock conflict dialog */}
      {draftShowLockPrompt && <DraftLockPrompt />}
    </div>
    </ChatActionsProvider>
  );
}

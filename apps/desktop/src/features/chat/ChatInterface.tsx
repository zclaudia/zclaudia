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
import { uploadMessageAttachments, useSendMessage } from '../../hooks/chat/useSendMessage';
import { useSendQueueConsumer } from '../../hooks/chat/useSendQueueConsumer';
import { useSendQueueStore, type QueueItem } from '../../stores/sendQueueStore';
import { useCommandHandler } from '../../hooks/chat/useCommandHandler';
import { useInvocableCatalog } from '../../hooks/chat/useInvocableCatalog';
import {
  buildCanonicalInvocationSubmission,
  buildRawMessageSubmission,
} from '../../hooks/chat/useInvocationHandler';
import { hasClientAction } from './clientActions';
import { useMessagePagination } from '../../hooks/chat/useMessagePagination';
import { useSessionActions } from '../../hooks/chat/useSessionActions';
import { usePlanStatus } from '../../hooks/chat/usePlanStatus';
import { useKeyboardShortcuts } from '../../hooks/chat/useKeyboardShortcuts';
import { useMobileViewport } from '../../hooks/chat/useMobileViewport';
import { useSessionRoute } from '../../hooks/chat/useSessionRoute';
import type { ClientMessage, MessageAttachment } from '@zclaudia/shared';
import { useProjectStore } from '../../stores/projectStore';
import { useToastStore } from '../../stores/toastStore';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { promptText } from '../../stores/confirmDialogStore';
import * as api from '../../services/api';
import type { Attachment } from './MessageInput';

interface ChatInterfaceProps {
  sessionId: string;
  onReturnToDashboard?: (projectId: string) => void;
  onOpenSidebar?: () => void;
  beforeComposer?: ReactNode;
}

export function ChatInterface({
  sessionId,
  onReturnToDashboard,
  onOpenSidebar,
  beforeComposer,
}: ChatInterfaceProps) {
  const {
    sendMessage: activeServerSendMessage,
    sendToServer,
    handlePermissionDecision,
  } = useConnection();
  const isMobile = useIsMobile();
  const activeServerId = useServerStore(s => s.activeServerId);
  const setDrawerOpen = useTerminalStore(s => s.setDrawerOpen);
  const poppedOutSessions = useUIStore(s => s.poppedOutSessions);
  const route = useSessionRoute(sessionId);
  const routedBackendId = route.backendId;
  const isConnected = route.canSend;

  const wsSendMessage = useCallback(
    (message: ClientMessage) => {
      if (routedBackendId) {
        sendToServer(routedBackendId, message);
        return;
      }
      activeServerSendMessage(message);
    },
    [activeServerSendMessage, routedBackendId, sendToServer]
  );

  // Draft editor state
  const draftShowLockPrompt = useDraftEditorStore(s => s.showLockPrompt);
  const draftExists = useDraftEditorStore(s => s.draftExists[sessionId] ?? false);
  const checkDraftExists = useDraftEditorStore(s => s.checkDraftExists);

  useEffect(() => {
    checkDraftExists(sessionId);
  }, [sessionId, checkDraftExists]);

  // ── Core hooks ──
  const session = useChatSession({ sessionId, isConnected });
  const {
    sessionMessages,
    lastSessionMessage,
    sessionRunId,
    isSessionRunning,
    isLoading,
    sessionHealth,
    sessionRetryStatus,
    sessionToolCalls,
    sessionContentBlocks,
    sessionToolCallHistory,
    useStreamingSegmented,
    lastStreamingBlock,
    streamingContentSignature,
    currentSession,
    currentProject,
    isForcedPlanSession,
    fileReferenceRoot,
    fileReferenceBackendId,
    llmProfileId,
    capabilities,
    commands,
    commandsCacheKey,
    effectiveMode,
    permissionOverride,
    currentUsage,
    currentSystemInfo,
    addMessage,
    clearMessages,
    setMode,
    setPermissionOverride,
  } = session;

  // Mobile viewport management
  const chatRootRef = useRef<HTMLDivElement>(null);
  useMobileViewport(chatRootRef, isMobile);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    projectId: currentSession?.projectId,
    projectRoot: currentProject?.rootPath,
  });

  // Per-session pending permission/question requests — memoize to avoid new array reference each render
  const allPendingRequests = usePermissionStore(state => state.pendingRequests);
  const permissionRequests = useMemo(
    () => allPendingRequests.filter(r => r.sessionId === sessionId || !r.sessionId),
    [allPendingRequests, sessionId]
  );
  // Message pagination & scroll management
  const pagination = useMessagePagination({ sessionId, isConnected, isMobile });
  const { scrollToBottom, resetRefs: resetPaginationRefs } = pagination;

  // Message sending
  const send = useSendMessage({
    sessionId,
    isConnected,
    isLoading,
    sessionRunId,
    isSessionRunning,
    lastSessionMessage,
    mode: effectiveMode,
    permissionOverride,
    currentSession,
    addMessage,
    scrollToBottom,
    wsSendMessage,
  });
  const {
    handleSendMessage,
    handleCancelRun,
    handleResendLastMessage,
    startRun,
    sendAsNewRun,
    steerNow,
    clearInterruptedStatus,
    restoreMessage,
    uploadError,
    awaitingRunStart,
    resendTargetMessage,
    resendText,
    resendChecking,
    resetSendState,
  } = send;

  // Steer a queued item into the live run, then drop it from the queue — but
  // only if the steer actually dispatched. If the run ended between render and
  // click (steerNow returns false), the item stays queued to ship next instead
  // of being silently lost.
  const handleSteerQueueItem = useCallback(
    (item: QueueItem) => {
      if (steerNow(item.content)) {
        useSendQueueStore.getState().removeItem(item.sessionId, item.id);
      }
    },
    [steerNow]
  );

  // Auto-ship queued messages one at a time as the session's run cycles.
  useSendQueueConsumer({ sessionId, sendAsNewRun });

  const chatActionsValue = useMemo<ChatActionsContextValue>(
    () => ({
      handleSendMessage,
      setMode: useSessionConfigStore.getState().setMode,
    }),
    [handleSendMessage]
  );

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
  const { handleCommand, handleResetProviderSession, handleWorktreeChange, dispatchHostAction } =
    useCommandHandler({
      sessionId,
      commands,
      currentSession,
      currentProject,
      isForcedPlanSession,
      mode: effectiveMode,
      addMessage,
      clearMessages,
      scrollToBottom,
      startRun,
      llmProfileId,
      commandsCacheKey,
      setDrawerOpen,
    });

  // ── URIP session invocable catalog (§16) ──
  // Fetched from the backend that executes this session's runs; a catalog
  // failure never disables message submission (raw text stays available).
  const invocableCatalog = useInvocableCatalog({
    backendId: fileReferenceBackendId,
    sessionId,
    contextToken: currentSession?.workingDirectory ?? '',
  });

  // Canonical submission (§16.3): host actions dispatch locally through the
  // client action registry; everything else goes out as a run_start V2
  // invocation carrying the canonical ID, revision, and context fingerprint.
  const handleCanonicalInvocation = useCallback(
    async (
      descriptor: import('@zclaudia/shared/providers').InvocableDescriptor,
      args: string,
      attachments?: Attachment[]
    ): Promise<boolean> => {
      if (descriptor.kind === 'host.action' && hasClientAction(`zc.${descriptor.name}`)) {
        if (attachments?.length) {
          useToastStore.getState().add({
            title: 'Attachments not supported',
            message: 'Remove attachments before running a ZClaudia action.',
            type: 'error',
            sessionId,
          });
          return false;
        }
        await dispatchHostAction(descriptor.name, args);
        return true;
      }
      const snapshot = invocableCatalog.snapshot;
      if (!snapshot) {
        useToastStore.getState().add({
          title: 'Catalog unavailable',
          message: 'Refresh the command catalog and select the item again.',
          type: 'error',
          sessionId,
        });
        return false;
      }
      let uploadedAttachments: MessageAttachment[];
      try {
        uploadedAttachments = await uploadMessageAttachments(attachments);
      } catch (error) {
        useToastStore.getState().add({
          title: 'Upload failed',
          message: error instanceof Error ? error.message : 'Failed to upload attachment.',
          type: 'error',
          sessionId,
        });
        return false;
      }
      const optimisticId = crypto.randomUUID();
      addMessage(sessionId, {
        id: optimisticId,
        clientMessageId: optimisticId,
        sessionId,
        role: 'user',
        content: args ? `${descriptor.displayTrigger} ${args}` : descriptor.displayTrigger,
        createdAt: Date.now(),
      });
      wsSendMessage(
        buildCanonicalInvocationSubmission(
          sessionId,
          {
            descriptor,
            typedTrigger: descriptor.displayTrigger,
            arguments: { type: 'raw', value: args },
          },
          snapshot,
          {
            attachments: uploadedAttachments,
            permissionOverride: permissionOverride ?? undefined,
          }
        ) as unknown as Parameters<typeof wsSendMessage>[0]
      );
      setTimeout(() => scrollToBottom(), 100);
      return true;
    },
    [
      addMessage,
      dispatchHostAction,
      invocableCatalog.snapshot,
      permissionOverride,
      scrollToBottom,
      sessionId,
      wsSendMessage,
    ]
  );

  // "Send literally" escape (§16.3): preserve reserved-namespace bytes for the
  // runtime instead of resolving them server-side.
  const handleSendLiterally = useCallback(
    async (text: string, attachments?: Attachment[]): Promise<boolean> => {
      let uploadedAttachments: MessageAttachment[];
      try {
        uploadedAttachments = await uploadMessageAttachments(attachments);
      } catch (error) {
        useToastStore.getState().add({
          title: 'Upload failed',
          message: error instanceof Error ? error.message : 'Failed to upload attachment.',
          type: 'error',
          sessionId,
        });
        return false;
      }
      const optimisticId = crypto.randomUUID();
      addMessage(sessionId, {
        id: optimisticId,
        clientMessageId: optimisticId,
        sessionId,
        role: 'user',
        content: text,
        createdAt: Date.now(),
      });
      wsSendMessage(
        buildRawMessageSubmission(sessionId, text, {
          sendLiterally: true,
          attachments: uploadedAttachments,
          mode: effectiveMode || undefined,
          permissionOverride: permissionOverride ?? undefined,
          workingDirectory: currentSession?.workingDirectory || undefined,
        }) as unknown as Parameters<typeof wsSendMessage>[0]
      );
      setTimeout(() => scrollToBottom(), 100);
      return true;
    },
    [
      addMessage,
      currentSession?.workingDirectory,
      effectiveMode,
      permissionOverride,
      scrollToBottom,
      sessionId,
      wsSendMessage,
    ]
  );

  // Plan status
  const {
    taskPlanStatus,
    planStatusLoading,
    submitPlanLoading,
    discardPlanLoading,
    handleRestorePlan,
    handleDiscardPlan,
    handleSubmitPlan,
  } = usePlanStatus({
    sessionId,
    isConnected,
    isForcedPlanSession,
    currentSession,
    currentProjectId: currentProject?.id,
    messagesLength: sessionMessages.length,
    addMessage,
    scrollToBottom,
    handleSendMessage,
  });

  // Session actions
  const {
    handleSessionRename,
    handleExportSession,
    handleArchiveSession,
    handlePopOut,
    handleFocusPoppedOutWindow,
    handleBringBackHere,
  } = useSessionActions({
    sessionId,
    isConnected,
    currentSession,
    currentProject,
    activeServerId,
    renameValue,
    setIsRenamingSession,
    isSessionRunning,
  });

  const poppedOutLabel = poppedOutSessions.get(sessionId);

  // ── SP-A fork/branch handlers ──

  const handleFork = useCallback(
    async (treeEntryId: string) => {
      // NOTE: not window.prompt — in the webview it returns null without showing a
      // dialog, so the name field was silently dead (every fork was auto-named).
      // promptText renders an in-app input; null means the user cancelled.
      const input = await promptText({
        title: 'Fork session',
        message: 'Name for the forked session (leave blank for auto):',
        placeholder: 'New session name',
        confirmLabel: 'Fork',
      });
      if (input === null) return;
      const name = input.trim() || undefined;
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
        useToastStore
          .getState()
          .add({ title: 'Fork failed', message: msg, type: 'error', icon: 'error' });
        console.error('[ChatInterface] fork failed:', err);
      }
    },
    [sessionId]
  );

  const handleBranch = useCallback(
    async (treeEntryId: string) => {
      // NOTE: no window.confirm here — in the webview it returns falsy without showing
      // a dialog, which silently blocked the whole action (no API call, no toast).
      // Branch is reversible (the old tip is kept in the tree and shown in the Lineage
      // panel) and the menu item is labelled "(rewind)", so we execute directly and
      // report the outcome via toast.
      try {
        await branchSession(sessionId, treeEntryId);
        // Reload messages for this session (full replace) — mirrors the initial-load path in useMessagePagination
        const result = await api.getSessionMessages(sessionId, { limit: 50 });
        useChatMessageStore.getState().setMessages(sessionId, result.messages, result.pagination);
        useToastStore.getState().add({
          title: 'Session rewound',
          message: 'The conversation has been branched from this point.',
          type: 'success',
          sessionId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        useToastStore
          .getState()
          .add({ title: 'Branch failed', message: msg, type: 'error', icon: 'error' });
        console.error('[ChatInterface] branch failed:', err);
      }
    },
    [sessionId]
  );

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
        {!poppedOutLabel && (
          <>
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
                  try {
                    await clearInterruptedStatus();
                  } catch {
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
                onRenameStart={name => {
                  setRenameValue(name);
                  setIsRenamingSession(true);
                }}
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
                    ? Math.min(
                        100,
                        Math.round(
                          ((currentUsage.contextUsedTokens ?? currentUsage.latestInputTokens ?? 0) /
                            currentUsage.contextWindow) *
                            100
                        )
                      )
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
              // Cover the dispatch gap too: the run isn't active yet, but the
              // message is already on screen and something is happening, so the
              // thinking indicator should be up rather than a silent pause.
              isLoading={isLoading || awaitingRunStart}
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
            <BackgroundTaskPanel
              sessionId={sessionId}
              onStopTask={task => {
                wsSendMessage({
                  type: 'stop_background_task',
                  sessionId,
                  taskId: task.id,
                  cliPid: task.cliPid,
                  taskRootPid: task.taskRootPid,
                  taskCommand: task.taskCommand,
                });
              }}
            />

            {beforeComposer}

            {/* Upload error banner */}
            {uploadError && (
              <div className="mx-2 md:mx-4 mt-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
                <AlertTriangle size={16} strokeWidth={2} className="flex-shrink-0" />
                <span className="flex-1">{uploadError}</span>
                <button
                  onClick={() => send.resetSendState()}
                  className="text-destructive hover:text-destructive/80 font-medium"
                >
                  Dismiss
                </button>
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
                restoreMessage={restoreMessage}
                initialDraft={initialDraft}
                draftExists={draftExists}
                onSetMode={setMode}
                onSetPermissionOverride={setPermissionOverride}
                onWorktreeChange={handleWorktreeChange}
                onSendMessage={handleSendMessage}
                onCancelRun={handleCancelRun}
                onCommand={handleCommand}
                invocableSuggestions={invocableCatalog.autocomplete}
                onCanonicalInvocation={handleCanonicalInvocation}
                onSendLiterally={handleSendLiterally}
                reservedRuntimeType={
                  invocableCatalog.snapshot?.invocables.find(item => item.runtimeType !== 'host')
                    ?.runtimeType
                }
                onSteerQueueItem={handleSteerQueueItem}
                centered={isEmptySession}
              />
            )}
          </>
        )}

        {/* Draft lock conflict dialog */}
        {draftShowLockPrompt && <DraftLockPrompt />}
      </div>
    </ChatActionsProvider>
  );
}

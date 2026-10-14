import { useRef, useEffect, useCallback, useState, type ComponentProps } from 'react';
import { MessageInput, InlinePermissionRequest, type Attachment } from '../chat';
import { useClaudiaStore } from '../../stores/claudiaStore';
import type { ClaudiaRunInstance } from '../../stores/claudiaStore';
import { Button } from '../../components/ui/Button';
import { usePromptRequestStore } from '../../stores/promptRequestStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { useConnection } from '../../contexts/ConnectionContext';
import { listAgentProfilesForBackend } from '../../services/api/agent-profiles';
import { parseBackendId } from '../../stores/gatewayStore';
import { useComposerStore } from '../../stores/composerStore';
import { resolveCanonicalBackendId } from '../../actions/controlPlane';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { ClientMessage } from '@zclaudia/shared/wire/messages/index';
import { buildAgentCancelMessage, buildClaudiaMessage } from './claudiaProtocol';
import { useClaudiaThreads } from './useClaudiaThreads';
import { useClaudiaRuns } from './useClaudiaRuns';
import { useClaudiaTranscriptSync } from './useClaudiaTranscriptSync';
import { useClaudiaProfileBinding } from './useClaudiaProfileBinding';
import { useComposerMountDraft } from '../chat/api';

interface ClaudiaChatProps {
  isMobile?: boolean;
}

// MessageInput expects its parent to restore persisted drafts. Capture a prefill
// once per keyed composer mount so later typing is never reset by store updates.
function ClaudiaComposer({
  rejected,
  ...props
}: ComponentProps<typeof MessageInput> & { rejected?: ClaudiaRunInstance }) {
  const initialDraft = useComposerMountDraft(props.sessionId, rejected);
  return (
    <MessageInput
      {...props}
      initialValue={initialDraft?.content}
      initialAttachments={initialDraft?.attachments}
    />
  );
}

export function ClaudiaChat({ isMobile = false }: ClaudiaChatProps) {
  const { sendToServer, isConnected, handlePermissionDecision } = useConnection();
  const returnToApp = useTopLevelViewStore(s => s.returnToApp);
  const { selectSession } = useSelectionCoordinator();

  const {
    activeBackendId,
    selectedProjectId,
    project,
    slice,
    store,
    threads,
    activeThreadId,
    currentThread,
    threadsLoaded,
    threadSessionId,
  } = useClaudiaThreads({ isConnected });

  const wsSendMessage = useCallback(
    (message: ClientMessage) => {
      if (activeBackendId) sendToServer(activeBackendId, message);
    },
    [activeBackendId, sendToServer]
  );
  const [newTopicArmed, setNewTopicArmed] = useState(false);
  const [newTopicRequestId, setNewTopicRequestId] = useState<string | null>(null);
  const composerKey = `claudia-${activeBackendId ?? 'none'}-${selectedProjectId ?? 'none'}-${newTopicArmed ? 'new' : (currentThread?.id ?? 'new')}`;

  useEffect(() => {
    store.getState().markViewed();
    return () => store.getState().markViewed();
  }, [store]);

  // Profile picker (explicit selection for a new conversation)
  const [profiles, setProfiles] = useState<AgentProfileConfig[]>([]);
  const [explicitProfileId, setExplicitProfileId] = useState<string>('');
  useEffect(() => {
    let stale = false;
    setProfiles([]);
    setExplicitProfileId('');
    setNewTopicArmed(false);
    setNewTopicRequestId(null);
    if (isConnected && activeBackendId) {
      listAgentProfilesForBackend(activeBackendId)
        .then(list => {
          if (!stale)
            setProfiles(list.filter(profile => (profile.status ?? 'active') === 'active'));
        })
        .catch(() => {});
    }
    return () => {
      stale = true;
    };
  }, [isConnected, activeBackendId, selectedProjectId]);

  // --- Pending permission / input requests: associated by session, not by task ---
  const permissionRequests = usePermissionStore(state =>
    state.pendingRequests.filter(request => {
      const owner = request.serverId
        ? resolveCanonicalBackendId(parseBackendId(request.serverId))
        : null;
      return owner === activeBackendId && request.sessionId === threadSessionId;
    })
  );

  const awaitingInput = usePromptRequestStore(state =>
    state.pendingRequests.some(
      request =>
        request.sessionId === threadSessionId &&
        request.serverId != null &&
        resolveCanonicalBackendId(parseBackendId(request.serverId)) === activeBackendId
    )
  );

  // --- Send ---

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const switchThread = useCallback(
    (threadId: string | null) => {
      if (!activeBackendId || !selectedProjectId) return;
      store.getState().setActiveThread(activeBackendId, selectedProjectId, threadId);
      setExplicitProfileId('');
      setNewTopicArmed(false);
    },
    [activeBackendId, selectedProjectId, store]
  );

  const handleSend = useCallback(
    (content: string, attachments?: Attachment[], resumeCurrent = false) => {
      if (
        (!content.trim() && !attachments?.length) ||
        !isConnected ||
        !activeBackendId ||
        !selectedProjectId ||
        !project ||
        (!newTopicArmed && !threadsLoaded)
      )
        return;
      const clientRequestId = crypto.randomUUID();
      const forceNew = !resumeCurrent && newTopicArmed;
      const targetThreadId = activeThreadId ?? currentThread?.id;
      if (forceNew) setNewTopicRequestId(clientRequestId);
      const message = buildClaudiaMessage({
        clientRequestId,
        content,
        attachments,
        projectId: selectedProjectId,
        explicitProfileId,
        resumeCurrent,
        targetThreadId,
        forceNew,
      });
      store.getState().startRun(activeBackendId, {
        clientRequestId,
        input: content,
        projectId: selectedProjectId,
        threadId: forceNew ? null : (targetThreadId ?? null),
        originThreadId: currentThread?.id ?? null,
        draftKey: composerKey,
        draftAttachments: attachments,
        request: message,
        status: 'submitting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      wsSendMessage(message);
    },
    [
      isConnected,
      activeBackendId,
      selectedProjectId,
      project,
      currentThread,
      activeThreadId,
      threadsLoaded,
      explicitProfileId,
      newTopicArmed,
      composerKey,
      wsSendMessage,
      store,
    ]
  );

  // Interrupted resume re-sends inside the current thread and disarms the
  // new-topic interlock in the original order (send, then disarm).
  const resumeSend = useCallback(() => {
    handleSend('continue', undefined, true);
    setNewTopicArmed(false);
  }, [handleSend]);

  const {
    runs,
    threadRuns,
    activeRun,
    rejectedRuns,
    threadInterrupted,
    handleResumeInterrupted,
    handleDismissInterrupted,
  } = useClaudiaRuns({
    isConnected,
    activeBackendId,
    selectedProjectId,
    slice,
    store,
    currentThread,
    activeThreadId,
    threadSessionId,
    wsSendMessage,
    resumeSend,
  });

  useEffect(() => {
    const submitted = runs.find(run => run.clientRequestId === newTopicRequestId);
    if (
      submitted?.sessionId &&
      submitted.status !== 'submitting' &&
      submitted.status !== 'rejected'
    ) {
      setNewTopicArmed(false);
      setNewTopicRequestId(null);
    }
  }, [runs, newTopicRequestId]);

  const rejectedDraft = [...rejectedRuns].reverse().find(run => run.draftKey === composerKey);
  useEffect(() => {
    if (!rejectedDraft || rejectedDraft.draftRestored || !activeBackendId) return;
    useComposerStore.getState().setDraft(composerKey, {
      content: rejectedDraft.input,
      attachments: rejectedDraft.draftAttachments ?? [],
    });
    store.getState().startRun(activeBackendId, { ...rejectedDraft, draftRestored: true });
  }, [rejectedDraft, composerKey, activeBackendId, store]);

  const { boundProfile, boundProfileName } = useClaudiaProfileBinding({
    threadRuns,
    currentThread,
    threadSessionId,
    explicitProfileId,
    profiles,
    project,
    newTopicArmed,
  });

  // --- Reads: transcript (4s polling + version-guarded refetch) ---
  const { messages } = useClaudiaTranscriptSync({
    isConnected,
    activeBackendId,
    threadSessionId,
    slice,
    store,
    threadRuns,
  });

  // --- Actions on the active run ---
  const handleCancelActive = useCallback(() => {
    const run = threadRuns.find(r => r.status === 'running' || r.status === 'submitting');
    if (!run || !run.sessionId) return;
    wsSendMessage(buildAgentCancelMessage(run.sessionId, run.runId));
  }, [threadRuns, wsSendMessage]);

  const handleOpenSession = useCallback(() => {
    if (!threadSessionId || !activeBackendId || !selectedProjectId || !currentThread) return;
    store.getState().setReturnTarget({
      backendId: activeBackendId,
      projectId: selectedProjectId,
      threadId: currentThread.id,
      sessionId: threadSessionId,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    });
    if (isMobile) useClaudiaStore.getState().setExpanded(false);
    returnToApp();
    selectSession(threadSessionId, activeBackendId ? { backendId: activeBackendId } : undefined);
  }, [
    threadSessionId,
    isMobile,
    activeBackendId,
    selectSession,
    returnToApp,
    selectedProjectId,
    currentThread,
    store,
  ]);

  const handleCloseOverlay = useCallback(() => {
    if (isMobile) useClaudiaStore.getState().setExpanded(false);
    else returnToApp();
  }, [isMobile, returnToApp]);

  useEffect(() => {
    if (threadRuns.length > 0 || (messages?.length ?? 0) > 0) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [threadRuns.length, messages?.length]);

  useEffect(() => {
    const target = store.getState().returnTarget;
    if (
      target?.backendId === activeBackendId &&
      target.sessionId === threadSessionId &&
      scrollRef.current
    ) {
      scrollRef.current.scrollTop = target.scrollTop;
      store.getState().setReturnTarget(null);
    }
  }, [activeBackendId, threadSessionId, store]);

  // --- No explicit project: disable input, show CTA (design §主交互 1, P0) ---
  if (!selectedProjectId || !project) {
    return (
      <div
        className={
          isMobile
            ? 'w-full h-full bg-card flex flex-col overflow-hidden safe-top-pad safe-bottom-pad'
            : 'flex flex-col h-full bg-card overflow-hidden'
        }
      >
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <p className="text-sm text-foreground mb-1">Select a project to start</p>
            <p className="text-xs text-muted-foreground mb-4">
              Claudia works inside a project. Pick one from Home or the project list, then come back
              to continue the conversation.
            </p>
            <button
              onClick={handleCloseOverlay}
              className="rounded-md bg-muted px-3 py-1.5 text-xs text-primary hover:bg-muted transition-colors"
            >
              Choose a project
            </button>
          </div>
        </div>
      </div>
    );
  }

  const disabled =
    !isConnected || (!newTopicArmed && (!threadsLoaded || activeRun?.status === 'submitting'));

  return (
    <div
      className={
        isMobile
          ? 'w-full h-full bg-card flex flex-col overflow-hidden safe-top-pad safe-bottom-pad'
          : 'flex flex-col h-full bg-card overflow-hidden'
      }
    >
      {/* Thread bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 flex-shrink-0">
        <select
          className="text-xs bg-transparent text-foreground max-w-[55%] truncate"
          value={currentThread?.id ?? ''}
          onChange={e => switchThread(e.target.value || null)}
          aria-label="Conversation thread"
        >
          {threads.length === 0 ? (
            <option value="">New conversation</option>
          ) : (
            <>
              {threads.map(thread => (
                <option key={thread.id} value={thread.id}>
                  {thread.title || thread.session?.name || 'Conversation'}
                </option>
              ))}
              <option value="" disabled>
                — pick a thread —
              </option>
            </>
          )}
        </select>
        <div className="ml-auto flex items-center gap-2">
          {threadSessionId && (
            <button
              onClick={handleOpenSession}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Open work session
            </button>
          )}
          <button
            onClick={() => setNewTopicArmed(value => !value)}
            className={`text-[11px] rounded-md px-2 py-0.5 border border-border/60 ${
              newTopicArmed
                ? 'bg-muted text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Next message starts a new conversation"
          >
            New topic
          </button>
        </div>
      </div>

      {/* Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 md:p-4 space-y-3">
        {threadInterrupted && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="text-destructive">
                The last run in this conversation was interrupted.
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => void handleResumeInterrupted()}
                  className="rounded-md bg-muted px-3 py-1 text-xs text-primary hover:bg-muted transition-colors"
                >
                  Resume
                </button>
                <button
                  onClick={() => void handleDismissInterrupted()}
                  className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Transcript — read from the standard session/message store */}
        {(messages ?? [])
          .filter(
            item =>
              !threadRuns.some(
                run => run.status === 'running' && run.assistantMessageId === item.id
              )
          )
          .map(item => {
            if (item.role === 'user') {
              return (
                <div key={item.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-muted/60 px-3 py-2">
                    <p className="text-sm whitespace-pre-wrap">{item.text}</p>
                  </div>
                </div>
              );
            }
            if (item.role === 'assistant' && item.text.trim()) {
              return (
                <div key={item.id} className="max-w-[92%]">
                  <p className="text-sm whitespace-pre-wrap">{item.text}</p>
                </div>
              );
            }
            return null;
          })}

        {/* Stable reply region: one run card per request, never a form switch */}
        {threadRuns.map(run => {
          if (run.status === 'rejected') return null;
          const isLive = run.status === 'running' || run.status === 'submitting';
          const persisted =
            !isLive && messages?.some(message => message.id === run.assistantMessageId);
          const text = persisted
            ? ''
            : isLive
              ? (slice?.streamingText[run.clientRequestId] ?? run.responseText ?? '')
              : (run.responseText ?? '');
          return (
            <div key={run.clientRequestId} className="max-w-[92%] space-y-1">
              {/* The request bubble stays visible until the persisted
                  transcript refetch includes it. */}
              {run.input.trim() && !messages?.some(message => message.id === run.userMessageId) && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-muted/60 px-3 py-2">
                    <p className="text-sm whitespace-pre-wrap">{run.input}</p>
                  </div>
                </div>
              )}
              {isLive && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-block w-2 h-2 rounded-full bg-success animate-pulse" />
                  {run.status === 'submitting' ? 'Starting…' : 'Working…'}
                  {run.agentProfileId && (
                    <span>
                      ·{' '}
                      {profiles.find(p => p.id === run.agentProfileId)?.name ?? run.agentProfileId}
                    </span>
                  )}
                </div>
              )}
              {text.trim() && <p className="text-sm whitespace-pre-wrap">{text}</p>}
              {run.status === 'cancelled' && (
                <p className="text-xs text-muted-foreground">Run cancelled.</p>
              )}
              {run.status === 'failed' && (
                <p className="text-xs text-destructive">
                  Run failed: {run.error ?? 'unknown error'}
                </p>
              )}
            </div>
          );
        })}

        {/* Rejections keep the draft and say why — no task, no silent fork */}
        {rejectedRuns.map(run => (
          <div
            key={run.clientRequestId}
            className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs"
          >
            {run.rejectCode === 'SESSION_BUSY' ? (
              <p className="text-foreground">
                This conversation is still working. Wait for it to finish, or start a new topic.
              </p>
            ) : (
              <p className="text-foreground">{run.error || 'Request rejected'}</p>
            )}
          </div>
        ))}

        {/* Legacy canonical tasks bound to this thread — read-only references */}
        {(slice?.tasks ?? [])
          .filter(task => task.sessionId && task.sessionId === threadSessionId)
          .map(task => (
            <div
              key={task.id}
              className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground truncate">{task.title}</span>
                <span className="text-muted-foreground">{task.status}</span>
              </div>
              {task.error && <p className="text-destructive mt-1">{task.error}</p>}
            </div>
          ))}

        {awaitingInput && (
          <div className="rounded-md border border-border p-3 text-sm">
            <p>The agent needs your input to continue.</p>
            <Button onClick={handleOpenSession}>Answer in work session</Button>
          </div>
        )}

        {/* All pending requests for this conversation's sessions */}
        {permissionRequests.length > 0 && (
          <div className="space-y-3">
            {permissionRequests.map(request => (
              <InlinePermissionRequest
                key={request.requestId}
                request={request}
                onDecision={handlePermissionDecision}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {threadRuns.length === 0 && (messages?.length ?? 0) === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-xs">
              <p className="text-sm text-muted-foreground mb-1">Hi! I'm Claudia.</p>
              <p className="text-xs text-muted-foreground/60">
                Tell me what to do in {project.name} — I'll answer here and keep the work in this
                conversation.
              </p>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Context line: project · location · agent profile + source */}
      <div className="px-3 pb-1 flex items-center gap-2 text-[11px] text-muted-foreground flex-shrink-0">
        <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5">
          {project.name}
        </span>
        {project.rootPath && (
          <span className="truncate max-w-[40%]" title={project.rootPath}>
            {project.rootPath}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <select
            className="bg-transparent text-[11px] text-muted-foreground max-w-[180px]"
            value={explicitProfileId}
            onChange={e => {
              setExplicitProfileId(e.target.value);
              if (threadSessionId) setNewTopicArmed(true);
            }}
            aria-label="Agent profile for new conversation"
          >
            <option value="">
              {explicitProfileId
                ? 'Auto (default agent)'
                : boundProfileName
                  ? `Auto — ${boundProfileName} (${boundProfile?.sourceLabel ?? 'Global default'})`
                  : 'Auto (default agent)'}
            </option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === explicitProfileId ? ' · Explicit selection' : ''}
              </option>
            ))}
          </select>
        </span>
      </div>

      {/* Input — draft is bound to backend + thread via the composer key */}
      <div
        className={`border-t border-border flex-shrink-0 ${isMobile ? 'p-3 safe-bottom-pad' : 'p-2 md:p-4'}`}
      >
        <ClaudiaComposer
          key={`${composerKey}-${rejectedDraft?.clientRequestId ?? ''}`}
          sessionId={composerKey}
          backendId={activeBackendId}
          rejected={rejectedDraft}
          onSend={(content, attachments) => handleSend(content, attachments)}
          isLoading={
            !newTopicArmed &&
            Boolean(
              activeRun && (activeRun.status === 'submitting' || activeRun.status === 'running')
            )
          }
          onCancel={activeRun && activeRun.status !== 'submitting' ? handleCancelActive : undefined}
          disabled={disabled}
          placeholder={
            !isConnected
              ? 'Connecting Claudia...'
              : newTopicArmed
                ? 'New topic — send to start a fresh conversation...'
                : 'Ask Claudia...'
          }
        />
      </div>
    </div>
  );
}

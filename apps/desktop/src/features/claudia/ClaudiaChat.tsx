import { useRef, useEffect, useCallback, useMemo, useState, type ComponentProps } from 'react';
import { MessageInput, type Attachment } from '../chat/MessageInput';
import { useClaudiaStore } from '../../stores/claudiaStore';
import type {
  ClaudiaFeedMessage,
  ClaudiaRunInstance,
  ClaudiaThreadSummary,
} from '../../stores/claudiaStore';
import { Button } from '../../components/ui/Button';
import { usePromptRequestStore } from '../../stores/promptRequestStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useServerStore } from '../../stores/serverStore';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { useConnection } from '../../contexts/ConnectionContext';
import { fetchApiForBackend } from '../../services/api/base';
import { listAgentProfilesForBackend } from '../../services/api/agent-profiles';
import { parseBackendId } from '../../stores/gatewayStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useComposerStore } from '../../stores/composerStore';
import { resolveCanonicalBackendId } from '../../actions/controlPlane';
import { InlinePermissionRequest } from '../chat/InlinePermissionRequest';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type {
  AgentCancelMessage,
  ClientMessage,
  Message,
  ClaudiaMessageMessage,
} from '@zclaudia/shared';

type ProfileSourceLabel =
  | 'Explicit selection'
  | 'Project default'
  | 'Global default'
  | 'Session bound';

interface ClaudiaChatProps {
  isMobile?: boolean;
}

function sourceLabel(source: string | undefined, explicit: boolean): ProfileSourceLabel {
  if (explicit) return 'Explicit selection';
  switch (source) {
    case 'project-default':
      return 'Project default';
    case 'session-bound':
      return 'Session bound';
    case 'explicit':
      return 'Explicit selection';
    default:
      return 'Global default';
  }
}

// MessageInput expects its parent to restore persisted drafts. Capture a prefill
// once per keyed composer mount so later typing is never reset by store updates.
function ClaudiaComposer({
  rejected,
  ...props
}: ComponentProps<typeof MessageInput> & { rejected?: ClaudiaRunInstance }) {
  const [initialDraft] = useState(() =>
    rejected && !rejected.draftRestored
      ? { content: rejected.input, attachments: rejected.draftAttachments ?? [] }
      : useComposerStore.getState().drafts[props.sessionId]
  );
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
  const activeServerId = useServerStore(s => s.activeServerId);
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const activeBackendId = resolveCanonicalBackendId(
    activeServerId ? parseBackendId(activeServerId) : null,
    localBackendId
  );
  const wsSendMessage = useCallback(
    (message: ClientMessage) => {
      if (activeBackendId) sendToServer(activeBackendId, message);
    },
    [activeBackendId, sendToServer]
  );
  const selectedProjectId = useSelectionStore(s => s.selectedProjectId);
  const projects = useProjectStore(s => s.projects);
  const dataServerId = useProjectStore(s => s.dataServerId);
  const projectBackendId = resolveCanonicalBackendId(
    dataServerId ? parseBackendId(dataServerId) : null,
    localBackendId
  );
  const returnToApp = useTopLevelViewStore(s => s.returnToApp);
  const { selectSession } = useSelectionCoordinator();

  const slice = useClaudiaStore(s => (activeBackendId ? s.slices[activeBackendId] : undefined));
  const store = useClaudiaStore;
  const [newTopicArmed, setNewTopicArmed] = useState(false);
  const [newTopicRequestId, setNewTopicRequestId] = useState<string | null>(null);

  const project = useMemo(
    () =>
      projectBackendId === activeBackendId
        ? (projects.find(p => p.id === selectedProjectId) ?? null)
        : null,
    [projects, selectedProjectId, projectBackendId, activeBackendId]
  );

  const threads = useMemo(
    () =>
      selectedProjectId
        ? (slice?.threadsByProject[selectedProjectId] ?? [])
        : ([] as ClaudiaThreadSummary[]),
    [slice?.threadsByProject, selectedProjectId]
  );
  const activeThreadId = selectedProjectId
    ? (slice?.activeThreadIdByProject[selectedProjectId] ?? null)
    : null;
  // No explicit thread open → most recently updated thread (project-state pointer
  // semantics, kept client-side so it can never override an explicit open).
  const currentThread: ClaudiaThreadSummary | null = useMemo(() => {
    if (activeThreadId) return threads.find(t => t.id === activeThreadId) ?? null;
    return threads[0] ?? null;
  }, [activeThreadId, threads]);
  const threadsLoaded = Boolean(selectedProjectId && slice?.threadsByProject[selectedProjectId]);
  const threadSessionId = currentThread?.session?.id ?? null;

  const runs = useMemo(() => slice?.runs ?? [], [slice?.runs]);
  const projectRuns = useMemo(
    () => runs.filter(run => !selectedProjectId || run.projectId === selectedProjectId),
    [runs, selectedProjectId]
  );
  const threadRuns = useMemo(
    () =>
      projectRuns
        .filter(run => {
          const target = currentThread?.id ?? activeThreadId;
          return target
            ? run.threadId === target ||
                (run.status === 'submitting' && run.originThreadId === target)
            : !run.threadId;
        })
        .sort((a, b) => a.createdAt - b.createdAt),
    [projectRuns, currentThread, activeThreadId]
  );
  const activeRun: ClaudiaRunInstance | null =
    threadRuns.find(run => run.status === 'running' || run.status === 'submitting') ??
    threadRuns.filter(run => run.status !== 'rejected').slice(-1)[0] ??
    null;
  const rejectedRuns = threadRuns.filter(run => run.status === 'rejected');

  useEffect(() => {
    if (!isConnected || !activeBackendId) return;
    // A lost accepted receipt must replay the same request, never allocate a
    // fresh request ID. The server ledger reconciles accepted/rejected/uncertain.
    for (const pending of store.getState().slices[activeBackendId]?.runs ?? []) {
      if (pending.status === 'submitting' && pending.request) wsSendMessage(pending.request);
    }
  }, [isConnected, activeBackendId, wsSendMessage, store]);

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

  const boundProfile = useMemo(() => {
    const fromReceipt = [...threadRuns]
      .reverse()
      .find(run => run.status === 'running' && run.agentProfileId);
    if (!newTopicArmed && fromReceipt?.agentProfileId) {
      return {
        id: fromReceipt.agentProfileId,
        sourceLabel: sourceLabel(fromReceipt.agentProfileSource, false),
      };
    }
    if (!newTopicArmed && threadSessionId && currentThread?.session?.agentProfileId) {
      return {
        id: currentThread.session.agentProfileId,
        sourceLabel: 'Session bound' as ProfileSourceLabel,
      };
    }
    const explicit = explicitProfileId ? profiles.find(p => p.id === explicitProfileId) : null;
    if (explicit)
      return { id: explicit.id, sourceLabel: 'Explicit selection' as ProfileSourceLabel };
    if (project?.defaultAgentProfileId) {
      return {
        id: project.defaultAgentProfileId,
        sourceLabel: 'Project default' as ProfileSourceLabel,
      };
    }
    const globalDefault = profiles.find(p => p.isDefault);
    if (globalDefault)
      return { id: globalDefault.id, sourceLabel: 'Global default' as ProfileSourceLabel };
    return null;
  }, [
    threadRuns,
    currentThread,
    threadSessionId,
    explicitProfileId,
    profiles,
    project,
    newTopicArmed,
  ]);
  const boundProfileName =
    profiles.find(p => p.id === boundProfile?.id)?.name ?? boundProfile?.id ?? null;

  // --- Reads: threads + transcript (standard session/message path) ---
  const hydratedThreadsRef = useRef<string>('');
  useEffect(() => {
    if (!isConnected) {
      hydratedThreadsRef.current = '';
      return;
    }
    if (!activeBackendId || !selectedProjectId) return;
    const key = `${activeBackendId}:${selectedProjectId}`;
    if (hydratedThreadsRef.current === key) return;
    hydratedThreadsRef.current = key;
    const requestedAt = Date.now();
    fetchApiForBackend<{ threads: ClaudiaThreadSummary[] }>(
      `/api/claudia/threads?projectId=${encodeURIComponent(selectedProjectId)}`,
      activeBackendId
    )
      .then(res => {
        if (res.success && res.data?.threads) {
          store
            .getState()
            .setThreads(activeBackendId, selectedProjectId, res.data.threads, requestedAt);
        }
      })
      .catch(() => {
        hydratedThreadsRef.current = '';
      });
  }, [isConnected, activeBackendId, selectedProjectId, store]);

  const messages = threadSessionId ? (slice?.messagesBySession[threadSessionId] ?? null) : null;
  const readVersions = useRef(new Map<string, number>());
  const refetchThreadMessages = useCallback(
    async (sessionId: string, backendId: string) => {
      const key = `${backendId}:${sessionId}`;
      const version = (readVersions.current.get(key) ?? 0) + 1;
      readVersions.current.set(key, version);
      const requestedAt = Date.now();
      try {
        const res = await fetchApiForBackend<{
          messages: Array<Message>;
          lastRunStatus?: string | null;
          activeRun?: {
            runId: string;
            content?: string;
            assistantMessageId?: string;
            startedAt?: number;
            seq?: number;
          } | null;
        }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=100`, backendId);
        if (readVersions.current.get(key) !== version || !res.success || !res.data) return;
        const projected: ClaudiaFeedMessage[] = res.data.messages.map(m => ({
          id: m.id,
          role: m.role === 'user' || m.role === 'assistant' ? m.role : 'other',
          text: typeof m.content === 'string' ? m.content : '',
          createdAt: m.createdAt,
        }));
        // Keep loaded older history; stable IDs replace snapshots rather than duplicate text.
        const previous = store.getState().slices[backendId]?.messagesBySession[sessionId] ?? [];
        const merged = new Map(previous.map(m => [m.id, m]));
        for (const message of projected) merged.set(message.id, message);
        store.getState().setSessionMessages(
          backendId,
          sessionId,
          [...merged.values()].sort((a, b) => a.createdAt - b.createdAt)
        );
        const live = res.data.activeRun;
        const current = store.getState().slices[backendId];
        if (live) {
          const known = current?.runs.find(run => run.runId === live.runId);
          if (!known) {
            const thread = Object.values(current?.threadsByProject ?? {})
              .flat()
              .find(t => t.session?.id === sessionId);
            if (thread)
              store.getState().startRun(backendId, {
                clientRequestId: `recovered:${live.runId}`,
                input: '',
                projectId: thread.projectId,
                threadId: thread.id,
                sessionId,
                runId: live.runId,
                status: 'running',
                assistantMessageId: live.assistantMessageId,
                agentProfileId: thread.session?.agentProfileId ?? undefined,
                responseText: live.content,
                createdAt: live.startedAt ?? requestedAt,
                updatedAt: requestedAt,
              });
          }
          if (live.content !== undefined)
            store.getState().applyRunSnapshot(backendId, live.runId, live.content, live.seq);
        }
        // A terminal event may have been lost while the socket was disconnected.
        // Refresh the authoritative thread/session state before settling the local projection.
        const stale =
          current?.runs.filter(
            run =>
              run.sessionId === sessionId &&
              run.status === 'running' &&
              run.runId !== live?.runId &&
              run.updatedAt <= requestedAt
          ) ?? [];
        for (const run of stale) {
          if (!run.threadId) continue;
          const latest = store
            .getState()
            .slices[backendId]?.runs.find(r => r.clientRequestId === run.clientRequestId);
          if (!latest || latest.status !== 'running' || latest.updatedAt > requestedAt) continue;
          const status = res.data.lastRunStatus;
          const finalStatus =
            status === 'failed' || status === 'cancelled' || status === 'interrupted'
              ? status
              : 'completed';
          store
            .getState()
            .startRun(backendId, { ...latest, status: finalStatus, updatedAt: Date.now() });
        }
      } catch {
        store.getState().setSessionMessagesLoading(backendId, sessionId, false);
      }
    },
    [store]
  );

  useEffect(() => {
    if (!isConnected || !activeBackendId || !threadSessionId) return;
    let stopped = false;
    const versions = readVersions.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      await refetchThreadMessages(threadSessionId, activeBackendId);
      if (!stopped) timer = setTimeout(refresh, 4000);
    };
    void refresh();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      const key = `${activeBackendId}:${threadSessionId}`;
      versions.set(key, (versions.get(key) ?? 0) + 1);
    };
  }, [isConnected, activeBackendId, threadSessionId, refetchThreadMessages]);

  const settledRunKey = threadRuns
    .filter(run => !['running', 'submitting', 'rejected'].includes(run.status))
    .map(run => `${run.clientRequestId}:${run.status}`)
    .join('|');
  useEffect(() => {
    if (isConnected && activeBackendId && threadSessionId && settledRunKey) {
      void refetchThreadMessages(threadSessionId, activeBackendId);
    }
  }, [settledRunKey, isConnected, activeBackendId, threadSessionId, refetchThreadMessages]);

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

  const composerKey = `claudia-${activeBackendId ?? 'none'}-${selectedProjectId ?? 'none'}-${newTopicArmed ? 'new' : (currentThread?.id ?? 'new')}`;
  const rejectedDraft = [...rejectedRuns].reverse().find(run => run.draftKey === composerKey);
  useEffect(() => {
    if (!rejectedDraft || rejectedDraft.draftRestored || !activeBackendId) return;
    useComposerStore.getState().setDraft(composerKey, {
      content: rejectedDraft.input,
      attachments: rejectedDraft.draftAttachments ?? [],
    });
    store.getState().startRun(activeBackendId, { ...rejectedDraft, draftRestored: true });
  }, [rejectedDraft, composerKey, activeBackendId, store]);

  // --- Interrupted recovery, keyed by the thread's session ---
  const [dismissedInterruption, setDismissedInterruption] = useState('');
  const interruptionKey = `${activeBackendId}:${threadSessionId}:${activeRun?.clientRequestId ?? currentThread?.session?.updatedAt}`;
  const threadInterrupted =
    dismissedInterruption !== interruptionKey &&
    (activeRun
      ? activeRun.status === 'interrupted'
      : currentThread?.session?.lastRunStatus === 'interrupted');
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
      const message: ClaudiaMessageMessage = {
        type: 'claudia_message',
        clientRequestId,
        input: attachments?.length ? JSON.stringify({ text: content, attachments }) : content,
        projectId: selectedProjectId,
        ...(!resumeCurrent && explicitProfileId ? { agentProfileId: explicitProfileId } : {}),
        ...(targetThreadId && !forceNew ? { activeBranchId: targetThreadId } : {}),
        ...(forceNew ? { forceNewBranch: true } : {}),
      };
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

  const handleResumeInterrupted = useCallback(async () => {
    if (!threadSessionId || !activeBackendId) return;
    try {
      const response = await fetchApiForBackend(
        `/api/sessions/${encodeURIComponent(threadSessionId)}/dismiss-interrupted`,
        activeBackendId,
        { method: 'PATCH' }
      );
      if (!response.success) return;
    } catch (error) {
      console.warn('[ClaudiaChat] Failed to clear interrupted status before resume:', error);
      return;
    }
    handleSend('continue', undefined, true);
    setNewTopicArmed(false);
    setDismissedInterruption(interruptionKey);
    // Refresh thread run status
    if (selectedProjectId) {
      fetchApiForBackend<{ threads: ClaudiaThreadSummary[] }>(
        `/api/claudia/threads?projectId=${encodeURIComponent(selectedProjectId)}`,
        activeBackendId
      )
        .then(res => {
          if (res.success && res.data?.threads) {
            store.getState().setThreads(activeBackendId, selectedProjectId, res.data.threads);
          }
        })
        .catch(() => {});
    }
  }, [threadSessionId, activeBackendId, selectedProjectId, handleSend, store, interruptionKey]);

  const handleDismissInterrupted = useCallback(async () => {
    if (!threadSessionId) return;
    try {
      const response = await fetchApiForBackend(
        `/api/sessions/${encodeURIComponent(threadSessionId)}/dismiss-interrupted`,
        activeBackendId,
        { method: 'PATCH' }
      );
      if (!response.success) return;
    } catch (error) {
      console.warn('[ClaudiaChat] Failed to dismiss interrupted status:', error);
      return;
    }
    setDismissedInterruption(interruptionKey);
    if (activeBackendId && selectedProjectId) {
      const next = (slice?.threadsByProject[selectedProjectId] ?? []).map(thread =>
        thread.session?.id === threadSessionId && thread.session
          ? { ...thread, session: { ...thread.session, lastRunStatus: null } }
          : thread
      );
      store.getState().setThreads(activeBackendId, selectedProjectId, next);
    }
  }, [
    threadSessionId,
    activeBackendId,
    selectedProjectId,
    slice?.threadsByProject,
    store,
    interruptionKey,
  ]);

  // --- Actions on the active run ---
  const handleCancelActive = useCallback(() => {
    const run = threadRuns.find(r => r.status === 'running' || r.status === 'submitting');
    if (!run || !run.sessionId) return;
    wsSendMessage({
      type: 'agent_cancel',
      sessionId: run.sessionId,
      ...(run.runId ? { runId: run.runId } : {}),
    } as AgentCancelMessage);
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

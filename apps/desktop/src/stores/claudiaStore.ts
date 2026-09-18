import { create } from 'zustand';
import type { SessionDraft } from '../types/composer';
import type {
  ClaudiaMessageMessage,
  BranchAction,
  ClaudiaAgentProfileSource,
  ClaudiaTaskStatus,
} from '@zclaudia/shared';

const LAST_VIEWED_KEY = 'claudia-last-viewed-at';

function loadLastViewedAt(): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(LAST_VIEWED_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function persistLastViewedAt(value: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LAST_VIEWED_KEY, String(value));
}

/** Legacy canonical task — kept as a read-only work reference (design §历史读取 P0-4). */
export interface ClaudiaTask {
  id: string; // orchestrator task ID
  sessionId: string | null; // backend agent session
  branchId: string | null; // branch this task belongs to
  branchAction?: BranchAction; // how branch was allocated
  contextReset?: boolean; // true if session resume failed
  input: string;
  title: string;
  status: ClaudiaTaskStatus;
  summary?: string;
  error?: string;
  responseText?: string; // Full assistant response
  toolCount?: number;
  createdAt: number;
  updatedAt: number;
}

/** A discussion thread = claudia_branches row + its bound standard session. */
export interface ClaudiaThreadSummary {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  lastTaskId: string | null;
  session: {
    id: string;
    name: string | null;
    agentProfileId: string | null;
    lastRunStatus: string | null;
    updatedAt: number | null;
  } | null;
}

/** One Claudia request's full identity + lifecycle (design §身份契约, P0). */
export interface ClaudiaRunInstance {
  clientRequestId: string;
  input: string;
  projectId: string;
  threadId: string | null;
  status:
    | 'submitting'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted'
    | 'rejected';
  userMessageId?: string;
  assistantMessageId?: string;
  originThreadId?: string | null;
  draftKey?: string;
  draftRestored?: boolean;
  draftAttachments?: SessionDraft['attachments'];
  request?: ClaudiaMessageMessage;
  lastSeq?: number;
  /** Stable run identity once accepted. */
  sessionId?: string;
  runId?: string;
  branchAction?: BranchAction;
  contextReset?: boolean;
  agentProfileId?: string;
  agentProfileSource?: ClaudiaAgentProfileSource;
  workingDirectory?: string;
  rejectCode?: string;
  error?: string;
  responseText?: string;
  createdAt: number;
  updatedAt: number;
}

/** Minimal transcript projection read from the standard session/message store. */
export interface ClaudiaFeedMessage {
  id: string;
  role: 'user' | 'assistant' | 'other';
  text: string;
  createdAt: number;
}

export interface ClaudiaBackendSlice {
  /** Legacy canonical task references (read-only compat). */
  tasks: ClaudiaTask[];
  threadsByProject: Record<string, ClaudiaThreadSummary[]>;
  /** Client-opened thread per project — wins over the project-state pointer. */
  activeThreadIdByProject: Record<string, string>;
  runs: ClaudiaRunInstance[];
  streamingText: Record<string, string>;
  messagesBySession: Record<string, ClaudiaFeedMessage[]>;
  messagesLoading: Record<string, boolean>;
  hydratedProjects: Record<string, boolean>;
}

function emptySlice(): ClaudiaBackendSlice {
  return {
    tasks: [],
    threadsByProject: {},
    activeThreadIdByProject: {},
    runs: [],
    streamingText: {},
    messagesBySession: {},
    messagesLoading: {},
    hydratedProjects: {},
  };
}

function withSlice(
  slices: Record<string, ClaudiaBackendSlice>,
  backendId: string,
  mutate: (slice: ClaudiaBackendSlice) => ClaudiaBackendSlice
): Record<string, ClaudiaBackendSlice> {
  const current = slices[backendId] ?? emptySlice();
  return { ...slices, [backendId]: mutate(current) };
}

interface ClaudiaState {
  /** All state is keyed by canonical backend id — snapshots and late events for
   *  one backend must never touch another backend's slice (design §backend 归属). */
  slices: Record<string, ClaudiaBackendSlice>;

  // UI state (single-shell, not backend scoped)
  isExpanded: boolean;
  returnTarget: {
    backendId: string;
    projectId: string;
    threadId: string;
    sessionId: string;
    scrollTop: number;
  } | null;
  setReturnTarget: (target: ClaudiaState['returnTarget']) => void;
  lastViewedAt: number;

  toggleExpanded: () => void;
  setExpanded: (v: boolean) => void;
  markViewed: () => void;

  ensureSlice: (backendId: string) => void;
  clearBackend: (backendId: string) => void;
  reset: () => void;

  // Thread reads (project-scoped within a backend)
  setThreads: (
    backendId: string,
    projectId: string,
    threads: ClaudiaThreadSummary[],
    requestedAt?: number
  ) => void;
  setActiveThread: (backendId: string, projectId: string, threadId: string | null) => void;

  // Transcript reads (standard session/message projection)
  setSessionMessages: (
    backendId: string,
    sessionId: string,
    messages: ClaudiaFeedMessage[]
  ) => void;
  setSessionMessagesLoading: (backendId: string, sessionId: string, loading: boolean) => void;

  // Run instances
  startRun: (backendId: string, run: ClaudiaRunInstance) => void;
  acceptRun: (
    backendId: string,
    clientRequestId: string,
    identity: {
      projectId: string;
      branchId: string;
      sessionId: string;
      runId: string;
      branchAction?: BranchAction;
      contextReset?: boolean;
      agentProfileId?: string;
      agentProfileSource?: ClaudiaAgentProfileSource;
      workingDirectory?: string;
      replay?: boolean;
      userMessageId?: string;
      assistantMessageId?: string;
    }
  ) => void;
  rejectRun: (
    backendId: string,
    clientRequestId: string,
    code: string,
    error: string,
    identity?: { projectId?: string; sessionId?: string; runId?: string }
  ) => void;
  appendRunDelta: (
    backendId: string,
    clientRequestId: string,
    content: string,
    seq?: number
  ) => void;
  applyRunSnapshot: (backendId: string, runId: string, content: string, seq?: number) => void;
  completeRun: (
    backendId: string,
    clientRequestId: string,
    responseText: string,
    identity?: { sessionId?: string; runId?: string }
  ) => void;
  failRun: (
    backendId: string,
    clientRequestId: string,
    error: string,
    identity?: { sessionId?: string; runId?: string }
  ) => void;
  removeRun: (backendId: string, clientRequestId: string) => void;

  // Legacy canonical task compat (read path only)
  addTask: (backendId: string, task: ClaudiaTask) => void;
  setTasks: (backendId: string, tasks: ClaudiaTask[]) => void;
  updateTask: (backendId: string, taskId: string, updates: Partial<ClaudiaTask>) => void;
  removeTask: (backendId: string, taskId: string) => void;
}

export const useClaudiaStore = create<ClaudiaState>(set => ({
  slices: {},
  isExpanded: false,
  returnTarget: null,
  setReturnTarget: returnTarget => set({ returnTarget }),
  lastViewedAt: loadLastViewedAt(),

  toggleExpanded: () =>
    set(s => {
      const isExpanded = !s.isExpanded;
      if (!isExpanded) return { isExpanded };
      const lastViewedAt = Date.now();
      persistLastViewedAt(lastViewedAt);
      return { isExpanded, lastViewedAt };
    }),
  setExpanded: v =>
    set(s => {
      if (!v) return { isExpanded: false };
      const lastViewedAt = Date.now();
      persistLastViewedAt(lastViewedAt);
      return { isExpanded: true, lastViewedAt: Math.max(s.lastViewedAt, lastViewedAt) };
    }),
  markViewed: () =>
    set(s => {
      const lastViewedAt = Date.now();
      persistLastViewedAt(lastViewedAt);
      return { lastViewedAt: Math.max(s.lastViewedAt, lastViewedAt) };
    }),

  ensureSlice: backendId =>
    set(s =>
      s.slices[backendId] ? s : { slices: withSlice(s.slices, backendId, slice => slice) }
    ),
  clearBackend: backendId =>
    set(s => {
      const { [backendId]: _, ...rest } = s.slices;
      return { slices: rest };
    }),
  reset: () =>
    set({ slices: {}, isExpanded: false, returnTarget: null, lastViewedAt: loadLastViewedAt() }),

  setThreads: (backendId, projectId, threads, requestedAt) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => ({
        ...slice,
        threadsByProject: {
          ...slice.threadsByProject,
          [projectId]:
            requestedAt == null
              ? threads
              : [
                  ...(slice.threadsByProject[projectId] ?? []).filter(
                    thread =>
                      !threads.some(incoming => incoming.id === thread.id) &&
                      slice.runs.some(
                        run =>
                          run.threadId === thread.id &&
                          run.sessionId &&
                          run.updatedAt >= requestedAt
                      )
                  ),
                  ...threads,
                ],
        },
      })),
    })),
  setActiveThread: (backendId, projectId, threadId) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => {
        const next = { ...slice.activeThreadIdByProject };
        if (!threadId) delete next[projectId];
        else next[projectId] = threadId;
        return { ...slice, activeThreadIdByProject: next };
      }),
    })),

  setSessionMessages: (backendId, sessionId, messages) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => ({
        ...slice,
        messagesBySession: { ...slice.messagesBySession, [sessionId]: messages },
        messagesLoading: { ...slice.messagesLoading, [sessionId]: false },
      })),
    })),
  setSessionMessagesLoading: (backendId, sessionId, loading) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => ({
        ...slice,
        messagesLoading: { ...slice.messagesLoading, [sessionId]: loading },
      })),
    })),

  startRun: (backendId, run) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => ({
        ...slice,
        runs: [
          ...slice.runs.filter(existing => existing.clientRequestId !== run.clientRequestId),
          run,
        ],
      })),
    })),

  acceptRun: (backendId, clientRequestId, identity) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => {
        const pending = slice.runs.find(run => run.clientRequestId === clientRequestId);
        const known = slice.threadsByProject[identity.projectId] ?? [];
        const existing = known.find(thread => thread.id === identity.branchId);
        const thread: ClaudiaThreadSummary = existing ?? {
          id: identity.branchId,
          projectId: identity.projectId,
          title: pending?.input.slice(0, 80) ?? 'Conversation',
          createdAt: pending?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          lastTaskId: null,
          session: {
            id: identity.sessionId,
            name: null,
            agentProfileId: identity.agentProfileId ?? null,
            lastRunStatus: null,
            updatedAt: Date.now(),
          },
        };
        const current = slice.activeThreadIdByProject[identity.projectId];
        const shouldOpen =
          pending?.status === 'submitting' &&
          (!current || current === (pending.originThreadId ?? pending.threadId));
        return {
          ...slice,
          threadsByProject: {
            ...slice.threadsByProject,
            [identity.projectId]: existing ? known : [thread, ...known],
          },
          activeThreadIdByProject: shouldOpen
            ? { ...slice.activeThreadIdByProject, [identity.projectId]: identity.branchId }
            : slice.activeThreadIdByProject,
          runs: slice.runs.map(run =>
            run.clientRequestId === clientRequestId
              ? {
                  ...run,
                  status: run.status === 'submitting' ? ('running' as const) : run.status,
                  sessionId: identity.sessionId,
                  runId: identity.runId,
                  projectId: identity.projectId,
                  threadId: identity.branchId,
                  branchAction: identity.branchAction ?? run.branchAction,
                  contextReset: identity.contextReset ?? run.contextReset,
                  agentProfileId: identity.agentProfileId ?? run.agentProfileId,
                  agentProfileSource: identity.agentProfileSource ?? run.agentProfileSource,
                  workingDirectory: identity.workingDirectory ?? run.workingDirectory,
                  userMessageId: identity.userMessageId ?? run.userMessageId,
                  assistantMessageId: identity.assistantMessageId ?? run.assistantMessageId,
                  updatedAt: Date.now(),
                }
              : run
          ),
        };
      }),
    })),

  rejectRun: (backendId, clientRequestId, code, error, identity) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => ({
        ...slice,
        runs: slice.runs.map(run =>
          run.clientRequestId === clientRequestId
            ? {
                ...run,
                status: 'rejected' as const,
                rejectCode: code,
                error,
                sessionId: identity?.sessionId ?? run.sessionId,
                runId: identity?.runId ?? run.runId,
                updatedAt: Date.now(),
              }
            : run
        ),
      })),
    })),

  appendRunDelta: (backendId, clientRequestId, content, seq) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => {
        const run = slice.runs.find(r => r.clientRequestId === clientRequestId);
        if (
          !run ||
          !['submitting', 'running'].includes(run.status) ||
          (seq != null && run.lastSeq != null && seq <= run.lastSeq)
        )
          return slice;
        return {
          ...slice,
          runs: slice.runs.map(r =>
            r === run ? { ...r, lastSeq: seq ?? r.lastSeq, updatedAt: Date.now() } : r
          ),
          streamingText: {
            ...slice.streamingText,
            [clientRequestId]:
              (slice.streamingText[clientRequestId] ?? run.responseText ?? '') + content,
          },
        };
      }),
    })),

  applyRunSnapshot: (backendId, runId, content, seq) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => {
        const run = slice.runs.find(r => r.runId === runId);
        if (
          !run ||
          run.status !== 'running' ||
          (run.lastSeq != null && (seq == null || seq < run.lastSeq))
        )
          return slice;
        return {
          ...slice,
          runs: slice.runs.map(r => (r === run ? { ...r, lastSeq: seq ?? r.lastSeq } : r)),
          streamingText: { ...slice.streamingText, [run.clientRequestId]: content },
        };
      }),
    })),

  completeRun: (backendId, clientRequestId, responseText, identity) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => {
        const { [clientRequestId]: _cleared, ...restStreaming } = slice.streamingText;
        return {
          ...slice,
          streamingText: restStreaming,
          runs: slice.runs.map(run =>
            run.clientRequestId === clientRequestId
              ? {
                  ...run,
                  status: 'completed' as const,
                  responseText,
                  sessionId: identity?.sessionId ?? run.sessionId,
                  runId: identity?.runId ?? run.runId,
                  updatedAt: Date.now(),
                }
              : run
          ),
        };
      }),
    })),

  failRun: (backendId, clientRequestId, error, identity) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => {
        const { [clientRequestId]: _cleared, ...restStreaming } = slice.streamingText;
        return {
          ...slice,
          streamingText: restStreaming,
          runs: slice.runs.map(run =>
            run.clientRequestId === clientRequestId
              ? {
                  ...run,
                  status:
                    error === 'Run cancelled by user'
                      ? ('cancelled' as const)
                      : ('failed' as const),
                  error,
                  responseText: slice.streamingText[clientRequestId] ?? run.responseText,
                  sessionId: identity?.sessionId ?? run.sessionId,
                  runId: identity?.runId ?? run.runId,
                  updatedAt: Date.now(),
                }
              : run
          ),
        };
      }),
    })),

  removeRun: (backendId, clientRequestId) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => ({
        ...slice,
        runs: slice.runs.filter(run => run.clientRequestId !== clientRequestId),
      })),
    })),

  addTask: (backendId, task) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => ({
        ...slice,
        tasks: [
          { ...task, updatedAt: task.updatedAt || task.createdAt },
          ...slice.tasks.filter(existing => existing.id !== task.id),
        ],
      })),
    })),

  setTasks: (backendId, tasks) =>
    set(s => ({
      // Snapshot scope: replaces only THIS backend's legacy task references.
      slices: withSlice(s.slices, backendId, slice => ({
        ...slice,
        tasks: tasks.map(task => ({ ...task, updatedAt: task.updatedAt || task.createdAt })),
      })),
    })),

  updateTask: (backendId, taskId, updates) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => ({
        ...slice,
        tasks: slice.tasks.map(task =>
          task.id === taskId
            ? { ...task, ...updates, updatedAt: updates.updatedAt || Date.now() }
            : task
        ),
      })),
    })),

  removeTask: (backendId, taskId) =>
    set(s => ({
      slices: withSlice(s.slices, backendId, slice => ({
        ...slice,
        tasks: slice.tasks.filter(task => task.id !== taskId),
      })),
    })),
}));

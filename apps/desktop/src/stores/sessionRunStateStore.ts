import { create } from 'zustand';
import type { RunStatus } from '@zclaudia/protocol/zclaudia';
import type { SessionRunStatus } from '@zclaudia/shared/core/session';
import {
  cleanupForegroundChatRunsForBackend,
  cleanupForegroundChatRunsForSession,
  clearSessionBlockingState,
  resolveRunSessionId,
  setLegacySessionActive,
} from '../services/session-run-coordination';

export type SessionRunPhase = Exclude<SessionRunStatus, 'failed'>;

export type SessionRunStateSource =
  | 'run_event'
  | 'heartbeat'
  | 'backend_snapshot'
  | 'backend_event'
  | 'session_sync';

export interface SessionRunRecord {
  backendId: string;
  sessionId: string;
  phase: SessionRunPhase;
  foregroundRunIds: string[];
  updatedAt: number;
  source: SessionRunStateSource;
}

interface ActiveRunInput {
  runId: string;
  sessionId: string;
  sessionType?: string;
}

interface SessionRunState {
  records: Record<string, SessionRunRecord>;
  markRunStarted: (input: {
    backendId?: string | null;
    runId: string;
    sessionId: string;
    sessionType?: string;
    source?: SessionRunStateSource;
  }) => void;
  markRunEnded: (input: {
    backendId?: string | null;
    runId: string;
    sessionId?: string | null;
    source?: SessionRunStateSource;
    cleanupChatRuns?: boolean;
  }) => void;
  applySessionRunStatus: (input: {
    backendId?: string | null;
    sessionId: string;
    runStatus?: RunStatus | null;
    isActive?: boolean;
    source: SessionRunStateSource;
  }) => void;
  reconcileBackendActiveRuns: (input: {
    backendId?: string | null;
    activeRuns: ActiveRunInput[];
    source: SessionRunStateSource;
    cleanupChatRuns?: boolean;
  }) => void;
  reconcileBackendSessionStatuses: (input: {
    backendId?: string | null;
    sessions: Array<{ sessionId: string; runStatus?: RunStatus | null; isActive?: boolean }>;
    knownSessionIds?: string[];
    source: SessionRunStateSource;
  }) => void;
  markSessionInactive: (input: {
    backendId?: string | null;
    sessionId: string;
    source: SessionRunStateSource;
    cleanupChatRuns?: boolean;
  }) => void;
  clearBackend: (backendId?: string | null) => void;
}

const LOCAL_BACKEND_KEY = '__local__';

export function isSessionRunActive(record: SessionRunRecord | undefined): boolean {
  return record?.phase === 'running' || record?.phase === 'waiting';
}

function isForegroundRun(sessionType?: string): boolean {
  return sessionType !== 'background';
}

function normalizeBackendId(backendId: string | null | undefined): string {
  return backendId ?? LOCAL_BACKEND_KEY;
}

function recordKey(backendId: string, sessionId: string): string {
  return `${backendId}::${sessionId}`;
}

function runStatusToPhase(runStatus?: RunStatus | null, isActive?: boolean): SessionRunPhase {
  if (runStatus === 'waiting') return 'waiting';
  if (runStatus === 'running') return 'running';
  if (isActive) return 'running';
  return 'idle';
}

export const useSessionRunStateStore = create<SessionRunState>((set, get) => ({
  records: {},

  markRunStarted: ({ backendId, runId, sessionId, sessionType, source = 'run_event' }) => {
    if (!isForegroundRun(sessionType)) return;
    const normalizedBackendId = normalizeBackendId(backendId);
    const key = recordKey(normalizedBackendId, sessionId);
    set(state => {
      const existing = state.records[key];
      const runIds = new Set(existing?.foregroundRunIds ?? []);
      runIds.add(runId);
      return {
        records: {
          ...state.records,
          [key]: {
            backendId: normalizedBackendId,
            sessionId,
            phase: 'running',
            foregroundRunIds: [...runIds],
            updatedAt: Date.now(),
            source,
          },
        },
      };
    });
    setLegacySessionActive(normalizedBackendId, sessionId, true);
  },

  markRunEnded: ({
    backendId,
    runId,
    sessionId,
    source = 'run_event',
    cleanupChatRuns = false,
  }) => {
    const normalizedBackendId = normalizeBackendId(backendId);
    const resolvedSessionId = sessionId || resolveRunSessionId(runId, get().records);
    if (!resolvedSessionId) return;

    let nextPhase: SessionRunPhase = 'idle';
    set(state => {
      const records = { ...state.records };
      const candidateKeys = Object.keys(records).filter(key => {
        const record = records[key];
        return (
          record.sessionId === resolvedSessionId &&
          (!backendId || record.backendId === normalizedBackendId)
        );
      });
      const keys =
        candidateKeys.length > 0
          ? candidateKeys
          : [recordKey(normalizedBackendId, resolvedSessionId)];

      for (const key of keys) {
        const existing = records[key];
        const remaining = (existing?.foregroundRunIds ?? []).filter(id => id !== runId);
        nextPhase = remaining.length > 0 ? 'running' : 'idle';
        records[key] = {
          backendId: existing?.backendId ?? normalizedBackendId,
          sessionId: resolvedSessionId,
          phase: nextPhase,
          foregroundRunIds: remaining,
          updatedAt: Date.now(),
          source,
        };
      }
      return { records };
    });

    if (cleanupChatRuns) {
      cleanupForegroundChatRunsForSession(resolvedSessionId, new Set());
      clearSessionBlockingState(resolvedSessionId);
    }
    if (nextPhase === 'idle') {
      setLegacySessionActive(normalizedBackendId, resolvedSessionId, false);
    }
  },

  applySessionRunStatus: ({ backendId, sessionId, runStatus, isActive, source }) => {
    const phase = runStatusToPhase(runStatus, isActive);
    if (phase === 'idle') {
      // Session catalog state is not an authoritative run terminal signal.
      // Keep the chat run/assistant identity until run_completed/run_failed or
      // heartbeat reconciliation can finalize it and recover the persisted tail.
      get().markSessionInactive({ backendId, sessionId, source, cleanupChatRuns: false });
      return;
    }

    const normalizedBackendId = normalizeBackendId(backendId);
    const key = recordKey(normalizedBackendId, sessionId);
    set(state => {
      const existing = state.records[key];
      return {
        records: {
          ...state.records,
          [key]: {
            backendId: normalizedBackendId,
            sessionId,
            phase,
            foregroundRunIds: existing?.foregroundRunIds ?? [],
            updatedAt: Date.now(),
            source,
          },
        },
      };
    });
    setLegacySessionActive(normalizedBackendId, sessionId, true);
  },

  reconcileBackendActiveRuns: ({ backendId, activeRuns, source, cleanupChatRuns = true }) => {
    const normalizedBackendId = normalizeBackendId(backendId);
    const foregroundRuns = activeRuns.filter(run => isForegroundRun(run.sessionType));
    const activeRunIds = new Set(foregroundRuns.map(run => run.runId));
    const activeSessionRunIds = new Map<string, Set<string>>();
    for (const run of foregroundRuns) {
      const runIds = activeSessionRunIds.get(run.sessionId) ?? new Set<string>();
      runIds.add(run.runId);
      activeSessionRunIds.set(run.sessionId, runIds);
    }

    const staleSessionIds = new Set<string>();
    const knownSessionIds = new Set<string>(activeSessionRunIds.keys());
    set(state => {
      const records = { ...state.records };
      for (const record of Object.values(records)) {
        if (record.backendId !== normalizedBackendId) continue;
        knownSessionIds.add(record.sessionId);
        if (!activeSessionRunIds.has(record.sessionId) && isSessionRunActive(record)) {
          staleSessionIds.add(record.sessionId);
          records[recordKey(normalizedBackendId, record.sessionId)] = {
            ...record,
            phase: 'idle',
            foregroundRunIds: [],
            updatedAt: Date.now(),
            source,
          };
        }
      }

      for (const [sessionId, runIds] of activeSessionRunIds) {
        records[recordKey(normalizedBackendId, sessionId)] = {
          backendId: normalizedBackendId,
          sessionId,
          phase: 'running',
          foregroundRunIds: [...runIds],
          updatedAt: Date.now(),
          source,
        };
      }

      return { records };
    });

    if (cleanupChatRuns) {
      cleanupForegroundChatRunsForBackend(normalizedBackendId, activeRunIds, knownSessionIds);
    }

    for (const sessionId of staleSessionIds) {
      setLegacySessionActive(normalizedBackendId, sessionId, false);
    }
    for (const sessionId of activeSessionRunIds.keys()) {
      setLegacySessionActive(normalizedBackendId, sessionId, true);
    }
  },

  reconcileBackendSessionStatuses: ({ backendId, sessions, knownSessionIds = [], source }) => {
    const normalizedBackendId = normalizeBackendId(backendId);
    const activeSessionIds = new Set<string>();
    const presentSessionIds = new Set(sessions.map(session => session.sessionId));
    const cleanupKnownSessionIds = new Set([...knownSessionIds, ...presentSessionIds]);

    set(state => {
      const records = { ...state.records };
      for (const session of sessions) {
        const phase = runStatusToPhase(session.runStatus, session.isActive);
        const key = recordKey(normalizedBackendId, session.sessionId);
        const existing = records[key];
        if (phase === 'idle') {
          records[key] = {
            backendId: normalizedBackendId,
            sessionId: session.sessionId,
            phase: 'idle',
            foregroundRunIds: [],
            updatedAt: Date.now(),
            source,
          };
        } else {
          activeSessionIds.add(session.sessionId);
          records[key] = {
            backendId: normalizedBackendId,
            sessionId: session.sessionId,
            phase,
            foregroundRunIds: existing?.foregroundRunIds ?? [],
            updatedAt: Date.now(),
            source,
          };
        }
      }

      for (const record of Object.values(records)) {
        if (record.backendId !== normalizedBackendId) continue;
        if (presentSessionIds.has(record.sessionId) || !isSessionRunActive(record)) continue;
        records[recordKey(normalizedBackendId, record.sessionId)] = {
          ...record,
          phase: 'idle',
          foregroundRunIds: [],
          updatedAt: Date.now(),
          source,
        };
      }

      return { records };
    });

    for (const session of sessions) {
      if (activeSessionIds.has(session.sessionId)) {
        setLegacySessionActive(normalizedBackendId, session.sessionId, true);
      } else {
        setLegacySessionActive(normalizedBackendId, session.sessionId, false);
      }
    }
    // Do not tear down chat runs from a catalog snapshot. A terminal event or
    // active-run heartbeat owns that transition and preserves final-message
    // ordering. cleanupKnownSessionIds remains part of snapshot accounting for
    // callers but is intentionally not used as terminal evidence.
    void cleanupKnownSessionIds;
  },

  markSessionInactive: ({ backendId, sessionId, source, cleanupChatRuns = true }) => {
    const normalizedBackendId = normalizeBackendId(backendId);
    const key = recordKey(normalizedBackendId, sessionId);
    set(state => ({
      records: {
        ...state.records,
        [key]: {
          backendId: normalizedBackendId,
          sessionId,
          phase: 'idle',
          foregroundRunIds: [],
          updatedAt: Date.now(),
          source,
        },
      },
    }));
    if (cleanupChatRuns) {
      cleanupForegroundChatRunsForSession(sessionId);
      clearSessionBlockingState(sessionId);
    }
    setLegacySessionActive(normalizedBackendId, sessionId, false);
  },

  clearBackend: backendId => {
    const normalizedBackendId = normalizeBackendId(backendId);
    set(state => ({
      records: Object.fromEntries(
        Object.entries(state.records).filter(
          ([, record]) => record.backendId !== normalizedBackendId
        )
      ),
    }));
  },
}));

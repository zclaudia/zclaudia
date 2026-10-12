/**
 * Sessions Store - manages remote sessions from connected backends
 */
import { create } from 'zustand';
import type { Session } from '@zclaudia/shared/core/session';
import {
  clearSessionOwnership,
  forgetSession,
  forgetSessionOwnersForBackend,
  recordSessionOwner,
  reassignSessionOwnersForBackend,
} from '../services/session-ownership-coordination';
import { LEGACY_LOCAL_SERVER_ID, resolveCanonicalBackendId } from '../actions/controlPlane';

export interface RemoteSession extends Session {
  isActive: boolean; // Whether there's an active run
  lastMessageOffset?: number; // Max message offset (for gap detection)
  messageVersion?: number; // Detects updates to an existing same-offset message
}

export const LOCAL_BACKEND_KEY = '__local__';

export function isLocalSessionBucketKey(backendId: string | null | undefined): boolean {
  return backendId === LOCAL_BACKEND_KEY;
}

export function getSessionBucketKeyForBackend(backendId: string | null | undefined): string {
  return backendId ?? LOCAL_BACKEND_KEY;
}

export function resolveSessionBucketBackendId(
  backendId: string | null | undefined,
  localBackendId: string | null = null
): string | null {
  if (backendId === LOCAL_BACKEND_KEY) {
    return resolveCanonicalBackendId(
      localBackendId ?? LEGACY_LOCAL_SERVER_ID,
      localBackendId ?? LEGACY_LOCAL_SERVER_ID
    );
  }
  return backendId ?? null;
}

interface SessionsState {
  // Remote sessions organized by backendId
  remoteSessions: Map<string, RemoteSession[]>;
  /** Incremental events can create a bucket before its complete snapshot arrives. */
  snapshotBackendIds: Set<string>;
  /** Complete snapshot revisions; incremental events never advance this marker. */
  snapshotGenerations: Map<string, number>;
  nextSnapshotGeneration: number;
  /** Only positive local create responses receive the one-snapshot admission grace. */
  pendingAdmissions: Map<string, Map<string, { session: RemoteSession; missedSnapshots: number }>>;
  deletedSessionIds: Map<string, Set<string>>;
  /** Explicit removes outrank the first in-flight full snapshot that still contains the id. */
  pendingDeletionConfirmations: Map<string, Map<string, number>>;
  // Single source of truth for active sessions by backend key
  // - local direct server: "__local__"
  // - gateway backend: raw backendId
  activeSessionIdsByBackend: Map<string, Set<string>>;

  // Actions
  setRemoteSessions: (backendId: string, sessions: RemoteSession[]) => void;
  admitCreatedSession: (backendId: string, session: RemoteSession) => void;
  handleSessionEvent: (
    backendId: string,
    eventType: 'created' | 'updated' | 'deleted',
    session: RemoteSession
  ) => void;
  setActiveSessionsForBackend: (backendId: string, activeSessionIds: Set<string>) => void;
  setSessionActiveFlag: (backendId: string, sessionId: string, isActive: boolean) => void;
  reconcileActiveStatus: (backendId: string, activeSessionIds: Set<string>) => void;
  setSessionActiveById: (backendId: string, sessionId: string, isActive: boolean) => void;
  clearBackendSessions: (backendId: string) => void;
  clearAllSessions: () => void;
}

export const useSessionsStore = create<SessionsState>(set => ({
  remoteSessions: new Map(),
  snapshotBackendIds: new Set(),
  snapshotGenerations: new Map(),
  nextSnapshotGeneration: 1,
  pendingAdmissions: new Map(),
  deletedSessionIds: new Map(),
  pendingDeletionConfirmations: new Map(),
  activeSessionIdsByBackend: new Map(),

  setRemoteSessions: (backendId: string, sessions: RemoteSession[]) => {
    // Note: caller (backend_data_snapshot handler) already checks sessionsChanged
    // before calling this method, so no duplicate diff check needed here.
    set(state => {
      const pendingDeletionConfirmations = new Map(state.pendingDeletionConfirmations);
      const deletionConfirmations = new Map(pendingDeletionConfirmations.get(backendId));
      const incoming = sessions.filter(session => {
        const confirmations = deletionConfirmations.get(session.id);
        if (confirmations === undefined) return true;
        if (confirmations >= 1) {
          deletionConfirmations.delete(session.id);
          return true;
        }
        deletionConfirmations.set(session.id, 1);
        return false;
      });
      const receivedIds = new Set(sessions.map(session => session.id));
      for (const id of deletionConfirmations.keys()) {
        if (!receivedIds.has(id)) deletionConfirmations.delete(id);
      }
      if (deletionConfirmations.size)
        pendingDeletionConfirmations.set(backendId, deletionConfirmations);
      else pendingDeletionConfirmations.delete(backendId);
      const incomingIds = new Set(incoming.map(session => session.id));
      const pendingAdmissions = new Map(state.pendingAdmissions);
      const pending = new Map(pendingAdmissions.get(backendId));
      const admitted: RemoteSession[] = [];
      // A full request can start before REST creation and finish after it.
      // Retain only positively admitted new ids for that first missing response;
      // a second missing full response or any explicit delete ends the grace.
      for (const [id, admission] of pending) {
        if (incomingIds.has(id) || admission.missedSnapshots >= 1) pending.delete(id);
        else {
          pending.set(id, { ...admission, missedSnapshots: 1 });
          admitted.push(admission.session);
        }
      }
      if (pending.size) pendingAdmissions.set(backendId, pending);
      else pendingAdmissions.delete(backendId);
      const merged = [...incoming, ...admitted];
      reassignSessionOwnersForBackend(
        backendId,
        merged.map(session => session.id)
      );
      const validIds = new Set(merged.map(session => session.id));
      const deletedSessionIds = new Map(state.deletedSessionIds);
      const deleted = new Set(deletedSessionIds.get(backendId));
      for (const session of state.remoteSessions.get(backendId) ?? []) {
        if (!validIds.has(session.id)) deleted.add(session.id);
      }
      for (const id of validIds) deleted.delete(id);
      deletedSessionIds.set(backendId, deleted);
      const newMap = new Map(state.remoteSessions);
      newMap.set(backendId, merged);

      // Keep active index in sync with incoming snapshot
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      const activeIds = new Set<string>(merged.filter(s => s.isActive).map(s => s.id));
      newActiveMap.set(backendId, activeIds);

      return {
        remoteSessions: newMap,
        snapshotBackendIds: new Set([...state.snapshotBackendIds, backendId]),
        snapshotGenerations: new Map(state.snapshotGenerations).set(
          backendId,
          state.nextSnapshotGeneration
        ),
        nextSnapshotGeneration: state.nextSnapshotGeneration + 1,
        pendingAdmissions,
        deletedSessionIds,
        pendingDeletionConfirmations,
        activeSessionIdsByBackend: newActiveMap,
      };
    });
  },

  admitCreatedSession: (backendId, session) => {
    recordSessionOwner(session.id, backendId);
    set(state => {
      if (state.remoteSessions.get(backendId)?.some(item => item.id === session.id)) return state;
      const pendingAdmissions = new Map(state.pendingAdmissions);
      const pending = new Map(pendingAdmissions.get(backendId));
      pending.set(session.id, { session, missedSnapshots: 0 });
      pendingAdmissions.set(backendId, pending);
      const deletedSessionIds = new Map(state.deletedSessionIds);
      const deleted = new Set(deletedSessionIds.get(backendId));
      deleted.delete(session.id);
      deletedSessionIds.set(backendId, deleted);
      const pendingDeletionConfirmations = new Map(state.pendingDeletionConfirmations);
      const deletionConfirmations = new Map(pendingDeletionConfirmations.get(backendId));
      deletionConfirmations.delete(session.id);
      if (deletionConfirmations.size)
        pendingDeletionConfirmations.set(backendId, deletionConfirmations);
      else pendingDeletionConfirmations.delete(backendId);
      return {
        pendingAdmissions,
        deletedSessionIds,
        pendingDeletionConfirmations,
        remoteSessions: new Map(state.remoteSessions).set(backendId, [
          ...(state.remoteSessions.get(backendId) ?? []),
          session,
        ]),
        ...(session.isActive
          ? {
              activeSessionIdsByBackend: new Map(state.activeSessionIdsByBackend).set(
                backendId,
                new Set([...(state.activeSessionIdsByBackend.get(backendId) ?? []), session.id])
              ),
            }
          : {}),
      };
    });
  },

  handleSessionEvent: (
    backendId: string,
    eventType: 'created' | 'updated' | 'deleted',
    session: RemoteSession
  ) => {
    if (eventType === 'deleted') {
      forgetSession(session.id);
    } else {
      recordSessionOwner(session.id, backendId);
    }
    set(state => {
      const newMap = new Map(state.remoteSessions);
      const backendSessions = newMap.get(backendId) || [];
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      const backendActive = new Set(newActiveMap.get(backendId) || []);
      const pendingAdmissions = new Map(state.pendingAdmissions);
      const pending = new Map(pendingAdmissions.get(backendId));
      const admission = pending.get(session.id);
      if (eventType === 'deleted') pending.delete(session.id);
      else if (admission)
        pending.set(session.id, { ...admission, session: { ...admission.session, ...session } });
      if (pending.size) pendingAdmissions.set(backendId, pending);
      else pendingAdmissions.delete(backendId);
      const deletedSessionIds = new Map(state.deletedSessionIds);
      const deleted = new Set(deletedSessionIds.get(backendId));
      if (eventType === 'deleted') deleted.add(session.id);
      else deleted.delete(session.id);
      deletedSessionIds.set(backendId, deleted);
      const pendingDeletionConfirmations = new Map(state.pendingDeletionConfirmations);
      const deletionConfirmations = new Map(pendingDeletionConfirmations.get(backendId));
      if (eventType === 'deleted') deletionConfirmations.set(session.id, 0);
      else deletionConfirmations.delete(session.id);
      if (deletionConfirmations.size)
        pendingDeletionConfirmations.set(backendId, deletionConfirmations);
      else pendingDeletionConfirmations.delete(backendId);

      if (eventType === 'created') {
        // Dedup: skip if session already exists (e.g. both WebSocket push and sessionSync detected it)
        if (backendSessions.some(s => s.id === session.id)) {
          if (!state.pendingAdmissions.get(backendId)?.has(session.id)) return state;
          newMap.set(
            backendId,
            backendSessions.map(item => (item.id === session.id ? session : item))
          );
        } else newMap.set(backendId, [...backendSessions, session]);
        if (session.isActive) backendActive.add(session.id);
      } else if (eventType === 'updated') {
        // Update existing session
        newMap.set(
          backendId,
          backendSessions.map(s => (s.id === session.id ? session : s))
        );
        if (session.isActive) backendActive.add(session.id);
        else backendActive.delete(session.id);
      } else if (eventType === 'deleted') {
        // Remove session
        newMap.set(
          backendId,
          backendSessions.filter(s => s.id !== session.id)
        );
        backendActive.delete(session.id);
      }

      newActiveMap.set(backendId, backendActive);
      return {
        remoteSessions: newMap,
        pendingAdmissions,
        deletedSessionIds,
        pendingDeletionConfirmations,
        activeSessionIdsByBackend: newActiveMap,
      };
    });
  },

  setActiveSessionsForBackend: (backendId: string, activeSessionIds: Set<string>) => {
    set(state => {
      const current = state.activeSessionIdsByBackend.get(backendId);
      if (current && current.size === activeSessionIds.size) {
        let same = true;
        for (const id of activeSessionIds) {
          if (!current.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return state;
      }

      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      newActiveMap.set(backendId, new Set(activeSessionIds));
      return { activeSessionIdsByBackend: newActiveMap };
    });
  },

  setSessionActiveFlag: (backendId: string, sessionId: string, isActive: boolean) => {
    set(state => {
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      const backendActive = new Set(newActiveMap.get(backendId) || []);

      const had = backendActive.has(sessionId);
      if (isActive) backendActive.add(sessionId);
      else backendActive.delete(sessionId);

      if (had === backendActive.has(sessionId)) return state;

      newActiveMap.set(backendId, backendActive);
      return { activeSessionIdsByBackend: newActiveMap };
    });
  },

  // Update isActive status based on backend's state heartbeat
  reconcileActiveStatus: (backendId: string, activeSessionIds: Set<string>) => {
    set(state => {
      const sessions = state.remoteSessions.get(backendId);
      if (!sessions) return state;

      // Check if any session's isActive actually changed
      const changed = sessions.some(s => s.isActive !== activeSessionIds.has(s.id));
      if (!changed) return state;

      const updated = sessions.map(s => ({
        ...s,
        isActive: activeSessionIds.has(s.id),
      }));

      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      newActiveMap.set(backendId, new Set(activeSessionIds));

      const newMap = new Map(state.remoteSessions);
      newMap.set(backendId, updated);
      return {
        remoteSessions: newMap,
        activeSessionIdsByBackend: newActiveMap,
      };
    });
  },

  // Set isActive for a specific session (used by run_started / run_failed / run_completed)
  setSessionActiveById: (backendId: string, sessionId: string, isActive: boolean) => {
    set(state => {
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      const backendActive = new Set(newActiveMap.get(backendId) || []);
      if (isActive) backendActive.add(sessionId);
      else backendActive.delete(sessionId);
      newActiveMap.set(backendId, backendActive);

      const sessions = state.remoteSessions.get(backendId);
      if (!sessions) return { activeSessionIdsByBackend: newActiveMap };

      const idx = sessions.findIndex(s => s.id === sessionId);
      if (idx === -1 || sessions[idx].isActive === isActive) {
        return { activeSessionIdsByBackend: newActiveMap };
      }

      const newMap = new Map(state.remoteSessions);
      const updated = [...sessions];
      updated[idx] = { ...updated[idx], isActive };
      newMap.set(backendId, updated);

      return {
        remoteSessions: newMap,
        activeSessionIdsByBackend: newActiveMap,
      };
    });
  },

  clearBackendSessions: (backendId: string) => {
    forgetSessionOwnersForBackend(backendId);
    set(state => {
      const newMap = new Map(state.remoteSessions);
      newMap.delete(backendId);
      const newActiveMap = new Map(state.activeSessionIdsByBackend);
      newActiveMap.delete(backendId);
      const snapshotBackendIds = new Set(state.snapshotBackendIds);
      snapshotBackendIds.delete(backendId);
      const snapshotGenerations = new Map(state.snapshotGenerations);
      snapshotGenerations.delete(backendId);
      const pendingAdmissions = new Map(state.pendingAdmissions);
      pendingAdmissions.delete(backendId);
      const deletedSessionIds = new Map(state.deletedSessionIds);
      deletedSessionIds.delete(backendId);
      const pendingDeletionConfirmations = new Map(state.pendingDeletionConfirmations);
      pendingDeletionConfirmations.delete(backendId);
      return {
        remoteSessions: newMap,
        snapshotBackendIds,
        snapshotGenerations,
        pendingAdmissions,
        deletedSessionIds,
        pendingDeletionConfirmations,
        activeSessionIdsByBackend: newActiveMap,
      };
    });
  },

  clearAllSessions: () => {
    clearSessionOwnership();
    set({
      remoteSessions: new Map(),
      snapshotBackendIds: new Set(),
      snapshotGenerations: new Map(),
      pendingAdmissions: new Map(),
      deletedSessionIds: new Map(),
      pendingDeletionConfirmations: new Map(),
      activeSessionIdsByBackend: new Map(),
    });
  },
}));

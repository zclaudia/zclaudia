import type { Session, Message } from '@zclaudia/shared';
import { fetchApiForBackend } from './base';
import { apiCall, apiCallForBackend, apiCallVoid, apiCallVoidForBackend } from './unwrap';

/**
 * Server-side shape of a single compaction record. Mirrors the server's
 * `compaction-tree-read.SessionCompaction` (projected from the session tree) —
 * we keep it inline rather than crossing the server/desktop boundary with that
 * type so the desktop package doesn't import server internals.
 */
export interface SessionCompactionResponse {
  id: string;
  sessionId: string;
  summary: string;
  firstKeptMessageId: string;
  tokensBefore: number;
  details: { readFiles: string[]; modifiedFiles: string[] } | null;
  source: 'auto' | 'manual' | 'overflow';
  customInstructions: string | null;
  createdAt: number;
}

export async function getSessionCompaction(
  sessionId: string,
  compactionId: string,
): Promise<SessionCompactionResponse> {
  return apiCallForBackend<SessionCompactionResponse>(
    getBackendIdForSession(sessionId),
    `/api/sessions/${sessionId}/compactions/${compactionId}`,
  );
}
import { useOwnershipStore } from '../../stores/ownershipStore';
import { resolveSessionOwnerBackendId } from '../../utils/sessionOwnership';

function getBackendIdForSession(sessionId: string): string | null {
  return resolveSessionOwnerBackendId(sessionId);
}

function getBackendIdForProject(projectId: string): string | null {
  return useOwnershipStore.getState().getProjectBackendId(projectId);
}

export async function getSessions(projectId?: string, options?: RequestInit): Promise<Session[]> {
  const query = projectId ? `?projectId=${projectId}` : '';
  return apiCallForBackend<Session[]>(projectId ? getBackendIdForProject(projectId) : null, `/api/sessions${query}`, options);
}

export async function reorderSessions(projectId: string, orderedIds: string[]): Promise<void> {
  return apiCallVoid('/api/sessions/reorder', {
    method: 'POST',
    body: JSON.stringify({ projectId, orderedIds }),
  });
}

export async function getSessionRunState(sessionId: string): Promise<{ sessionId: string; isRunning: boolean; activeRunId?: string }> {
  return apiCallForBackend<{ sessionId: string; isRunning: boolean; activeRunId?: string }>(
    getBackendIdForSession(sessionId),
    `/api/sessions/${sessionId}/run-state`
  );
}

export async function createSession(data: {
  projectId: string;
  name?: string;
  agentProfileId?: string;
  type?: import('@zclaudia/shared').SessionType;
  parentSessionId?: string;
  workingDirectory?: string;
}): Promise<Session> {
  return apiCallForBackend<Session>(getBackendIdForProject(data.projectId), '/api/sessions', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateSession(
  id: string,
  data: Partial<Session>
): Promise<void> {
  return apiCallVoidForBackend(getBackendIdForSession(id), `/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function updateSessionWorkingDirectory(
  sessionId: string,
  workingDirectory: string
): Promise<Session> {
  return apiCallForBackend<Session>(getBackendIdForSession(sessionId), `/api/sessions/${sessionId}/working-directory`, {
    method: 'PATCH',
    body: JSON.stringify({ workingDirectory })
  });
}

export async function resetSessionSdkSession(sessionId: string): Promise<void> {
  return apiCallVoidForBackend(getBackendIdForSession(sessionId), `/api/sessions/${sessionId}/reset-sdk-session`, { method: 'POST' });
}

export async function dismissInterrupted(sessionId: string): Promise<void> {
  // Fire-and-forget, no error check
  await fetchApiForBackend(`/api/sessions/${sessionId}/dismiss-interrupted`, getBackendIdForSession(sessionId), { method: 'PATCH' });
}

export async function unlockSession(sessionId: string): Promise<Session> {
  return apiCallForBackend<Session>(getBackendIdForSession(sessionId), `/api/sessions/${sessionId}/unlock`, { method: 'PATCH' });
}

export async function deleteSession(id: string): Promise<void> {
  return apiCallVoidForBackend(getBackendIdForSession(id), `/api/sessions/${id}`, { method: 'DELETE' });
}

export async function archiveSessions(sessionIds: string[]): Promise<void> {
  return apiCallVoid('/api/sessions/archive', {
    method: 'POST',
    body: JSON.stringify({ sessionIds })
  });
}

export async function restoreSessions(sessionIds: string[]): Promise<void> {
  return apiCallVoid('/api/sessions/restore', {
    method: 'POST',
    body: JSON.stringify({ sessionIds })
  });
}

export async function getArchivedSessions(): Promise<Session[]> {
  return apiCall<Session[]>('/api/sessions/archived');
}

interface PaginationInfo {
  total: number;
  hasMore: boolean;
  oldestTimestamp?: number;
  newestTimestamp?: number;
  maxOffset?: number;
}

interface MessagesResponse {
  messages: Message[];
  pagination: PaginationInfo;
  activeRun?: { runId: string } | null;
}

export async function getSessionMessages(
  sessionId: string,
  options?: {
    limit?: number;
    before?: number;
    after?: number;
    afterOffset?: number;
    aroundMessageId?: string;
    signal?: AbortSignal;
  }
): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', String(options.before));
  if (options?.after) params.set('after', String(options.after));
  if (options?.afterOffset != null) params.set('afterOffset', String(options.afterOffset));
  if (options?.aroundMessageId) params.set('aroundMessageId', options.aroundMessageId);

  const query = params.toString() ? `?${params.toString()}` : '';
  return apiCallForBackend<MessagesResponse>(getBackendIdForSession(sessionId), `/api/sessions/${sessionId}/messages${query}`, {
    signal: options?.signal,
  });
}

export async function exportSession(sessionId: string): Promise<{ markdown: string; sessionName: string }> {
  return apiCallForBackend<{ markdown: string; sessionName: string }>(getBackendIdForSession(sessionId), `/api/sessions/${sessionId}/export`);
}

/**
 * Fork a session at a specific tree entry — creates a new session whose history
 * is copied up to (and including) the targeted message. The original session is
 * left untouched.
 *
 * POST /api/sessions/:id/fork  { treeEntryId, name? }
 * Returns the newly-created Session (201).
 */
export async function forkSession(
  sessionId: string,
  treeEntryId: string,
  name?: string,
): Promise<Session> {
  return apiCallForBackend<Session>(
    getBackendIdForSession(sessionId),
    `/api/sessions/${sessionId}/fork`,
    {
      method: 'POST',
      body: JSON.stringify({ treeEntryId, ...(name ? { name } : {}) }),
    },
  );
}

/**
 * Branch (rewind) a session from a specific tree entry — rewrites the session's
 * live timeline to start from that point. The old tip is preserved server-side
 * as a sibling but leaves the linear view.
 *
 * POST /api/sessions/:id/branch  { treeEntryId }
 * Returns { sessionId, leafId } (200).
 */
export async function branchSession(
  sessionId: string,
  treeEntryId: string,
): Promise<{ sessionId: string; leafId: string }> {
  return apiCallForBackend<{ sessionId: string; leafId: string }>(
    getBackendIdForSession(sessionId),
    `/api/sessions/${sessionId}/branch`,
    {
      method: 'POST',
      body: JSON.stringify({ treeEntryId }),
    },
  );
}

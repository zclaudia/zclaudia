// Cross-store coordination for session run state. These helpers fan a run
// transition out to the legacy session/activity stores and clean up chat-run
// bookkeeping; they live in services (not inside sessionRunStateStore) so the
// store stays a plain state container.
import { useRunStore } from '../stores/runStore';
import { useInteractionStore } from '../stores/interactionStore';
import { useOwnershipStore } from '../stores/ownershipStore';
import { usePermissionStore } from '../stores/permissionStore';
import { useProjectStore } from '../stores/projectStore';
import { usePromptRequestStore } from '../stores/promptRequestStore';
import { useSessionsStore } from '../stores/sessionsStore';
import type { SessionRunRecord } from '../stores/sessionRunStateStore';
import { finalizeRunLifecycle } from './message-handlers/run-finalization';

const LOCAL_BACKEND_KEY = '__local__';

export function resolveRunSessionId(
  runId: string,
  records: Record<string, SessionRunRecord>
): string | null {
  for (const record of Object.values(records)) {
    if (record.foregroundRunIds.includes(runId)) return record.sessionId;
  }
  return useRunStore.getState().activeRuns?.[runId] ?? null;
}

function setLegacySessionActive(backendId: string, sessionId: string, isActive: boolean): void {
  const projectStore = useProjectStore.getState() as ReturnType<typeof useProjectStore.getState> & {
    setSessionActive?: (sessionId: string, isActive: boolean) => void;
  };
  projectStore.setSessionActive?.(sessionId, isActive);

  const sessionsStore = useSessionsStore.getState() as ReturnType<
    typeof useSessionsStore.getState
  > & {
    setSessionActiveFlag?: (backendId: string, sessionId: string, isActive: boolean) => void;
    setSessionActiveById?: (backendId: string, sessionId: string, isActive: boolean) => void;
  };
  sessionsStore.setSessionActiveFlag?.(backendId, sessionId, isActive);
  if (backendId !== LOCAL_BACKEND_KEY) {
    sessionsStore.setSessionActiveById?.(backendId, sessionId, isActive);
  }
}

function clearSessionBlockingState(sessionId: string): void {
  const permissionStore = usePermissionStore.getState() as ReturnType<
    typeof usePermissionStore.getState
  > & {
    clearRequestsForSession?: (sessionId: string) => void;
  };
  permissionStore.clearRequestsForSession?.(sessionId);

  const promptStore = usePromptRequestStore.getState() as ReturnType<
    typeof usePromptRequestStore.getState
  > & {
    clearRequestsForSession?: (sessionId: string) => void;
  };
  promptStore.clearRequestsForSession?.(sessionId);

  const interactionStore = useInteractionStore.getState() as ReturnType<
    typeof useInteractionStore.getState
  > & {
    clearSession?: (sessionId: string) => void;
  };
  interactionStore.clearSession?.(sessionId);
}

export function cleanupForegroundChatRunsForSession(
  sessionId: string,
  allowedRunIds: Set<string> = new Set()
): void {
  const chatStore = useRunStore.getState() as ReturnType<typeof useRunStore.getState> & {
    activeRuns?: Record<string, string>;
    backgroundRunIds?: Set<string>;
  };

  for (const [runId, runSessionId] of Object.entries(chatStore.activeRuns ?? {})) {
    if (runSessionId !== sessionId) continue;
    if (chatStore.backgroundRunIds?.has(runId)) continue;
    if (allowedRunIds.has(runId)) continue;
    finalizeRunLifecycle(runId);
  }
}

export function cleanupForegroundChatRunsForBackend(
  backendId: string,
  activeRunIds: Set<string>,
  knownSessionIds: Set<string>
): void {
  const chatStore = useRunStore.getState() as ReturnType<typeof useRunStore.getState> & {
    activeRuns?: Record<string, string>;
    backgroundRunIds?: Set<string>;
  };
  const ownershipStore = useOwnershipStore.getState() as ReturnType<
    typeof useOwnershipStore.getState
  > & {
    sessionBackendIds?: Record<string, string>;
    getSessionBackendId?: (sessionId: string) => string | undefined;
  };

  for (const [runId, sessionId] of Object.entries(chatStore.activeRuns ?? {})) {
    if (chatStore.backgroundRunIds?.has(runId)) continue;
    if (activeRunIds.has(runId)) continue;
    const ownerBackendId =
      ownershipStore.sessionBackendIds?.[sessionId] ??
      ownershipStore.getSessionBackendId?.(sessionId);
    const belongsToBackend = ownerBackendId === backendId || knownSessionIds.has(sessionId);
    if (!belongsToBackend) continue;
    finalizeRunLifecycle(runId);
    clearSessionBlockingState(sessionId);
  }
}

export { clearSessionBlockingState, setLegacySessionActive };

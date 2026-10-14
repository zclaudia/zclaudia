import { useEffect, useMemo, useRef } from 'react';
import { useClaudiaStore, type ClaudiaThreadSummary } from '../../stores/claudiaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { fetchApiForBackend } from '../../services/api/base';
import { parseBackendId } from '../../stores/gatewayStore';
import { resolveCanonicalBackendId } from '../../actions/controlPlane';

/**
 * Claudia thread reads: canonical backend + project resolution (design §backend
 * 归属) plus the per-project thread list with its client-side pointer semantics
 * (no explicit open → most recently updated thread).
 */
export function useClaudiaThreads({ isConnected }: { isConnected: boolean }) {
  const activeServerId = useServerStore(s => s.activeServerId);
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const activeBackendId = resolveCanonicalBackendId(
    activeServerId ? parseBackendId(activeServerId) : null,
    localBackendId
  );
  const selectedProjectId = useSelectionStore(s => s.selectedProjectId);
  const projects = useProjectStore(s => s.projects);
  const dataServerId = useProjectStore(s => s.dataServerId);
  const projectBackendId = resolveCanonicalBackendId(
    dataServerId ? parseBackendId(dataServerId) : null,
    localBackendId
  );

  const slice = useClaudiaStore(s => (activeBackendId ? s.slices[activeBackendId] : undefined));
  const store = useClaudiaStore;

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

  return {
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
  };
}

export type ClaudiaThreadsState = ReturnType<typeof useClaudiaThreads>;

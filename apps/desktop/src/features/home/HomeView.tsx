import { useEffect, useMemo, useRef } from 'react';
import { Plus, FolderPlus } from 'lucide-react';
import {
  useSessionsStore,
  LOCAL_BACKEND_KEY,
  resolveSessionBucketBackendId,
} from '../../stores/sessionsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useGatewayStore, shouldShowNonCurrentInstanceBackend } from '../../stores/gatewayStore';
import { useUIStore } from '../../stores/uiStore';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { isMobileBackendUsable } from '../../services/mobileConnectionState';
import { LEGACY_LOCAL_SERVER_ID, resolveCanonicalBackendId } from '../../utils/controlPlane';
import { timeAgo } from '../../utils/timeAgo';
import { generateSessionTitle } from '../../services/api';
import { selectHomeSessions, type HomeSessionRow } from './homeSessions';
import { greeting } from './greeting';
import { UsageStatsStrip } from './UsageStatsStrip';

interface HomeViewProps {
  onNewSession: () => void;
  onAddProject: () => void;
}

/** Top-level home view (no project/session selected): cross-backend resume hub. */
export function HomeView({ onNewSession, onAddProject }: HomeViewProps) {
  const activeBackendSessions = useProjectStore(s => s.sessions);
  const projects = useProjectStore(s => s.projects);
  // Set by useDataLoader once the initial REST load for the active backend
  // completes; null while loading (and re-nulled on backend switch/reconnect).
  const dataLoaded = useProjectStore(s => s.dataServerId !== null);
  const sessionOwnerIds = useOwnershipStore(s => s.sessionBackendIds);
  const projectOwnerIds = useOwnershipStore(s => s.projectBackendIds);
  const remoteSessions = useSessionsStore(s => s.remoteSessions);
  const activeSessionIdsByBackend = useSessionsStore(s => s.activeSessionIdsByBackend);
  const facadeBackends = useFacadeStore(s => s.backends);
  const facadeConnectionState = useFacadeStore(s => s.connectionState);
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const currentInstanceId = useFacadeStore(s => s.currentInstanceId);
  const showLocalBackend = useGatewayStore(s => s.showLocalBackend);
  const coordinator = useSelectionCoordinator();

  const localAliasBackendIds = useMemo(() => {
    const aliases = new Set<string>();
    if (localBackendId) aliases.add(localBackendId);
    const hasDirectLocalConnection = isMobileBackendUsable({
      backendId: localBackendId ?? 'local',
      connectionState: facadeConnectionState,
      backends: facadeBackends,
    });
    if (hasDirectLocalConnection) aliases.add(LEGACY_LOCAL_SERVER_ID);
    return aliases;
  }, [localBackendId, facadeConnectionState, facadeBackends]);

  // projectStore.sessions holds the ACTIVE backend's sessions, which may be a
  // remote backend (useDataLoader reloads it on active-backend switches). Keep
  // only sessions owned by the local backend (or with no recorded owner);
  // remote-owned ones surface from their own remoteSessions bucket instead,
  // correctly labeled. Owner resolution mirrors resolveSessionOwnerBackendId:
  // project owner wins over session owner, ids are canonicalized.
  const localSessions = useMemo(
    () =>
      activeBackendSessions.filter(session => {
        const rawOwner = projectOwnerIds[session.projectId] ?? sessionOwnerIds[session.id];
        if (!rawOwner) return true;
        const owner = resolveCanonicalBackendId(rawOwner, localBackendId ?? rawOwner);
        if (!owner) return true;
        return owner === localBackendId || localAliasBackendIds.has(owner);
      }),
    [activeBackendSessions, projectOwnerIds, sessionOwnerIds, localBackendId, localAliasBackendIds]
  );

  const { running, recent } = useMemo(
    () =>
      selectHomeSessions({
        localSessions,
        remoteSessions,
        activeSessionIdsByBackend,
        projects,
        localAliasBackendIds,
        isVisibleGatewayBackend: backendId => {
          const backend = facadeBackends.find(b => b.backendId === backendId);
          if (!backend) return true;
          return shouldShowNonCurrentInstanceBackend(backend, currentInstanceId, showLocalBackend);
        },
      }),
    [
      localSessions,
      remoteSessions,
      activeSessionIdsByBackend,
      projects,
      localAliasBackendIds,
      facadeBackends,
      currentInstanceId,
      showLocalBackend,
    ]
  );

  const backendName = (backendKey: string): string => {
    if (backendKey === LOCAL_BACKEND_KEY) return 'Local';
    const backend = facadeBackends.find(b => b.backendId === backendKey);
    return backend?.name ?? `Backend ${backendKey.slice(0, 8)}`;
  };

  const openSession = (row: HomeSessionRow) => {
    const backendId =
      row.backendKey === LOCAL_BACKEND_KEY
        ? resolveSessionBucketBackendId(LOCAL_BACKEND_KEY, localBackendId)
        : row.backendKey;
    if (!backendId) return;
    useUIStore.getState().requestForceScrollToBottom(row.id);
    coordinator.selectSessionOnBackend(backendId, row.id);
  };

  // Nudge the backend to auto-title sessions that never got one (older or
  // interrupted sessions show as "Untitled"). Fire at most once per session per
  // app run; the server re-checks eligibility and no-ops empty/already-titled
  // ones, and the generated title lands via a sessions_updated broadcast.
  const titleRequestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const requested = titleRequestedRef.current;
    for (const row of [...running, ...recent]) {
      if (row.title !== 'Untitled' || requested.has(row.id)) continue;
      const backendId =
        row.backendKey === LOCAL_BACKEND_KEY
          ? resolveSessionBucketBackendId(LOCAL_BACKEND_KEY, localBackendId)
          : row.backendKey;
      if (!backendId) continue;
      requested.add(row.id);
      void generateSessionTitle(backendId, row.id).catch(() => {});
    }
  }, [running, recent, localBackendId]);

  const isEmpty = running.length === 0 && recent.length === 0;

  // Before the initial REST load finishes the stores are empty regardless of
  // real data — rendering the empty state then would flash onboarding on every
  // cold start. Stay blank until useDataLoader has stamped the load complete.
  // Once there's activity (running/recent), the load is implicitly done.
  if (isEmpty && !dataLoaded) return null;

  const quickActions = (
    <div className="flex gap-2">
      <button
        onClick={onNewSession}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Plus size={13} strokeWidth={1.75} />
        New session
      </button>
      <button
        onClick={onAddProject}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <FolderPlus size={13} strokeWidth={1.75} />
        Add project
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 pt-12 pb-10">
        {/* Home always leads with the greeting. When there's activity, the
            sidebar already covers creating sessions/projects (per-project "New
            session", per-backend "New project"), so the header buttons would be
            redundant; when empty they're the only onboarding entry point. */}
        <h2 className="text-xl font-semibold">{greeting(new Date().getHours())}</h2>

        {isEmpty ? (
          <div className="mt-3">
            <p className="text-sm text-muted-foreground">
              Start a session or add a project to get going.
            </p>
            <div className="mt-4">{quickActions}</div>
          </div>
        ) : (
          // First group opens with more air after the header; siblings tighten.
          <div className="[&>*:first-child]:mt-9 [&>*+*]:mt-8">
            {running.length > 0 && (
              <SessionGroup
                label="Running"
                rows={running}
                backendName={backendName}
                onOpen={openSession}
              />
            )}
            {recent.length > 0 && (
              <SessionGroup
                label="Recent"
                rows={recent}
                backendName={backendName}
                onOpen={openSession}
              />
            )}
          </div>
        )}

        <UsageStatsStrip />
      </div>
    </div>
  );
}

function SessionGroup({
  label,
  rows,
  backendName,
  onOpen,
}: {
  label: string;
  rows: HomeSessionRow[];
  backendName: (backendKey: string) => string;
  onOpen: (row: HomeSessionRow) => void;
}) {
  return (
    <div>
      <div className="px-2 text-[11px] font-medium text-muted-foreground">{label}</div>
      <ul className="mt-1">
        {rows.map(row => (
          <li key={row.id}>
            <button
              onClick={() => onOpen(row)}
              className="w-full px-2 py-1.5 rounded-md text-left hover:bg-secondary transition-colors group"
            >
              <span className="flex items-center gap-2">
                {row.isRunning && (
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />
                )}
                <span className="truncate text-sm text-foreground">{row.title}</span>
                <span className="ml-auto shrink-0 pl-4 text-[11px] text-muted-foreground/60">
                  {timeAgo(row.updatedAt)}
                </span>
              </span>
              <span
                className={`block mt-px truncate text-xs text-muted-foreground/60 ${
                  row.isRunning ? 'pl-[14px]' : ''
                }`}
              >
                {[
                  row.messageCount
                    ? `${row.messageCount} ${row.messageCount === 1 ? 'message' : 'messages'}`
                    : null,
                  row.projectName,
                  backendName(row.backendKey),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

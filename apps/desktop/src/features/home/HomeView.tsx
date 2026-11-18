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
import { useIsMobile } from '../../hooks/useMediaQuery';
import { isMobileBackendUsable } from '../../services/mobileConnectionState';
import { LEGACY_LOCAL_SERVER_ID, resolveCanonicalBackendId } from '../../actions/controlPlane';
import { timeAgo } from '../../utils/timeAgo';
import { generateSessionTitle } from '../../services/api';
import { selectHomeSessions, type HomeSessionRow } from './homeSessions';
import { greeting } from './greeting';
import { UsageStatsStrip } from './UsageStatsStrip';
import { Button } from '../../components/ui/Button';
import { PaneSkeleton } from '../../components/ui/Skeleton';
import { STATUS_TONE, TONE_DOT } from '../../components/ui/tone';

interface HomeViewProps {
  onNewSession: () => void;
  onAddProject: () => void;
}

/** Top-level home view (no project/session selected): cross-backend resume hub. */
export function HomeView({ onNewSession, onAddProject }: HomeViewProps) {
  const isMobile = useIsMobile();
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

  const { needsAttention, running, recent } = useMemo(
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
    for (const row of [...needsAttention, ...running, ...recent]) {
      if (row.title !== 'Untitled' || requested.has(row.id)) continue;
      const backendId =
        row.backendKey === LOCAL_BACKEND_KEY
          ? resolveSessionBucketBackendId(LOCAL_BACKEND_KEY, localBackendId)
          : row.backendKey;
      if (!backendId) continue;
      requested.add(row.id);
      void generateSessionTitle(backendId, row.id).catch(() => {});
    }
  }, [needsAttention, running, recent, localBackendId]);

  const isEmpty = needsAttention.length === 0 && running.length === 0 && recent.length === 0;

  // Keep onboarding hidden until the first catalog arrives without leaving a blank pane.
  if (isEmpty && !dataLoaded) {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-12" role="status" aria-busy="true">
        <p className="text-sm text-muted-foreground">正在加载会话与项目…</p>
        <PaneSkeleton />
      </div>
    );
  }

  const quickActions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={onNewSession} className="h-9">
        <Plus size={15} strokeWidth={1.75} aria-hidden />
        New session
      </Button>
      <Button variant="outline" onClick={onAddProject} className="h-9">
        <FolderPlus size={15} strokeWidth={1.75} aria-hidden />
        Add project
      </Button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 pt-12 pb-10">
        {/* Home always leads with the greeting. On desktop the sidebar is
            always on screen and already covers creating sessions/projects, so
            the header buttons would be redundant once there's activity. On
            mobile the sidebar is a drawer, so these stay the primary entry
            point at all times. */}
        <h1 className="text-xl font-semibold">{greeting(new Date().getHours())}</h1>

        {isEmpty ? (
          <div className="mt-3">
            <p className="text-sm text-muted-foreground">
              Start a session or add a project to get going.
            </p>
            <div className="mt-4">{quickActions}</div>
          </div>
        ) : (
          <>
            {isMobile && <div className="mt-4">{quickActions}</div>}
            {/* First group opens with more air after the header; siblings tighten. */}
            <div
              className={`[&>*+*]:mt-8 ${isMobile ? '[&>*:first-child]:mt-8' : '[&>*:first-child]:mt-9'}`}
            >
              {/* Blocked-on-you first: on a phone this is the whole reason to
                  open the app, and it spans every subscribed backend. */}
              {needsAttention.length > 0 && (
                <SessionGroup
                  label="Needs you"
                  rows={needsAttention}
                  backendName={backendName}
                  onOpen={openSession}
                />
              )}
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
          </>
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
      <div className="px-2 text-xs font-medium text-muted-foreground">{label}</div>
      <ul className="mt-1">
        {rows.map(row => (
          <li key={JSON.stringify([row.backendKey, row.id])}>
            <button
              onClick={() => onOpen(row)}
              className="w-full px-2 py-1.5 max-md:py-3 rounded-md text-left hover:bg-secondary transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring group"
            >
              <span className="flex items-center gap-2">
                {row.needsAttention ? (
                  <span
                    role="img"
                    aria-label="等待处理"
                    className={`w-1.5 h-1.5 rounded-full animate-pulse shrink-0 ${TONE_DOT[STATUS_TONE.waiting]}`}
                  />
                ) : row.isRunning ? (
                  <span
                    role="img"
                    aria-label="运行中"
                    className={`w-1.5 h-1.5 rounded-full animate-pulse shrink-0 ${TONE_DOT[STATUS_TONE.running]}`}
                  />
                ) : row.hasFailed ? (
                  // Settled, so no pulse — it is a result to review, not activity.
                  <span
                    role="img"
                    aria-label="失败"
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[STATUS_TONE.failed]}`}
                  />
                ) : null}
                <span
                  className={`truncate text-sm text-foreground${row.titlePending ? ' animate-pulse' : ''}`}
                >
                  {row.title}
                </span>
                <span className="ml-auto shrink-0 pl-4 text-xs text-muted-foreground">
                  {timeAgo(row.updatedAt)}
                </span>
              </span>
              <span
                className={`block mt-px truncate text-xs ${
                  row.hasFailed ? 'text-destructive/80' : 'text-muted-foreground'
                } ${row.isRunning || row.needsAttention || row.hasFailed ? 'pl-[14px]' : ''}`}
              >
                {[
                  row.hasFailed ? 'Failed' : null,
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

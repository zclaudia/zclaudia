import { useMemo } from 'react';
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
import { selectHomeSessions, type HomeSessionRow } from './homeSessions';

interface HomeViewProps {
  onNewSession: () => void;
  onAddProject: () => void;
}

/** Top-level home view (no project/session selected): cross-backend resume hub. */
export function HomeView({ onNewSession, onAddProject }: HomeViewProps) {
  const activeBackendSessions = useProjectStore(s => s.sessions);
  const projects = useProjectStore(s => s.projects);
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

  const { running, recent, multiBackend } = useMemo(
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

  const isEmpty = running.length === 0 && recent.length === 0;

  const quickActions = (
    <div className={`flex gap-2 ${isEmpty ? 'justify-center' : ''}`}>
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

  if (isEmpty) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Welcome to ZClaudia</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Start a session or add a project to get going.
          </p>
          {quickActions}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 pt-16 pb-10">
        <h2 className="text-xl font-semibold mb-3">Welcome to ZClaudia</h2>
        {quickActions}

        {running.length > 0 && (
          <SessionGroup
            label="Running"
            rows={running}
            multiBackend={multiBackend}
            backendName={backendName}
            onOpen={openSession}
          />
        )}
        {recent.length > 0 && (
          <SessionGroup
            label="Recent"
            rows={recent}
            multiBackend={multiBackend}
            backendName={backendName}
            onOpen={openSession}
          />
        )}
      </div>
    </div>
  );
}

function SessionGroup({
  label,
  rows,
  multiBackend,
  backendName,
  onOpen,
}: {
  label: string;
  rows: HomeSessionRow[];
  multiBackend: boolean;
  backendName: (backendKey: string) => string;
  onOpen: (row: HomeSessionRow) => void;
}) {
  return (
    <div className="mt-6">
      <div className="px-2 text-[11px] font-medium text-muted-foreground">{label}</div>
      <ul className="mt-1">
        {rows.map(row => (
          <li key={row.id}>
            <button
              onClick={() => onOpen(row)}
              className="w-full h-7 px-2 rounded-md text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors flex items-center gap-2 text-left"
            >
              {row.isRunning && (
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />
              )}
              <span className="truncate flex-1">{row.title}</span>
              <span className="text-[11px] text-muted-foreground/60 shrink-0 truncate max-w-[120px]">
                {row.projectName}
              </span>
              {multiBackend && (
                <span className="text-[11px] text-muted-foreground/60 shrink-0 truncate max-w-[100px]">
                  {backendName(row.backendKey)}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground/60 shrink-0 min-w-[56px] text-right">
                {timeAgo(row.updatedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

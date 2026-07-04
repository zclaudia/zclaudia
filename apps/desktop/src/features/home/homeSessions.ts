import type { Project, Session } from '@zclaudia/shared';
import { LOCAL_BACKEND_KEY, type RemoteSession } from '../../stores/sessionsStore';

export interface HomeSessionRow {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  /** LOCAL_BACKEND_KEY for the local backend, gateway backendId otherwise. */
  backendKey: string;
  updatedAt: number;
  isRunning: boolean;
  /** Message count when known (RemoteSession.lastMessageOffset). */
  messageCount?: number;
}

export interface HomeSessionsInput {
  /** Local backend sessions (projectStore.sessions). */
  localSessions: Session[];
  /** Per-backend session buckets (sessionsStore.remoteSessions). */
  remoteSessions: ReadonlyMap<string, RemoteSession[]>;
  /** Running-state source of truth (sessionsStore.activeSessionIdsByBackend). */
  activeSessionIdsByBackend: ReadonlyMap<string, ReadonlySet<string>>;
  projects: Project[];
  /** Gateway bucket ids that mirror the local backend (dedup against localSessions). */
  localAliasBackendIds: ReadonlySet<string>;
  /** Visibility filter for non-local gateway backends. */
  isVisibleGatewayBackend: (backendId: string) => boolean;
}

export interface HomeSessions {
  running: HomeSessionRow[];
  recent: HomeSessionRow[];
  /** True when the rows span more than one backend (show backend badges). */
  multiBackend: boolean;
}

export const RECENT_CAP = 10;

function includeSession(session: Session, projectNames: Map<string, string>): boolean {
  if ((session.type ?? 'regular') !== 'regular') return false;
  if (session.archivedAt != null) return false;
  return projectNames.has(session.projectId);
}

function toRow(
  session: Session,
  backendKey: string,
  isRunning: boolean,
  projectNames: Map<string, string>
): HomeSessionRow {
  return {
    id: session.id,
    title: session.autoTitle || session.name || 'Untitled',
    projectId: session.projectId,
    projectName: projectNames.get(session.projectId) ?? '',
    backendKey,
    updatedAt: session.updatedAt,
    isRunning,
    messageCount: (session as { lastMessageOffset?: number }).lastMessageOffset,
  };
}

/** Aggregate all connected backends' sessions into Running / Recent rows. */
export function selectHomeSessions(input: HomeSessionsInput): HomeSessions {
  const {
    localSessions,
    remoteSessions,
    activeSessionIdsByBackend,
    projects,
    localAliasBackendIds,
    isVisibleGatewayBackend,
  } = input;

  // Internal projects (e.g. __claudia) are hidden from user-facing lists, so
  // their sessions drop out the same way orphaned-project sessions do.
  const projectNames = new Map(projects.filter(p => !p.isInternal).map(p => [p.id, p.name]));

  // Union of active ids across the local bucket and its gateway aliases.
  const localActiveIds = new Set<string>();
  for (const key of [LOCAL_BACKEND_KEY, ...localAliasBackendIds]) {
    for (const id of activeSessionIdsByBackend.get(key) ?? []) localActiveIds.add(id);
  }

  const rows: HomeSessionRow[] = [];
  const seenLocalIds = new Set<string>();

  for (const session of localSessions) {
    seenLocalIds.add(session.id);
    if (!includeSession(session, projectNames)) continue;
    rows.push(toRow(session, LOCAL_BACKEND_KEY, localActiveIds.has(session.id), projectNames));
  }

  for (const [backendId, sessions] of remoteSessions) {
    const isAlias = localAliasBackendIds.has(backendId);
    if (!isAlias && !isVisibleGatewayBackend(backendId)) continue;
    const activeIds = isAlias ? localActiveIds : (activeSessionIdsByBackend.get(backendId) ?? new Set());
    for (const session of sessions) {
      if (isAlias && seenLocalIds.has(session.id)) continue;
      if (isAlias) seenLocalIds.add(session.id);
      if (!includeSession(session, projectNames)) continue;
      rows.push(
        toRow(session, isAlias ? LOCAL_BACKEND_KEY : backendId, activeIds.has(session.id), projectNames)
      );
    }
  }

  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  const running = rows.filter(r => r.isRunning);
  const recent = rows.filter(r => !r.isRunning).slice(0, RECENT_CAP);
  const multiBackend = new Set(rows.map(r => r.backendKey)).size > 1;

  return { running, recent, multiBackend };
}

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
  /**
   * The run is blocked on the user (a permission request or another prompt).
   * Carried per backend in the gateway snapshot, so this works for every
   * subscribed backend — not just the one whose REST catalog is loaded.
   */
  needsAttention: boolean;
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
  /** Blocked on the user — the reason to pick up the phone. Listed first. */
  needsAttention: HomeSessionRow[];
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
  const needsAttention = session.lastRunStatus === 'waiting';
  return {
    id: session.id,
    // Explicit user name wins over the AI auto-title so a rename is never
    // overridden; auto-title only fills in for unnamed sessions.
    title: session.name || session.autoTitle || 'Untitled',
    projectId: session.projectId,
    projectName: projectNames.get(session.projectId) ?? '',
    backendKey,
    updatedAt: session.updatedAt,
    // A waiting run is still "active" upstream, but it is not working — it is
    // stuck on the user, so it belongs in its own group, not in Running.
    isRunning: isRunning && !needsAttention,
    needsAttention,
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
    const activeIds = isAlias
      ? localActiveIds
      : (activeSessionIdsByBackend.get(backendId) ?? new Set());
    for (const session of sessions) {
      if (isAlias && seenLocalIds.has(session.id)) continue;
      if (isAlias) seenLocalIds.add(session.id);
      if (!includeSession(session, projectNames)) continue;
      rows.push(
        toRow(
          session,
          isAlias ? LOCAL_BACKEND_KEY : backendId,
          activeIds.has(session.id),
          projectNames
        )
      );
    }
  }

  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  const needsAttention = rows.filter(r => r.needsAttention);
  const running = rows.filter(r => r.isRunning);
  const recent = rows.filter(r => !r.isRunning && !r.needsAttention).slice(0, RECENT_CAP);
  const multiBackend = new Set(rows.map(r => r.backendKey)).size > 1;

  return { needsAttention, running, recent, multiBackend };
}

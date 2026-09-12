import type Database from 'better-sqlite3';
import type { Session } from '@zclaudia/shared/core/session';
import { hasForegroundActiveRunForSession } from '../../utils/run-state.js';

type ActiveRunsMap = Map<string, unknown>;

const SESSION_SELECT = `sessions.id, sessions.project_id as projectId, sessions.name,
               sessions.agent_profile_id as agentProfileId,
               sessions.sdk_session_id as sdkSessionId, sessions.type,
               sessions.parent_session_id as parentSessionId,
               sessions.working_directory as workingDirectory,
               sessions.archived_at as archivedAt,
               sessions.project_role as projectRole, sessions.task_id as taskId,
               sessions.plan_status as planStatus,
               sessions.last_run_status as lastRunStatus,
               CASE WHEN sessions.is_read_only = 1 THEN 1 ELSE NULL END as isReadOnly,
               sessions.sort_order as sortOrder,
               sessions.created_at as createdAt, sessions.updated_at as updatedAt,
               sessions.message_version as messageVersion,
               b.engine_mode as runtimeEngineMode,
               b.model as runtimeEngineModel,
               lp.name as runtimeEngineProfileName`;

const SESSION_FROM = `sessions
               LEFT JOIN session_runtime_bindings b ON b.session_id = sessions.id
               LEFT JOIN llm_profiles lp ON lp.id = b.llm_profile_id`;

/**
 * Fold the flat binding columns into the nested `runtimeEngine` view. Sessions
 * without a binding (never ran) simply omit the field.
 */
function mapSessionRow(row: unknown): Session {
  const { runtimeEngineMode, runtimeEngineModel, runtimeEngineProfileName, ...rest } =
    row as Record<string, unknown>;
  const session = rest as unknown as Session;
  if (typeof runtimeEngineMode === 'string' && runtimeEngineMode) {
    session.runtimeEngine = {
      engineMode: runtimeEngineMode,
      model: typeof runtimeEngineModel === 'string' && runtimeEngineModel ? runtimeEngineModel : undefined,
      llmProfileName:
        typeof runtimeEngineProfileName === 'string' && runtimeEngineProfileName
          ? runtimeEngineProfileName
          : undefined,
    };
  }
  return session;
}

export interface SyncedSessionSummary {
  id: string;
  projectId: string;
  name?: string;
  agentProfileId: string | null;
  workingDirectory?: string;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  lastMessageOffset?: number;
  messageVersion: number;
}

export interface SessionSyncResult {
  sessions: SyncedSessionSummary[];
  timestamp: number;
  total: number;
}

export class SessionQueryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export class SessionQueryService {
  constructor(
    private readonly db: Database.Database,
    private readonly activeRuns: ActiveRunsMap,
    private readonly now: () => number = () => Date.now()
  ) {}

  listSessions(projectId?: string, includeArchived = false): Session[] {
    if (projectId && includeArchived) {
      return (
        this.db
          .prepare(
            `
        SELECT ${SESSION_SELECT}
        FROM ${SESSION_FROM}
        WHERE sessions.project_id = ?
        ORDER BY sessions.sort_order ASC, sessions.updated_at DESC
      `
          )
          .all(projectId)
          .map(mapSessionRow) as Session[]
      );
    }

    if (projectId) {
      return (
        this.db
          .prepare(
            `
        SELECT ${SESSION_SELECT}
        FROM ${SESSION_FROM}
        WHERE sessions.project_id = ? AND sessions.archived_at IS NULL
        ORDER BY sessions.sort_order ASC, sessions.updated_at DESC
      `
          )
          .all(projectId)
          .map(mapSessionRow) as Session[]
      );
    }

    if (includeArchived) {
      return (
        this.db
          .prepare(
            `
        SELECT ${SESSION_SELECT}
        FROM ${SESSION_FROM}
        ORDER BY sessions.sort_order ASC, sessions.updated_at DESC
      `
          )
          .all()
          .map(mapSessionRow) as Session[]
      );
    }

    return (
      this.db
        .prepare(
          `
      SELECT ${SESSION_SELECT}
      FROM ${SESSION_FROM}
      WHERE sessions.archived_at IS NULL
      ORDER BY sessions.sort_order ASC, sessions.updated_at DESC
    `
        )
        .all()
        .map(mapSessionRow) as Session[]
    );
  }

  listArchivedSessions(): Session[] {
    return (
      this.db
        .prepare(
          `
      SELECT ${SESSION_SELECT}
      FROM ${SESSION_FROM}
      WHERE sessions.archived_at IS NOT NULL
      ORDER BY sessions.archived_at DESC
    `
        )
        .all()
        .map(mapSessionRow) as Session[]
    );
  }

  syncSessions(since: string | undefined): SessionSyncResult {
    const sinceTimestamp = since ? parseInt(since, 10) : 0;
    if (isNaN(sinceTimestamp) || sinceTimestamp < 0) {
      throw new SessionQueryError(400, 'VALIDATION_ERROR', 'Invalid since parameter');
    }

    const sessions = this.db
      .prepare(
        `
      SELECT s.id, s.project_id as projectId, s.name, s.agent_profile_id as agentProfileId,
             s.sdk_session_id as sdkSessionId, s.type, s.parent_session_id as parentSessionId,
             s.working_directory as workingDirectory,
             s.archived_at as archivedAt,
             s.project_role as projectRole, s.task_id as taskId,
             s.plan_status as planStatus,
             CASE WHEN s.is_read_only = 1 THEN 1 ELSE NULL END as isReadOnly,
             s.created_at as createdAt, s.updated_at as updatedAt,
             s.message_version as messageVersion,
             (SELECT MAX(offset) FROM messages WHERE session_id = s.id) as lastMessageOffset
      FROM sessions s
      WHERE s.updated_at > ? AND s.archived_at IS NULL
      ORDER BY s.updated_at DESC
    `
      )
      .all(sinceTimestamp) as (Session & {
      lastMessageOffset: number | null;
      messageVersion: number;
    })[];

    const syncedSessions: SyncedSessionSummary[] = sessions.map(session => ({
      id: session.id,
      projectId: session.projectId,
      name: session.name,
      agentProfileId: session.agentProfileId ?? null,
      workingDirectory: session.workingDirectory ?? undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      isActive: hasForegroundActiveRunForSession(this.activeRuns as Map<string, any>, session.id),
      lastMessageOffset: session.lastMessageOffset ?? undefined,
      messageVersion: session.messageVersion,
    }));

    return {
      sessions: syncedSessions,
      timestamp: this.now(),
      total: syncedSessions.length,
    };
  }
}

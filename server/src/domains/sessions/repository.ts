import { BaseRepository } from '../../infra/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type { Session } from '@zclaudia/shared/core/session';
import { newId } from '../../utils/uuid.js';
import { resolveAgentForSession } from '../agent-profiles/agent-resolver.js';

export class SessionRepository extends BaseRepository<
  Session,
  Omit<Session, 'id' | 'createdAt' | 'updatedAt'>,
  Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>
> {
  constructor(db: Database) {
    super(db, 'sessions');
  }

  mapRow(row: any): Session {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name || undefined,
      agentProfileId: row.agent_profile_id,
      sdkSessionId: row.sdk_session_id || undefined,
      type: row.type || 'regular',
      parentSessionId: row.parent_session_id || undefined,
      workingDirectory: row.working_directory || undefined,
      sortOrder: row.sort_order ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at || undefined,
      projectRole: row.project_role || undefined,
      taskId: row.task_id || undefined,
      planStatus: row.plan_status || undefined,
      isReadOnly: row.is_read_only === 1 ? true : undefined,
      lastRunStatus: row.last_run_status || undefined,
      autoTitle: row.auto_title || undefined,
      autoTitleMsgCount: row.auto_title_msg_count ?? undefined,
      forkedFromSessionId: row.forked_from_session_id || undefined,
      forkEntryId: row.fork_entry_id || undefined,
    };
  }

  /**
   * Persist the AI-generated topic title. Intentionally does NOT touch
   * `updated_at` — this is a background enrichment and must not reorder
   * sidebar lists that sort by recency.
   */
  updateAutoTitle(sessionId: string, autoTitle: string, autoTitleMsgCount: number): void {
    this.db
      .prepare('UPDATE sessions SET auto_title = ?, auto_title_msg_count = ? WHERE id = ?')
      .run(autoTitle, autoTitleMsgCount, sessionId);
  }

  createQuery(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): {
    sql: string;
    params: any[];
  } {
    const id = newId();
    const now = Date.now();

    // Resolve agent via the shared helper. Throws NoAgentAvailableError when
    // nothing resolves (caller should map to 400). The helper looks up
    // explicit > project default > global default and warns on stale ids.
    const { agent } = resolveAgentForSession(this.db, {
      explicitAgentId: data.agentProfileId,
      projectId: data.projectId,
    });
    const agentProfileId = agent.id;

    return {
      sql: `
        INSERT INTO sessions (
          id, project_id, name, agent_profile_id, sdk_session_id, type,
          parent_session_id, working_directory, sort_order,
          project_role, task_id, plan_status, is_read_only, last_run_status,
          forked_from_session_id, fork_entry_id,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        id,
        data.projectId,
        data.name || null,
        agentProfileId,
        data.sdkSessionId || null,
        data.type || 'regular',
        data.parentSessionId || null,
        data.workingDirectory || null,
        data.sortOrder ?? 0,
        data.projectRole || null,
        data.taskId || null,
        data.planStatus || null,
        data.isReadOnly ? 1 : 0,
        data.lastRunStatus || null,
        data.forkedFromSessionId || null,
        data.forkEntryId || null,
        now,
        now,
      ],
    };
  }

  updateQuery(
    id: string,
    data: Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>
  ): { sql: string; params: any[] } {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.projectId !== undefined) {
      updates.push('project_id = ?');
      params.push(data.projectId);
    }
    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.agentProfileId !== undefined) {
      updates.push('agent_profile_id = ?');
      params.push(data.agentProfileId);
    }
    if (data.sdkSessionId !== undefined) {
      updates.push('sdk_session_id = ?');
      params.push(data.sdkSessionId);
    }
    if (data.type !== undefined) {
      updates.push('type = ?');
      params.push(data.type);
    }
    if (data.parentSessionId !== undefined) {
      updates.push('parent_session_id = ?');
      params.push(data.parentSessionId);
    }
    if (data.workingDirectory !== undefined) {
      updates.push('working_directory = ?');
      params.push(data.workingDirectory || null);
    }
    if (data.sortOrder !== undefined) {
      updates.push('sort_order = ?');
      params.push(data.sortOrder ?? null);
    }
    if (data.archivedAt !== undefined) {
      updates.push('archived_at = ?');
      params.push(data.archivedAt || null);
    }
    if (data.projectRole !== undefined) {
      updates.push('project_role = ?');
      params.push(data.projectRole || null);
    }
    if (data.taskId !== undefined) {
      updates.push('task_id = ?');
      params.push(data.taskId || null);
    }
    if (data.planStatus !== undefined) {
      updates.push('plan_status = ?');
      params.push(data.planStatus || null);
    }
    if (data.isReadOnly !== undefined) {
      updates.push('is_read_only = ?');
      params.push(data.isReadOnly ? 1 : 0);
    }
    if (data.lastRunStatus !== undefined) {
      updates.push('last_run_status = ?');
      params.push(data.lastRunStatus || null);
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    return {
      sql: `UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByProjectId(projectId: string): Session[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM sessions
      WHERE project_id = ?
      ORDER BY updated_at DESC
    `
      )
      .all(projectId);
    return rows.map(row => this.mapRow(row));
  }

  findByProjectRole(projectId: string, role: string): Session[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM sessions
      WHERE project_id = ? AND project_role = ?
      ORDER BY created_at DESC
    `
      )
      .all(projectId, role);
    return rows.map(row => this.mapRow(row));
  }

  findBySdkSessionId(sdkSessionId: string): Session | null {
    const row = this.db
      .prepare(
        `
      SELECT * FROM sessions
      WHERE sdk_session_id = ?
    `
      )
      .get(sdkSessionId);
    return row ? this.mapRow(row) : null;
  }

  exists(id: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id);
    return Boolean(row);
  }

  isArchived(id: string): boolean {
    const row = this.db.prepare('SELECT archived_at FROM sessions WHERE id = ?').get(id) as
      | { archived_at: number | null }
      | undefined;
    return Boolean(row?.archived_at);
  }

  archiveIfActive(id: string, archivedAt = Date.now()): boolean {
    const result = this.db
      .prepare(
        'UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL'
      )
      .run(archivedAt, archivedAt, id);
    return result.changes > 0;
  }

  findRegularSessionWorktree(id: string): { projectId: string; workingDirectory: string } | null {
    const row = this.db
      .prepare('SELECT project_id, type, working_directory FROM sessions WHERE id = ?')
      .get(id) as
      | { project_id: string; type: string; working_directory: string | null }
      | undefined;
    if (!row?.working_directory || row.type !== 'regular') return null;
    return { projectId: row.project_id, workingDirectory: row.working_directory };
  }

  createWithId(id: string, data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Session {
    const now = Date.now();
    const { agent } = resolveAgentForSession(this.db, {
      explicitAgentId: data.agentProfileId,
      projectId: data.projectId,
    });

    this.db
      .prepare(
        `
      INSERT INTO sessions (
        id, project_id, name, agent_profile_id, sdk_session_id, type,
        parent_session_id, working_directory, sort_order,
        project_role, task_id, plan_status, is_read_only, last_run_status,
        forked_from_session_id, fork_entry_id,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        data.projectId,
        data.name || null,
        agent.id,
        data.sdkSessionId || null,
        data.type || 'regular',
        data.parentSessionId || null,
        data.workingDirectory || null,
        data.sortOrder ?? 0,
        data.projectRole || null,
        data.taskId || null,
        data.planStatus || null,
        data.isReadOnly ? 1 : 0,
        data.lastRunStatus || null,
        data.forkedFromSessionId || null,
        data.forkEntryId || null,
        now,
        now
      );

    const created = this.findById(id);
    if (!created) throw new Error(`Failed to create session: ${id}`);
    return created;
  }

  findNextSortOrder(projectId: string): number {
    const row = this.db
      .prepare(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 as sortOrder FROM sessions WHERE project_id = ?'
      )
      .get(projectId) as { sortOrder: number };
    return row.sortOrder;
  }
}

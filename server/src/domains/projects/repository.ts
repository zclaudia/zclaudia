import { BaseRepository } from '../../infra/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type { Project } from '@zclaudia/shared/core/project';
import { newId } from '../../utils/uuid.js';

export interface ProjectContextSummary {
  id: string;
  name: string;
  rootPath: string | null;
}

export class ProjectRepository extends BaseRepository<
  Project,
  Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
  Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>
> {
  constructor(db: Database) {
    super(db, 'projects');
  }

  mapRow(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      defaultAgentProfileId: row.default_agent_profile_id || undefined,
      rootPath: row.root_path || undefined,
      systemPrompt: row.system_prompt || undefined,
      permissionPolicy: row.permission_policy ? JSON.parse(row.permission_policy) : undefined,
      agentPermissionOverride: row.agent_permission_override
        ? JSON.parse(row.agent_permission_override)
        : undefined,
      hooksOverride: row.hooks_override ? JSON.parse(row.hooks_override) : undefined,
      isInternal: row.is_internal === 1,
      reviewLlmProfileId: row.review_llm_profile_id || undefined,
      permissionWorkflowOverrideId: row.permission_workflow_override_id || undefined,
      sortOrder: row.sort_order ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      agent: row.agent ? JSON.parse(row.agent) : undefined,
      contextSyncStatus: row.context_sync_status === 'error' ? 'error' : undefined,
    };
  }

  createQuery(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): {
    sql: string;
    params: any[];
  } {
    const id = newId();
    const now = Date.now();

    return {
      sql: `
        INSERT INTO projects (
          id, name, type, default_agent_profile_id, root_path, system_prompt,
          permission_policy, agent_permission_override, agent, context_sync_status,
          review_llm_profile_id, permission_workflow_override_id, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        id,
        data.name,
        data.type || 'code',
        data.defaultAgentProfileId || null,
        data.rootPath || null,
        data.systemPrompt || null,
        data.permissionPolicy ? JSON.stringify(data.permissionPolicy) : null,
        data.agentPermissionOverride ? JSON.stringify(data.agentPermissionOverride) : null,
        data.agent ? JSON.stringify(data.agent) : null,
        data.contextSyncStatus || 'synced',
        data.reviewLlmProfileId || null,
        data.permissionWorkflowOverrideId || null,
        data.sortOrder ?? null,
        now,
        now,
      ],
    };
  }

  updateQuery(
    id: string,
    data: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>
  ): { sql: string; params: any[] } {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.type !== undefined) {
      updates.push('type = ?');
      params.push(data.type);
    }
    if (data.defaultAgentProfileId !== undefined) {
      updates.push('default_agent_profile_id = ?');
      params.push(data.defaultAgentProfileId);
    }
    if (data.rootPath !== undefined) {
      updates.push('root_path = ?');
      params.push(data.rootPath);
    }
    if (data.systemPrompt !== undefined) {
      updates.push('system_prompt = ?');
      params.push(data.systemPrompt);
    }
    if (data.permissionPolicy !== undefined) {
      updates.push('permission_policy = ?');
      params.push(data.permissionPolicy ? JSON.stringify(data.permissionPolicy) : null);
    }
    if (data.agentPermissionOverride !== undefined) {
      updates.push('agent_permission_override = ?');
      params.push(
        data.agentPermissionOverride ? JSON.stringify(data.agentPermissionOverride) : null
      );
    }
    if (data.hooksOverride !== undefined) {
      updates.push('hooks_override = ?');
      params.push(data.hooksOverride ? JSON.stringify(data.hooksOverride) : null);
    }
    if (data.agent !== undefined) {
      updates.push('agent = ?');
      params.push(data.agent ? JSON.stringify(data.agent) : null);
    }
    if (data.contextSyncStatus !== undefined) {
      updates.push('context_sync_status = ?');
      params.push(data.contextSyncStatus || 'synced');
    }
    if (data.reviewLlmProfileId !== undefined) {
      updates.push('review_llm_profile_id = ?');
      params.push(data.reviewLlmProfileId || null);
    }
    if (data.permissionWorkflowOverrideId !== undefined) {
      updates.push('permission_workflow_override_id = ?');
      params.push(data.permissionWorkflowOverrideId || null);
    }
    if (data.sortOrder !== undefined) {
      updates.push('sort_order = ?');
      params.push(data.sortOrder ?? null);
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    return {
      sql: `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findAllOrdered(): Project[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM projects
      ORDER BY sort_order ASC, updated_at DESC
    `
      )
      .all();
    return rows.map(row => this.mapRow(row));
  }

  findNextSortOrder(): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as sortOrder FROM projects')
      .get() as { sortOrder: number };
    return row.sortOrder;
  }

  hasAgentReadinessSchema(): boolean {
    const llmTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'llm_profiles'")
      .get();
    if (!llmTable) return false;
    const agentCols = this.db.prepare('PRAGMA table_info(agent_profiles)').all() as Array<{
      name: string;
    }>;
    return agentCols.some(col => col.name === 'llm_profile_id');
  }

  exists(id: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id) as
      | { 1: number }
      | undefined;
    return Boolean(row);
  }

  findContextSummariesByIds(ids: string[]): ProjectContextSummary[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `
        SELECT id, name, root_path
        FROM projects
        WHERE id IN (${placeholders})
      `
      )
      .all(...ids) as Array<{ id: string; name: string; root_path: string | null }>;
    const byId = new Map(
      rows.map(row => [
        row.id,
        { id: row.id, name: row.name, rootPath: row.root_path } satisfies ProjectContextSummary,
      ])
    );
    return ids.flatMap(id => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  deleteById(id: string): boolean {
    return this.delete(id);
  }

  reorder(orderedIds: string[]): void {
    const update = this.db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?');
    this.db.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        update.run(i, orderedIds[i]);
      }
    })();
  }
}

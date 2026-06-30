import { BaseRepository } from '../../infra/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type { Automation, AutomationAction, AutomationTrigger } from '@zclaudia/shared/features/automations';
import { newId } from '../../utils/uuid.js';

type AutomationCreate = Omit<Automation, 'id' | 'createdAt' | 'updatedAt'>;
type AutomationUpdate = Partial<Omit<Automation, 'id' | 'projectId' | 'createdAt'>>;

export class AutomationRepository extends BaseRepository<Automation, AutomationCreate, AutomationUpdate> {
  constructor(db: Database) {
    super(db, 'automations');
  }

  mapRow(raw: unknown): Automation {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      projectId: (row.project_id as string) ?? undefined,
      name: row.name as string,
      description: (row.description as string) || undefined,
      enabled: row.enabled === 1,
      trigger: JSON.parse((row.trigger as string) || '{}') as AutomationTrigger,
      action: {
        kind: row.action_kind as AutomationAction['kind'],
        ref: row.action_ref as string,
        input: row.action_input ? (JSON.parse(row.action_input as string) as Record<string, unknown>) : undefined,
      },
      isSystem: row.is_system === 1,
      systemKey: (row.system_key as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  createQuery(data: AutomationCreate): { sql: string; params: unknown[] } {
    const id = newId();
    const now = Date.now();
    return {
      sql: `INSERT INTO automations (
        id, project_id, name, description, enabled, trigger,
        action_kind, action_ref, action_input, is_system, system_key,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.projectId ?? null,
        data.name,
        data.description ?? null,
        data.enabled ? 1 : 0,
        JSON.stringify(data.trigger),
        data.action.kind,
        data.action.ref,
        data.action.input ? JSON.stringify(data.action.input) : null,
        data.isSystem ? 1 : 0,
        data.systemKey ?? null,
        now,
        now,
      ],
    };
  }

  updateQuery(id: string, data: AutomationUpdate): { sql: string; params: unknown[] } {
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.enabled !== undefined) { sets.push('enabled = ?'); params.push(data.enabled ? 1 : 0); }
    if (data.trigger !== undefined) { sets.push('trigger = ?'); params.push(JSON.stringify(data.trigger)); }
    if (data.action !== undefined) {
      sets.push('action_kind = ?'); params.push(data.action.kind);
      sets.push('action_ref = ?'); params.push(data.action.ref);
      sets.push('action_input = ?'); params.push(data.action.input ? JSON.stringify(data.action.input) : null);
    }
    if (data.isSystem !== undefined) { sets.push('is_system = ?'); params.push(data.isSystem ? 1 : 0); }
    if (data.systemKey !== undefined) { sets.push('system_key = ?'); params.push(data.systemKey ?? null); }

    params.push(id);
    return { sql: `UPDATE automations SET ${sets.join(', ')} WHERE id = ?`, params };
  }

  findByProject(projectId: string): Automation[] {
    return this.db.prepare('SELECT * FROM automations WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId).map((r) => this.mapRow(r));
  }

  findAll(): Automation[] {
    return this.db.prepare('SELECT * FROM automations ORDER BY created_at DESC').all().map((r) => this.mapRow(r));
  }

  findAllEnabled(): Automation[] {
    return this.db.prepare('SELECT * FROM automations WHERE enabled = 1').all().map((r) => this.mapRow(r));
  }

  findBySystemKey(systemKey: string): Automation | null {
    const row = this.db.prepare('SELECT * FROM automations WHERE system_key = ?').get(systemKey);
    return row ? this.mapRow(row) : null;
  }
}

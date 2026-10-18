import type { Database } from 'better-sqlite3';
import type { AutoTitleConfig, UpdateAutoTitleConfigRequest } from '@zclaudia/shared/core/server';

interface AutoTitleConfigRow {
  id: number;
  enabled: number;
  model: string | null;
  created_at: number;
  updated_at: number;
}

function trimToNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readStoredConfig(db?: Database): AutoTitleConfigRow | null {
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `
      SELECT id, enabled, model, created_at, updated_at
      FROM auto_title_config
      WHERE id = 1
    `
      )
      .get() as AutoTitleConfigRow | undefined;
    return row ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such table')) return null;
    throw error;
  }
}

export function ensureAutoTitleConfigRow(db: Database): AutoTitleConfigRow {
  const now = Date.now();
  db.prepare(
    `
    INSERT OR IGNORE INTO auto_title_config (id, created_at, updated_at)
    VALUES (1, ?, ?)
  `
  ).run(now, now);
  const row = readStoredConfig(db);
  if (!row) throw new Error('auto_title_config row could not be created');
  return row;
}

/** Effective title-generation settings: stored row, or the enabled default. */
export function getAutoTitleConfig(db?: Database): { enabled: boolean; model: string | null } {
  const row = readStoredConfig(db);
  return {
    enabled: row ? row.enabled !== 0 : true,
    model: trimToNull(row?.model),
  };
}

export function getAutoTitleConfigView(db: Database): AutoTitleConfig {
  const row = ensureAutoTitleConfigRow(db);
  return {
    enabled: row.enabled !== 0,
    model: trimToNull(row.model),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateAutoTitleConfig(
  db: Database,
  input: UpdateAutoTitleConfigRequest
): AutoTitleConfig {
  ensureAutoTitleConfigRow(db);
  const updates: string[] = [];
  const params: unknown[] = [];

  if (Object.prototype.hasOwnProperty.call(input, 'enabled')) {
    updates.push('enabled = ?');
    params.push(input.enabled ? 1 : 0);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'model')) {
    updates.push('model = ?');
    params.push(trimToNull(input.model));
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(Date.now(), 1);
    db.prepare(`UPDATE auto_title_config SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  return getAutoTitleConfigView(db);
}

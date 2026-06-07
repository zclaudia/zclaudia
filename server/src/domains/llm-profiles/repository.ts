import { BaseRepository } from '../../infra/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type { LlmProfileConfig, LlmProfileCompat, LlmProfileModelEntry } from '@zclaudia/shared/core/llm-profile';
import { newId } from '../../utils/uuid.js';

export class LlmProfileRepository extends BaseRepository<
  LlmProfileConfig,
  Omit<LlmProfileConfig, 'id' | 'createdAt' | 'updatedAt'>,
  Partial<Omit<LlmProfileConfig, 'id' | 'createdAt' | 'updatedAt'>>
> {
  constructor(db: Database) {
    super(db, 'llm_profiles');
  }

  mapRow(row: any): LlmProfileConfig {
    return {
      id: row.id,
      name: row.name,
      providerType: row.provider_type,
      baseUrl: row.base_url ?? undefined,
      apiKey: row.api_key ?? undefined,
      compat: row.compat ? this.parseCompat(row.compat) : undefined,
      requestHeaders: row.request_headers ? JSON.parse(row.request_headers) : undefined,
      models: row.models != null ? this.parseModels(row.models) : undefined,
      oauthCredentials: row.oauth_credentials ? this.parseOAuthCredentials(row.oauth_credentials) : undefined,
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private parseCompat(raw: string): LlmProfileCompat | undefined {
    try {
      return JSON.parse(raw) as LlmProfileCompat;
    } catch (err) {
      console.warn('[LlmProfileRepository] invalid compat JSON, skipping:', err);
      return undefined;
    }
  }

  private parseModels(raw: string): LlmProfileModelEntry[] | undefined {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn('[LlmProfileRepository] models is not an array, ignoring');
        return undefined;
      }
      return parsed as LlmProfileModelEntry[];
    } catch (err) {
      console.warn('[LlmProfileRepository] invalid models JSON, ignoring:', err);
      return undefined;
    }
  }

  private parseOAuthCredentials(raw: string): LlmProfileConfig['oauthCredentials'] {
    try {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.access === 'string' &&
        typeof parsed?.refresh === 'string' &&
        typeof parsed?.expires === 'number' &&
        typeof parsed?.accountId === 'string'
      ) {
        return parsed;
      }
      console.warn('[LlmProfileRepository] oauth_credentials missing fields, ignoring');
      return undefined;
    } catch (err) {
      console.warn('[LlmProfileRepository] invalid oauth_credentials JSON, ignoring:', err);
      return undefined;
    }
  }

  createQuery(data: Omit<LlmProfileConfig, 'id' | 'createdAt' | 'updatedAt'>): { sql: string; params: any[] } {
    const id = newId();
    const now = Date.now();

    return {
      sql: `
        INSERT INTO llm_profiles (id, name, provider_type, base_url, api_key, compat, request_headers, models, oauth_credentials, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        id,
        data.name,
        data.providerType || 'anthropic',
        data.baseUrl || null,
        data.apiKey || null,
        data.compat ? JSON.stringify(data.compat) : null,
        data.requestHeaders ? JSON.stringify(data.requestHeaders) : null,
        data.models !== undefined ? JSON.stringify(data.models) : null,
        data.oauthCredentials ? JSON.stringify(data.oauthCredentials) : null,
        data.isDefault ? 1 : 0,
        now,
        now,
      ],
    };
  }

  updateQuery(id: string, data: Partial<Omit<LlmProfileConfig, 'id' | 'createdAt' | 'updatedAt'>>): { sql: string; params: any[] } {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.providerType !== undefined) {
      updates.push('provider_type = ?');
      params.push(data.providerType);
    }
    if (data.baseUrl !== undefined) {
      updates.push('base_url = ?');
      params.push(data.baseUrl || null);
    }
    if (data.apiKey !== undefined) {
      updates.push('api_key = ?');
      params.push(data.apiKey || null);
    }
    if (data.compat !== undefined) {
      updates.push('compat = ?');
      params.push(data.compat ? JSON.stringify(data.compat) : null);
    }
    if (data.requestHeaders !== undefined) {
      updates.push('request_headers = ?');
      params.push(data.requestHeaders ? JSON.stringify(data.requestHeaders) : null);
    }
    if (data.models !== undefined) {
      updates.push('models = ?');
      params.push(data.models !== null ? JSON.stringify(data.models) : null);
    }
    if (data.oauthCredentials !== undefined) {
      updates.push('oauth_credentials = ?');
      params.push(data.oauthCredentials === null ? null : JSON.stringify(data.oauthCredentials));
    }
    if (data.isDefault !== undefined) {
      updates.push('is_default = ?');
      params.push(data.isDefault ? 1 : 0);
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    return {
      sql: `UPDATE llm_profiles SET ${updates.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findDefault(): LlmProfileConfig | null {
    const row = this.db.prepare(`
      SELECT * FROM llm_profiles
      WHERE is_default = 1
      LIMIT 1
    `).get();
    return row ? this.mapRow(row) : null;
  }

  findAllOrdered(): LlmProfileConfig[] {
    const rows = this.db.prepare(`
      SELECT * FROM llm_profiles
      ORDER BY is_default DESC, name ASC
    `).all();
    return rows.map((row) => this.mapRow(row));
  }

  clearAllDefaults(): void {
    this.db.prepare('UPDATE llm_profiles SET is_default = 0').run();
  }

  clearDefaultsExcept(id: string): void {
    this.db.prepare('UPDATE llm_profiles SET is_default = 0 WHERE id != ?').run(id);
  }

  setDefault(id: string): LlmProfileConfig {
    this.db.prepare('UPDATE llm_profiles SET is_default = 0').run();

    const result = this.db.prepare(`
      UPDATE llm_profiles SET is_default = 1, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id);

    if (result.changes === 0) {
      throw new Error(`LlmProfile not found: ${id}`);
    }

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Failed to set default llm profile: ${id}`);
    }
    return updated;
  }
}

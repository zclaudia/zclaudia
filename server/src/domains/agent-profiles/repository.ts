import { BaseRepository } from '../../infra/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type { AgentProfileConfig, ThinkingLevel } from '@zclaudia/shared/core/agent-profile';
import { ALL_TOOL_NAMES, normalizeToolName } from '@zclaudia/shared/core/tools';
import { newId } from '../../utils/uuid.js';

const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

function normalizeEnabledTools(tools: string[]): string[] {
  const normalized = tools.flatMap((tool) => {
    const name = normalizeToolName(tool);
    return name ? [name] : [];
  });
  return [...new Set(normalized)];
}

export class AgentProfileRepository extends BaseRepository<
  AgentProfileConfig,
  Omit<AgentProfileConfig, 'id' | 'createdAt' | 'updatedAt'>,
  Partial<Omit<AgentProfileConfig, 'id' | 'createdAt' | 'updatedAt'>>
> {
  constructor(db: Database) {
    super(db, 'agent_profiles');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mapRow(row: any): AgentProfileConfig {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      llmProfileId: row.llm_profile_id,
      model: row.model,
      systemPrompt: row.system_prompt,
      enabledTools: this.parseEnabledTools(row.enabled_tools),
      thinkingLevel: this.parseThinkingLevel(row.thinking_level),
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private parseEnabledTools(raw: string | null): string[] {
    if (!raw) return [...ALL_TOOL_NAMES];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn('[AgentProfileRepository] enabled_tools is not an array, falling back to all 7');
        return [...ALL_TOOL_NAMES];
      }
      return normalizeEnabledTools(parsed.filter((s: unknown): s is string => typeof s === 'string'));
    } catch (err) {
      console.warn('[AgentProfileRepository] invalid enabled_tools JSON, falling back to all 7:', err);
      return [...ALL_TOOL_NAMES];
    }
  }

  private parseThinkingLevel(raw: string | null): ThinkingLevel | undefined {
    if (!raw) return undefined;
    if (VALID_THINKING_LEVELS.has(raw as ThinkingLevel)) return raw as ThinkingLevel;
    console.warn(`[AgentProfileRepository] invalid thinking_level "${raw}", falling back to undefined`);
    return undefined;
  }

  createQuery(data: Omit<AgentProfileConfig, 'id' | 'createdAt' | 'updatedAt'>): { sql: string; params: unknown[] } {
    const id = newId();
    const now = Date.now();
    return {
      sql: `
        INSERT INTO agent_profiles (id, name, description, llm_profile_id, model, system_prompt, enabled_tools, thinking_level, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        id,
        data.name,
        data.description ?? null,
        data.llmProfileId,
        data.model,
        data.systemPrompt,
        JSON.stringify(normalizeEnabledTools(data.enabledTools)),
        data.thinkingLevel ?? null,
        data.isDefault ? 1 : 0,
        now,
        now,
      ],
    };
  }

  updateQuery(
    id: string,
    data: Partial<Omit<AgentProfileConfig, 'id' | 'createdAt' | 'updatedAt'>>,
  ): { sql: string; params: unknown[] } {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description || null);
    }
    if (data.llmProfileId !== undefined) {
      updates.push('llm_profile_id = ?');
      params.push(data.llmProfileId);
    }
    if (data.model !== undefined) {
      updates.push('model = ?');
      params.push(data.model);
    }
    if (data.systemPrompt !== undefined) {
      updates.push('system_prompt = ?');
      params.push(data.systemPrompt);
    }
    if (data.enabledTools !== undefined) {
      updates.push('enabled_tools = ?');
      params.push(JSON.stringify(normalizeEnabledTools(data.enabledTools)));
    }
    if (data.thinkingLevel !== undefined) {
      updates.push('thinking_level = ?');
      params.push(data.thinkingLevel || null);
    }
    if (data.isDefault !== undefined) {
      updates.push('is_default = ?');
      params.push(data.isDefault ? 1 : 0);
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    return {
      sql: `UPDATE agent_profiles SET ${updates.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findDefault(): AgentProfileConfig | undefined {
    const row = this.db
      .prepare('SELECT * FROM agent_profiles WHERE is_default = 1 ORDER BY updated_at DESC LIMIT 1')
      .get();
    return row ? this.mapRow(row) : undefined;
  }

  findAllOrdered(): AgentProfileConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_profiles ORDER BY is_default DESC, name ASC')
      .all();
    return rows.map((r) => this.mapRow(r));
  }

  clearAllDefaults(): void {
    this.db.prepare('UPDATE agent_profiles SET is_default = 0 WHERE is_default = 1').run();
  }

  setDefault(id: string): AgentProfileConfig {
    this.clearAllDefaults();
    const result = this.db
      .prepare('UPDATE agent_profiles SET is_default = 1, updated_at = ? WHERE id = ?')
      .run(Date.now(), id);
    if (result.changes === 0) {
      throw new Error(`AgentProfile not found: ${id}`);
    }
    const profile = this.findById(id);
    if (!profile) throw new Error(`AgentProfile not found: ${id}`);
    return profile;
  }
}

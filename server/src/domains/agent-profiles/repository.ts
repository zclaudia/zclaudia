import { BaseRepository } from '../../infra/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type { AgentProfileConfig, ThinkingLevel } from '@zclaudia/shared/core/agent-profile';
import {
  ALL_TOOL_NAMES,
  BUILTIN_TOOL_SETS,
  builtinToolRef,
  legacyEnabledToolsToSelection,
  normalizeToolName,
  resolveToolSelection,
  type BuiltinToolSetId,
  type ToolRef,
  type ToolSelection,
  type ToolSetRef,
} from '@zclaudia/shared/core/tools';
import { newId } from '../../utils/uuid.js';

const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

function normalizeEnabledTools(tools: string[]): string[] {
  const normalized = tools.flatMap((tool) => {
    const name = normalizeToolName(tool);
    return name ? [name] : [];
  });
  return [...new Set(normalized)];
}

function normalizeToolRef(ref: unknown): ToolRef | undefined {
  if (!ref || typeof ref !== 'object' || !('source' in ref)) return undefined;
  const candidate = ref as Record<string, unknown>;
  if (candidate.source === 'builtin' && typeof candidate.name === 'string') {
    const name = normalizeToolName(candidate.name);
    return name ? builtinToolRef(name) : undefined;
  }
  if (
    candidate.source === 'plugin'
    && typeof candidate.pluginId === 'string'
    && typeof candidate.toolId === 'string'
  ) {
    return { source: 'plugin', pluginId: candidate.pluginId, toolId: candidate.toolId };
  }
  if (
    candidate.source === 'mcp'
    && typeof candidate.server === 'string'
    && typeof candidate.tool === 'string'
  ) {
    return { source: 'mcp', server: candidate.server, tool: candidate.tool };
  }
  if (candidate.source === 'interaction' && typeof candidate.toolId === 'string') {
    return { source: 'interaction', toolId: candidate.toolId };
  }
  return undefined;
}

function normalizeToolSelection(value: unknown): ToolSelection | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const sets: ToolSetRef[] = Array.isArray(candidate.sets)
    ? candidate.sets.flatMap<ToolSetRef>((set) => {
      if (!set || typeof set !== 'object' || !('source' in set)) return [];
      const row = set as Record<string, unknown>;
      if (row.source === 'builtin' && typeof row.id === 'string') {
        if (!Object.prototype.hasOwnProperty.call(BUILTIN_TOOL_SETS, row.id)) return [];
        return [{ source: 'builtin', id: row.id as BuiltinToolSetId }];
      }
      if (row.source === 'plugin' && typeof row.pluginId === 'string' && typeof row.id === 'string') {
        return [{ source: 'plugin', pluginId: row.pluginId, id: row.id }];
      }
      return [];
    })
    : [];
  const include = Array.isArray(candidate.include)
    ? candidate.include.flatMap((ref) => {
      const normalized = normalizeToolRef(ref);
      return normalized ? [normalized] : [];
    })
    : [];
  const exclude = Array.isArray(candidate.exclude)
    ? candidate.exclude.flatMap((ref) => {
      const normalized = normalizeToolRef(ref);
      return normalized ? [normalized] : [];
    })
    : [];
  return { sets, include, exclude };
}

function stringifySelection(selection: ToolSelection): string {
  return JSON.stringify(selection);
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
    const toolSelection = this.parseToolSelection(row.tool_selection, row.enabled_tools);
    const resolved = resolveToolSelection(toolSelection);
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      llmProfileId: row.llm_profile_id,
      model: row.model,
      systemPrompt: row.system_prompt,
      enabledTools: resolved.builtinTools,
      toolSelection,
      resolvedTools: resolved.refs,
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

  private parseToolSelection(raw: string | null | undefined, fallbackEnabledTools: string | null): ToolSelection {
    if (raw) {
      try {
        const parsed = normalizeToolSelection(JSON.parse(raw));
        if (parsed) return parsed;
      } catch (err) {
        console.warn('[AgentProfileRepository] invalid tool_selection JSON, falling back to enabled_tools:', err);
      }
    }
    return legacyEnabledToolsToSelection(this.parseEnabledTools(fallbackEnabledTools));
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
    const toolSelection = data.toolSelection ?? legacyEnabledToolsToSelection(data.enabledTools);
    const enabledTools = resolveToolSelection(toolSelection).builtinTools;
    return {
      sql: `
        INSERT INTO agent_profiles (id, name, description, llm_profile_id, model, system_prompt, enabled_tools, tool_selection, thinking_level, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        id,
        data.name,
        data.description ?? null,
        data.llmProfileId,
        data.model,
        data.systemPrompt,
        JSON.stringify(enabledTools),
        stringifySelection(toolSelection),
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
    if (data.enabledTools !== undefined && data.toolSelection === undefined) {
      updates.push('enabled_tools = ?');
      params.push(JSON.stringify(normalizeEnabledTools(data.enabledTools)));
      updates.push('tool_selection = ?');
      params.push(stringifySelection(legacyEnabledToolsToSelection(data.enabledTools)));
    }
    if (data.toolSelection !== undefined) {
      const toolSelection = data.toolSelection;
      updates.push('tool_selection = ?');
      params.push(stringifySelection(toolSelection));
      updates.push('enabled_tools = ?');
      params.push(JSON.stringify(resolveToolSelection(toolSelection).builtinTools));
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

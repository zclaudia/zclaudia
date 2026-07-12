import type { ToolRef, ToolSelection } from './tools.js';
import type { SkillExecutionSelection, SkillSelection } from './skills.js';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** Built-in runtimes always present. Plugins register additional runtime types at runtime. */
export const BUILTIN_AGENT_RUNTIME_TYPES = ['zclaudia'] as const;
/** Known built-in runtime literals, kept for ergonomic narrowing; any string is accepted. */
export type BuiltinAgentRuntimeType = (typeof BUILTIN_AGENT_RUNTIME_TYPES)[number];
/** A runtime type is an open string set (plugin-extensible). */
export type AgentRuntimeType = BuiltinAgentRuntimeType | (string & {});

/** @deprecated use provider registry for validation; kept for legacy imports. */
export const AGENT_RUNTIME_TYPES = ['zclaudia', 'claude', 'codex', 'cursor'] as const;

export interface MultimodalFallbackConfig {
  llmProfileId: string;
  model: string;
}

/**
 * Lifecycle status of an agent profile.
 * - `active` — normal: editable, selectable for new sessions, eligible as default.
 * - `readonly` — frozen: still resolved by existing sessions (the FK is preserved),
 *   but not editable, not selectable for new sessions, and its sessions become
 *   read-only (derived). Reached by deleting an agent that active sessions reference;
 *   cleared once no active session references it (then it can be hard-deleted).
 *
 * This is distinct from session `archived_at` (soft-delete of a session) and from
 * session `isReadOnly` (Supervisor plan-mode lock).
 */
export type AgentProfileStatus = 'active' | 'readonly';

export interface AgentProfileConfig {
  id: string;
  name: string;
  description?: string;
  runtimeType?: AgentRuntimeType;
  llmProfileId: string;
  model: string;
  /** Optional runtime executable path for native CLI-backed agents such as Claude. */
  cliPath?: string;
  systemPrompt: string;
  /** Serialized as JSON in DB; in-memory is array of tool names (loose `string[]` to allow forward-compat tools that aren't yet in `ALL_TOOL_NAMES`). */
  enabledTools: string[];
  /** Preferred tool configuration. When absent, enabledTools is treated as legacy built-in includes. */
  toolSelection?: ToolSelection;
  /** Resolved tool refs returned by APIs for display/debugging; not persisted directly. */
  resolvedTools?: ToolRef[];
  /** Optional profile-level skill visibility and pinned inline context configuration. */
  skillSelection?: SkillSelection;
  /** Optional profile-level skill execution policy overrides. */
  skillExecution?: SkillExecutionSelection;
  /** Run-local fallback used only when the current user input contains images and the primary model lacks vision. */
  multimodalFallback?: MultimodalFallbackConfig;
  thinkingLevel?: ThinkingLevel;
  isDefault?: boolean;
  /** Lifecycle status; omitted/undefined treated as 'active'. */
  status?: AgentProfileStatus;
  source?: 'user' | 'plugin';
  pluginId?: string;
  pluginProfileId?: string;
  createdAt: number;
  updatedAt: number;
}

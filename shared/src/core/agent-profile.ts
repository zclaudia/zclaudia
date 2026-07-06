import type { ToolRef, ToolSelection } from './tools.js';
import type { SkillExecutionSelection, SkillSelection } from './skills.js';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const AGENT_RUNTIME_TYPES = ['zclaudia', 'claude', 'codex', 'cursor'] as const;
export type AgentRuntimeType = (typeof AGENT_RUNTIME_TYPES)[number];

export interface MultimodalFallbackConfig {
  llmProfileId: string;
  model: string;
}

export interface AgentProfileConfig {
  id: string;
  name: string;
  description?: string;
  runtimeType?: AgentRuntimeType;
  llmProfileId: string;
  model: string;
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
  source?: 'user' | 'plugin';
  pluginId?: string;
  pluginProfileId?: string;
  createdAt: number;
  updatedAt: number;
}

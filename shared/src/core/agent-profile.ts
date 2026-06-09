import type { ToolRef, ToolSelection } from './tools.js';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface AgentProfileConfig {
  id: string;
  name: string;
  description?: string;
  llmProfileId: string;
  model: string;
  systemPrompt: string;
  /** Serialized as JSON in DB; in-memory is array of tool names (loose `string[]` to allow forward-compat tools that aren't yet in `ALL_TOOL_NAMES`). */
  enabledTools: string[];
  /** Preferred tool configuration. When absent, enabledTools is treated as legacy built-in includes. */
  toolSelection?: ToolSelection;
  /** Resolved tool refs returned by APIs for display/debugging; not persisted directly. */
  resolvedTools?: ToolRef[];
  thinkingLevel?: ThinkingLevel;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

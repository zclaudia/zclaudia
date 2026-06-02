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
  thinkingLevel?: ThinkingLevel;
  isDefault?: boolean;
  /** Optional per-agent context window override (tokens). Null/undefined means use provider default. */
  contextWindow?: number | null;
  createdAt: number;
  updatedAt: number;
}

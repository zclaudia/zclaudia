// Shared run types. Kept in a dedicated module so runStore, chatMessageStore
// and the run coordination services can share them without importing each
// other (stores/ helper modules are the sanctioned sharing point).
import type { ToolEffect } from '@zclaudia/shared/core/message';
import type { ToolSemantic } from '@zclaudia/shared/wire/messages/run';

// Tool call state for displaying in the UI
export interface ToolCallState {
  id: string; // tool_use_id
  toolName: string;
  toolInput: unknown;
  status: 'running' | 'completed' | 'error';
  result?: unknown;
  isError?: boolean;
  activity?: string; // Subagent activity text (e.g. "Reading file X...")
  /**
   * Provider-declared semantic category (e.g. `'plan_proposal'`). Lets the
   * UI pick a renderer without string-matching provider-specific tool names.
   */
  semantic?: ToolSemantic;
  effect?: ToolEffect;
}

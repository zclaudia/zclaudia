// Runtime capabilities and permission modes (drive the UI selectors).
// These types describe what the runtime adapter exposes to the client; they
// are intentionally decoupled from the LLM connection profile shape.

/** Runtime permission modes supported by the initial zclaudia shell. */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/** A selectable option in the Mode dropdown (permission mode, agent, etc.) */
export interface ModeOption {
  id: string;           // Value sent to server (e.g. 'default', 'plan', 'build')
  label: string;        // Display text (e.g. 'Default', 'Plan')
  description?: string; // Tooltip / subtitle
  icon?: string;        // Emoji or icon identifier
}

/** A selectable option in the Model dropdown */
export interface ModelOption {
  id: string;           // Value sent to server (e.g. 'zclaudia-stub')
  label: string;        // Display text (e.g. 'ZClaudia Stub')
  group?: string;       // Optional grouping
}

/** What the runtime supports — drives the UI selectors */
export interface ProviderCapabilities {
  modes: ModeOption[];    // Empty array → hide mode selector entirely
  models: ModelOption[];  // Empty array → hide model selector entirely
  modeLabel?: string;     // Custom label, e.g. "Mode"
  modelLabel?: string;    // Custom label: "Model" for all
  defaultModeId?: string; // Which mode is selected by default
  supportsAIReview?: boolean; // Whether this provider can be used for AI review tasks
}

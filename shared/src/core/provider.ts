// Agent runtime types

export const PROVIDER_TYPES = ['zclaudia'] as const;
export type ProviderType = typeof PROVIDER_TYPES[number];

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  cliPath?: string;
  env?: Record<string, string>;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

// Runtime capabilities (drives UI selectors)

/** Runtime modes supported by the initial zclaudia shell. */
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

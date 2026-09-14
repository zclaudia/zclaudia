// Runtime capabilities (drives the UI selectors).
//
// User-facing mode dropdown is back, driven by ProviderCapabilities.modes,
// so adding new modes in the future only needs a capabilities entry — no
// wire schema or store changes. Host approval overrides are separate from
// native execution modes and cannot replace an engine sandbox.
//
// The runtime-internal "mode_change" event carries the same string values
// ('plan' | 'default') the user mode selector emits, so phase transitions
// roundtrip through the same vocabulary.

/** A selectable option in the Mode dropdown (e.g. 'default', 'plan'). */
export interface ModeOption {
  id: string; // Value sent to server (e.g. 'default', 'plan')
  label: string; // Display text (e.g. 'Default', 'Plan')
  description?: string; // Tooltip / subtitle
  icon?: string; // Emoji or icon identifier
}

/** A selectable option in the Model dropdown. */
export interface ModelOption {
  id: string; // Value sent to server (e.g. 'zclaudia-stub')
  label: string; // Display text
  group?: string; // Optional grouping
}

/** What the runtime supports — drives the UI selectors. */
export interface ProviderCapabilities {
  modes: ModeOption[]; // Empty array → hide mode selector entirely
  models: ModelOption[]; // Empty array → hide model selector entirely
  modeLabel?: string;
  modelLabel?: string;
  defaultModeId?: string; // Selected by default when no per-session override
  supportsAIReview?: boolean;
  /** False when the CLI cannot apply host per-tool permission overrides. */
  supportsPermissionOverrides?: boolean;
}

/** Session-owned model selection. Null inherits the session/agent default. */
export interface SessionModelSelection {
  model: string | null;
  thinkingLevel: import('./agent-profile.js').ThinkingLevel | null;
  revision: number;
}

export interface RuntimeModelOption {
  id: string;
  label: string;
  /** Only levels explicitly advertised by this model/connection. */
  thinkingLevels?: string[];
}

/** Optional built-in adapter extension; absence means discovery is unavailable. */
export interface RuntimeModelCatalog {
  models: RuntimeModelOption[];
  currentModel?: string;
}

export interface SessionModelSettings {
  selection: SessionModelSelection;
  runtimeType: string;
  engineMode: string;
  inheritedModel: string;
  inheritedThinkingLevel?: import('./agent-profile.js').ThinkingLevel;
  defaultModel?: string;
  models: RuntimeModelOption[];
  allowManualModel: boolean;
  supportsPermissionOverrides: boolean;
  permissionNote: string;
  discoveryError?: string;
}

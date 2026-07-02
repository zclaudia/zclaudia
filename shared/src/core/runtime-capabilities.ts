// Runtime capabilities (drives the UI selectors).
//
// User-facing mode dropdown is back, driven by ProviderCapabilities.modes,
// so adding new modes in the future only needs a capabilities entry — no
// wire schema or store changes. permissionOverride (UnifiedPermissionPolicy)
// stays the right place for permission-style overrides (acceptEdits /
// bypassPermissions live as PermissionSelector presets, not modes).
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
}

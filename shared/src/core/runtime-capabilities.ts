// Runtime capabilities (drives the UI selectors).
//
// PermissionMode was removed; the UI selectors now are:
//   - planMode: boolean (replaces user-facing `plan` mode value)
//   - permissionOverride: UnifiedPermissionPolicy (replaces acceptEdits / bypassPermissions)
//
// Internal runtime "mode_change" events still carry string values
// ('plan' | 'default') to signal phase transitions, but those are not
// user-selectable modes.

/** A selectable option in the Model dropdown */
export interface ModelOption {
  id: string;           // Value sent to server (e.g. 'zclaudia-stub')
  label: string;        // Display text
  group?: string;       // Optional grouping
}

/** What the runtime supports — drives the UI selectors */
export interface ProviderCapabilities {
  models: ModelOption[];      // Empty array → hide model selector entirely
  modelLabel?: string;
  supportsAIReview?: boolean;
}

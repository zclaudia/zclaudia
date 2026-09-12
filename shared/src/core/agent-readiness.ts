/**
 * Why no usable agent exists. Drives the guidance copy + which settings tab to open.
 * - `no_model`: the agent has a credentialed profile but its selected model is
 *   blank or is not among the models the profile declares it serves.
 */
export type AgentReadinessReason =
  | 'no_agent'
  | 'no_llm_profile'
  | 'no_credential'
  | 'no_model'
  | 'runtime_unavailable'
  | 'runtime_missing'
  | 'runtime_incompatible'
  | 'runtime_auth_required'
  | 'runtime_check_failed'
  // Dual-mode (engineMode) readiness layers — mirror the canonical
  // RUNTIME_ERROR_CODES taxonomy so hosts and plugins surface one set of codes:
  | 'engine_mode_unsupported'
  | 'llm_protocol_unsupported'
  | 'llm_option_unsupported'
  | 'sdk_engine_unavailable'
  | 'bundled_engine_unavailable'
  | 'runtime_binding_key_unavailable'
  | 'session_connection_changed'
  | 'session_workspace_changed'
  | 'session_resume_unavailable'
  | 'llm_profile_required';

/**
 * Result of the server-side readiness check, including CLI detection for external runtimes. `usable` is true iff at
 * least one agent profile resolves to an LLM profile with a non-empty credential
 * and a usable model. `reason` is present only when `usable` is false.
 */
export interface AgentReadiness {
  usable: boolean;
  reason?: AgentReadinessReason;
}

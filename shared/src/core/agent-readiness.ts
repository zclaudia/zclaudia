/**
 * Why no usable agent exists. Drives the guidance copy + which settings tab to open.
 * - `no_model`: the agent has a credentialed profile but its selected model is
 *   blank or is not among the models the profile declares it serves.
 */
export type AgentReadinessReason = 'no_agent' | 'no_llm_profile' | 'no_credential' | 'no_model';

/**
 * Result of the server-side structural readiness check. `usable` is true iff at
 * least one agent profile resolves to an LLM profile with a non-empty credential
 * and a usable model. `reason` is present only when `usable` is false.
 */
export interface AgentReadiness {
  usable: boolean;
  reason?: AgentReadinessReason;
}

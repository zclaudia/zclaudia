/** Why no usable agent exists. Drives the guidance copy + which settings tab to open. */
export type AgentReadinessReason = 'no_agent' | 'no_llm_profile' | 'no_credential';

/**
 * Result of the server-side structural readiness check. `usable` is true iff at
 * least one agent profile resolves to an LLM profile with a non-empty credential.
 * `reason` is present only when `usable` is false.
 */
export interface AgentReadiness {
  usable: boolean;
  reason?: AgentReadinessReason;
}

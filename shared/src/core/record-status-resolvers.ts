/**
 * Pure per-type resolvers: raw signals → RecordStatus. Primitive inputs only
 * (no domain config types) so the module stays dependency-free and reusable by
 * both server (from rows) and desktop (from DTOs).
 *
 * See docs/specs/2026-07-15-unified-record-status-design.md.
 */
import type { RecordStatus, RecordCompleteness, RecordAvailability } from './record-status.js';
import type { McpServerStatusState } from './mcp.js';

/**
 * LLM profile: draft until it declares a model; unavailable(no_credential) when
 * complete but lacking any credential (a model-less profile reads as draft,
 * which outranks availability).
 */
export function resolveLlmProfileStatus(input: {
  hasModel: boolean;
  hasCredential: boolean;
}): RecordStatus {
  const completeness: RecordCompleteness = input.hasModel ? 'ready' : 'draft';
  const availability: RecordAvailability = input.hasCredential
    ? { usable: true }
    : { usable: false, reason: 'no_credential' };
  return { completeness, availability };
}

/**
 * MCP server: draft until it has a transport endpoint (command/url); its live
 * connection state drives availability; the enabled flag drives disabled.
 */
export function resolveMcpServerStatus(input: {
  hasEndpoint: boolean;
  enabled: boolean;
  connectionState?: McpServerStatusState;
}): RecordStatus {
  const completeness: RecordCompleteness = input.hasEndpoint ? 'ready' : 'draft';
  let availability: RecordAvailability = { usable: true };
  if (input.connectionState === 'needs-auth') {
    availability = { usable: false, reason: 'needs_auth' };
  } else if (input.connectionState === 'failed') {
    availability = { usable: false, reason: 'connect_failed' };
  }
  return { completeness, availability, disabled: !input.enabled };
}

/**
 * Skill: draft until its content is meaningful (more than a template stub);
 * unavailable(requirement_unmet) when complete but its os/binary/env
 * requirements are not met.
 */
export function resolveSkillStatus(input: {
  contentMeaningful: boolean;
  eligible: boolean;
}): RecordStatus {
  const completeness: RecordCompleteness = input.contentMeaningful ? 'ready' : 'draft';
  const availability: RecordAvailability = input.eligible
    ? { usable: true }
    : { usable: false, reason: 'requirement_unmet' };
  return { completeness, availability };
}

/**
 * Agent profile: runtimes that don't bind an LLM are always ready. Otherwise
 * draft until it has both an LLM binding and a model; availability names why the
 * bound LLM can't serve (no binding → no_llm_profile, bound-but-broken →
 * llm_unavailable; the LLM profile itself surfaces the specific reason).
 */
export function resolveAgentProfileStatus(input: {
  requiresLlm: boolean;
  hasLlmBinding: boolean;
  hasModel: boolean;
  llmUsable: boolean;
}): RecordStatus {
  if (!input.requiresLlm) {
    return { completeness: 'ready', availability: { usable: true } };
  }
  const completeness: RecordCompleteness =
    input.hasLlmBinding && input.hasModel ? 'ready' : 'draft';
  const availability: RecordAvailability = !input.hasLlmBinding
    ? { usable: false, reason: 'no_llm_profile' }
    : !input.llmUsable
      ? { usable: false, reason: 'llm_unavailable' }
      : { usable: true };
  return { completeness, availability };
}

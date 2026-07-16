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

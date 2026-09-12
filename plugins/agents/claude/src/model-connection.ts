import type { RuntimeModelConnection } from '@zclaudia/plugin-sdk/providers';
import { RuntimeContractError } from '@zclaudia/plugin-sdk/providers';

/**
 * Explicit model connection → Claude SDK environment mapping (design: Claude
 * §4.4/§6.1). The host has already validated and normalized the connection;
 * this module only translates it into the environment variables the engine
 * reads, and never merges the parent process environment back in.
 */

/** Default Anthropic public API root (engine appends versioned paths). */
export const ANTHROPIC_DEFAULT_ENGINE_BASE_URL = 'https://api.anthropic.com';

/**
 * Serialize profile headers into the engine's `ANTHROPIC_CUSTOM_HEADERS`
 * format ("Name: Value" pairs separated by newlines). Reserved headers were
 * already rejected by the host; values must not contain CR/LF.
 */
export function formatCustomHeaders(headers: Record<string, string> | undefined): string | undefined {
  const entries = Object.entries(headers ?? {}).filter(([, value]) => value !== undefined && value !== '');
  if (entries.length === 0) return undefined;
  return entries.map(([name, value]) => `${name}: ${value}`).join('\n');
}

export interface ClaudeModelConnectionEnv {
  /** ANTHROPIC_BASE_URL (host-normalized; no trailing version segment). */
  baseUrl: string;
  apiKey: string;
  customHeaders?: string;
  /**
   * Selected model, pinned onto the engine's auxiliary model aliases so
   * subagent/haiku-class auxiliary requests stay inside the same connection.
   */
  model?: string;
}

export function toClaudeModelConnectionEnv(
  connection: RuntimeModelConnection,
  model?: string
): ClaudeModelConnectionEnv {
  if (connection.protocol !== 'anthropic-messages') {
    throw new RuntimeContractError(
      'RUNTIME_PROTOCOL_UNSUPPORTED',
      `Claude SDK accepts only the anthropic-messages protocol (got "${connection.protocol}")`
    );
  }
  const baseUrl = connection.baseUrl.trim() || ANTHROPIC_DEFAULT_ENGINE_BASE_URL;
  const apiKey = connection.apiKey;
  if (!apiKey) {
    throw new RuntimeContractError('LLM_AUTH_UNSUPPORTED', 'The model connection has no API key');
  }
  return {
    baseUrl,
    apiKey,
    customHeaders: formatCustomHeaders(connection.requestHeaders),
    model: model?.trim() || undefined,
  };
}

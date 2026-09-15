import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import {
  OFFICIAL_OPENAI_BASE_URL,
  resolveLlmProfileProtocols,
} from '@zclaudia/shared/core/llm-profile';
import type { RuntimeModelConnection } from '@zclaudia/shared/providers';
import type { RUNTIME_ERROR_CODES } from '@zclaudia/shared/providers';

/**
 * Strict LLM profile → runtime model connection resolution for SDK engine
 * modes (design: Claude §4.3, Codex §4.3/§4.4).
 *
 * Admission rules are runtime-scoped and evaluated at runtime with whitelists —
 * never via TS narrowing (`LlmProviderType` is an open string type, so unknown
 * imported values must be rejected here, not by the compiler or the frontend).
 * No global-default fallback: an SDK run without an explicit binding fails.
 */

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** Header names the connection layer owns; profiles may not override them. */
const RESERVED_CONNECTION_HEADERS = new Set(['authorization', 'content-type', 'host']);

export type ConnectionErrorCode = Extract<
  (typeof RUNTIME_ERROR_CODES)[number],
  | 'LLM_PROFILE_REQUIRED'
  | 'LLM_PROFILE_NOT_FOUND'
  | 'LLM_PROTOCOL_UNSUPPORTED'
  | 'LLM_AUTH_UNSUPPORTED'
  | 'LLM_PROFILE_FIELD_UNSUPPORTED'
  | 'LLM_OPTION_UNSUPPORTED'
>;

export interface ConnectionRejection {
  ok: false;
  code: ConnectionErrorCode;
  message: string;
  details?: Record<string, string>;
}

export interface ConnectionResolution {
  ok: true;
  connection: RuntimeModelConnection;
  /** Inputs for the binding identity hash (no API key material). */
  identity: {
    protocol: string;
    baseUrl: string;
    authMethod: 'api-key';
    headers: Record<string, string>;
  };
}

export type RuntimeModelConnectionResolution = ConnectionResolution | ConnectionRejection;

/** Anthropic engine base URL: keep proxy path prefixes, drop a terminal `/v1` (the engine appends versioned paths). */
export function toAnthropicEngineBaseUrl(rawBaseUrl: string | undefined | null): string {
  const trimmed = rawBaseUrl?.trim();
  let url = trimmed ? trimmed : ANTHROPIC_DEFAULT_BASE_URL;
  url = url.replace(/\/+$/, '');
  if (/\/v1$/i.test(url)) url = url.slice(0, -3);
  return url;
}

function reject(
  code: ConnectionErrorCode,
  message: string,
  details?: Record<string, string>
): ConnectionRejection {
  return { ok: false, code, message, details };
}

function validateHttpUrl(raw: string, label: string): ConnectionRejection | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return reject('LLM_OPTION_UNSUPPORTED', `${label} must use http(s)`, { baseUrl: raw });
    }
    if (parsed.username || parsed.password) {
      return reject('LLM_OPTION_UNSUPPORTED', `${label} must not embed credentials`, {});
    }
    return null;
  } catch {
    return reject('LLM_OPTION_UNSUPPORTED', `${label} is not a valid URL`, { baseUrl: raw });
  }
}

/** Validate custom routing headers; reserved names and CR/LF injection are rejected. */
export function validateConnectionHeaders(
  headers: Record<string, string> | undefined
): ConnectionRejection | null {
  if (!headers) return null;
  for (const [name, value] of Object.entries(headers)) {
    if (RESERVED_CONNECTION_HEADERS.has(name.trim().toLowerCase())) {
      return reject(
        'LLM_OPTION_UNSUPPORTED',
        `Header "${name}" is managed by the connection (auth/content-type/host) and cannot be overridden`,
        { header: name }
      );
    }
    if (/[^\x20-\x7E]/.test(name) || /[\r\n]/.test(value)) {
      return reject('LLM_OPTION_UNSUPPORTED', `Header "${name}" contains control characters`, {
        header: name,
      });
    }
  }
  return null;
}

/** pi-specific request-behaviour overrides that do not map onto SDK engine connections. */
function findUnmappableProfileFields(profile: LlmProfileConfig): string[] {
  const unmappable: string[] = [];
  if (profile.compat && Object.keys(profile.compat).length > 0) unmappable.push('compat');
  if (profile.cacheRetention) unmappable.push('cacheRetention');
  return unmappable;
}

function requireApiKey(profile: LlmProfileConfig): ConnectionRejection | null {
  if (profile.oauthCredentials?.access) {
    return reject(
      'LLM_AUTH_UNSUPPORTED',
      'OAuth credentials cannot drive an SDK engine connection; use an API key profile'
    );
  }
  if (!profile.apiKey || !profile.apiKey.trim()) {
    return reject('LLM_AUTH_UNSUPPORTED', 'The bound LLM profile has no API key configured');
  }
  return null;
}

function resolveClaudeConnection(
  profile: LlmProfileConfig,
  model: string
): RuntimeModelConnectionResolution {
  // Runtime whitelist: unknown providerType strings are rejected even though
  // the shared type technically allows any string.
  if (profile.providerType !== 'anthropic') {
    return reject(
      'LLM_PROTOCOL_UNSUPPORTED',
      `Claude SDK requires an anthropic LLM profile (got providerType "${profile.providerType}")`,
      { providerType: profile.providerType }
    );
  }
  const authError = requireApiKey(profile);
  if (authError) return authError;

  const protocols = resolveLlmProfileProtocols(profile);
  if (!protocols.protocols.includes('anthropic-messages')) {
    return reject(
      'LLM_PROTOCOL_UNSUPPORTED',
      'The bound LLM profile does not support the anthropic-messages protocol',
      { declared: protocols.source }
    );
  }

  const unmappable = findUnmappableProfileFields(profile);
  if (unmappable.length > 0) {
    return reject(
      'LLM_PROFILE_FIELD_UNSUPPORTED',
      `Profile fields not supported by the Claude SDK connection: ${unmappable.join(', ')}`,
      { fields: unmappable.join(',') }
    );
  }

  const headerError = validateConnectionHeaders(profile.requestHeaders);
  if (headerError) return headerError;

  const baseUrl = toAnthropicEngineBaseUrl(profile.baseUrl);
  const urlError = validateHttpUrl(baseUrl, 'Profile baseUrl');
  if (urlError) return urlError;

  if (!model.trim()) {
    return reject('LLM_OPTION_UNSUPPORTED', 'An explicit model is required in SDK mode');
  }

  return {
    ok: true,
    connection: {
      protocol: 'anthropic-messages',
      baseUrl,
      apiKey: profile.apiKey!,
      requestHeaders: profile.requestHeaders,
    },
    identity: {
      protocol: 'anthropic-messages',
      baseUrl,
      authMethod: 'api-key',
      headers: profile.requestHeaders ?? {},
    },
  };
}

function resolveCodexConnection(
  profile: LlmProfileConfig,
  model: string
): RuntimeModelConnectionResolution {
  // Strict whitelist: openai-codex OAuth profiles are rejected even if they
  // hand-declare openai-responses; unknown providerType strings are rejected.
  if (profile.providerType === 'openai-codex') {
    return reject(
      'LLM_AUTH_UNSUPPORTED',
      'Codex OAuth profiles cannot drive the Codex SDK connection; use an API key profile'
    );
  }
  if (profile.providerType !== 'openai') {
    return reject(
      'LLM_PROTOCOL_UNSUPPORTED',
      `Codex SDK requires an openai LLM profile (got providerType "${profile.providerType}")`,
      { providerType: profile.providerType }
    );
  }
  const authError = requireApiKey(profile);
  if (authError) return authError;

  const protocols = resolveLlmProfileProtocols(profile);
  if (!protocols.protocols.includes('openai-responses')) {
    const reason =
      protocols.source === 'declared'
        ? 'The bound LLM profile does not declare openai-responses support'
        : 'Custom endpoints must explicitly declare openai-responses support before they can be selected';
    return reject('LLM_PROTOCOL_UNSUPPORTED', reason, { declared: protocols.source });
  }

  const unmappable = findUnmappableProfileFields(profile);
  if (unmappable.length > 0) {
    return reject(
      'LLM_PROFILE_FIELD_UNSUPPORTED',
      `Profile fields not supported by the Codex SDK connection: ${unmappable.join(', ')}`,
      { fields: unmappable.join(',') }
    );
  }

  const headerError = validateConnectionHeaders(profile.requestHeaders);
  if (headerError) return headerError;

  const rawBaseUrl = profile.baseUrl?.trim() || OFFICIAL_OPENAI_BASE_URL;
  // Responses base URL is kept as-is (proxy path prefixes preserved); protocol
  // rewriting (/chat/completions → /responses) is explicitly forbidden.
  const urlError = validateHttpUrl(rawBaseUrl, 'Profile baseUrl');
  if (urlError) return urlError;
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');

  if (!model.trim()) {
    return reject('LLM_OPTION_UNSUPPORTED', 'An explicit model is required in SDK mode');
  }

  return {
    ok: true,
    connection: {
      protocol: 'openai-responses',
      baseUrl,
      apiKey: profile.apiKey!,
      requestHeaders: profile.requestHeaders,
    },
    identity: {
      protocol: 'openai-responses',
      baseUrl,
      authMethod: 'api-key',
      headers: profile.requestHeaders ?? {},
    },
  };
}

export interface ResolveRuntimeModelConnectionInput {
  runtimeType: string;
  profile: LlmProfileConfig | null | undefined;
  model: string;
}

/** Resolve the strict per-runtime model connection for SDK engine modes. */
export function resolveRuntimeModelConnection(
  input: ResolveRuntimeModelConnectionInput
): RuntimeModelConnectionResolution {
  if (!input.profile) {
    return reject('LLM_PROFILE_REQUIRED', 'SDK mode requires an explicitly bound LLM profile');
  }
  switch (input.runtimeType) {
    case 'claude':
      return resolveClaudeConnection(input.profile, input.model);
    case 'codex':
      return resolveCodexConnection(input.profile, input.model);
    default:
      return reject(
        'LLM_PROTOCOL_UNSUPPORTED',
        `Runtime "${input.runtimeType}" has no SDK model connection support`,
        { runtimeType: input.runtimeType }
      );
  }
}

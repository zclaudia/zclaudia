import { toClaudeModelConnectionEnv } from './model-connection.js';
import type { RuntimeModelConnection } from '@zclaudia/plugin-sdk/providers';

/**
 * SDK-mode environment construction (design: Claude §6.1).
 *
 * The final environment is built fresh per run from an explicit allowlist —
 * `process.env` is never merged in and never mutated. Anything not on the
 * allowlist (inherited API keys, auth/OAuth tokens, base URLs, custom headers,
 * cloud provider switches, model aliases) is absent by construction, so an
 * external login cannot leak into a run whose connection comes from a bound
 * LLM profile. Only then are the current connection's variables injected.
 */

/** Keys an SDK run keeps from the host process: shell execution, locale, proxy/cert handling. */
const SDK_ENVIRONMENT_ALLOWLIST = [
  // Process execution / tooling
  'PATH',
  'HOME',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'WINDIR',
  'SHELL',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
  // Locale / timezone / terminal hygiene
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  // Proxies / TLS
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  // Host-controlled bridge values (from options.env, not the user's shell)
  'ZCLAUDIA_API_URL',
  'ZCLAUDIA_SESSION_ID',
] as const;

export interface ClaudeSdkEnvironmentInput {
  connection: RuntimeModelConnection;
  /** Session-scoped config directory; becomes the engine's CLAUDE_CONFIG_DIR. */
  configDirectory: string;
  /** Selected model — pinned to options.model and the auxiliary model aliases. */
  model?: string;
  /** Host-provided run env (bridge/file-push values); merged on top of the allowlist. */
  baseEnv?: Record<string, string>;
}

export function buildClaudeSdkEnvironment(
  input: ClaudeSdkEnvironmentInput
): Record<string, string> {
  const connectionEnv = toClaudeModelConnectionEnv(input.connection, input.model);

  const env: Record<string, string> = {};
  for (const key of SDK_ENVIRONMENT_ALLOWLIST) {
    // Run env is a small overlay (normally just bridge values), not a
    // replacement for the host's allowlisted OS/tooling environment.
    const value = input.baseEnv?.[key] ?? process.env[key];
    if (value !== undefined && value !== '') env[key] = value;
  }

  // Session-scoped configuration: transcripts, settings resolution and engine
  // state live here instead of the user's shared ~/.claude.
  env.CLAUDE_CONFIG_DIR = input.configDirectory;

  // Explicit connection. ANTHROPIC_AUTH_TOKEN / ANTHROPIC_OAUTH_TOKEN are NOT
  // set — API key auth only, so no inherited identity can win.
  env.ANTHROPIC_API_KEY = connectionEnv.apiKey;
  env.ANTHROPIC_BASE_URL = connectionEnv.baseUrl;
  if (connectionEnv.customHeaders) {
    env.ANTHROPIC_CUSTOM_HEADERS = connectionEnv.customHeaders;
  } else {
    // No headers means no inherited headers either — the allowlist above never
    // carried one in; delete defensively in case a base env supplied it.
    delete env.ANTHROPIC_CUSTOM_HEADERS;
  }

  // Keep auxiliary/alias model requests inside the selected connection.
  if (connectionEnv.model) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = connectionEnv.model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = connectionEnv.model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = connectionEnv.model;
  }

  return env;
}

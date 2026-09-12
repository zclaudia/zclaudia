import {
  appendFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  readFileSync,
  realpathSync,
} from 'fs';
import type { AppServerInputBlock } from './app-server-protocol.js';
export type { AppServerInputBlock } from './app-server-protocol.js';
import { join } from 'path';
import { homedir } from 'os';
import { agentConfigDirectory } from '@zclaudia/agent-common';
import type { ProviderToolBridgeEntry } from '@zclaudia/plugin-sdk/providers';
import { modeTransitionForPlanTool, planToolSemantic } from '@zclaudia/agent-common';

// ── Debug logging (opt-in, redacted) ─────────────────────────
//
// Off unless ZCLAUDIA_CODEX_DEBUG=1. When enabled, lines go to the console
// and to an owner-only (0600) file inside the zclaudia data directory —
// never to shared /tmp. Values registered as sensitive (MCP bridge env
// values, i.e. tokens/API keys passed as `-c mcp_servers.*.env.*` overrides)
// are scrubbed from every line as defense in depth.

const sensitiveLogValues = new Set<string>();

export function registerSensitiveLogValues(values: Iterable<string>): void {
  for (const value of values) {
    if (value) sensitiveLogValues.add(value);
  }
}

export function redactSensitiveValues(text: string): string {
  let result = text;
  for (const value of sensitiveLogValues) {
    result = result.split(value).join('[redacted]');
  }
  return result;
}

/** Key names of `-c key=value` override pairs, without any values. */
export function summarizeConfigArgKeys(args: string[]): string {
  const keys: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' && i + 1 < args.length) {
      keys.push(args[i + 1].split('=', 1)[0]);
      i++;
    }
  }
  return keys.join(', ');
}

export function isDebugLogEnabled(): boolean {
  return process.env.ZCLAUDIA_CODEX_DEBUG === '1';
}

export function debugLogPath(): string {
  return join(getCodexConfigDir(), 'debug.log');
}

export function debugLog(msg: string): void {
  if (!isDebugLogEnabled()) return;
  const redacted = redactSensitiveValues(msg);
  const line = `[${new Date().toISOString()}] ${redacted}\n`;
  try {
    mkdirSync(getCodexConfigDir(), { recursive: true });
    appendFileSync(debugLogPath(), line, { mode: 0o600 });
  } catch {
    /* ignore */
  }
  console.log(redacted);
}

// ── claudia-plugins MCP tool name normalization ─────────────
// Plan mode tools are registered as MCP tools (snake_case) but run-handler
// expects PascalCase names matching Claude SDK's native tools.
export const CLAUDIA_TOOL_NAME_MAP: Record<string, string> = {
  enter_plan_mode: 'EnterPlanMode',
  exit_plan_mode: 'ExitPlanMode',
};

export function normalizeClaudiaToolName(namespace: string | undefined, name: string): string {
  if (namespace === 'claudia-plugins') {
    const mapped = CLAUDIA_TOOL_NAME_MAP[name];
    if (mapped) return mapped;
  }
  return namespace ? `mcp:${namespace}:${name}` : name || 'Unknown';
}

// ── Codex AppServer plan-mode semantics ──────────────────────
//
// Plan-mode is routed through the claudia-plugins MCP bridge above, but the
// downstream runtime and UI should not know that. The codex AppServer SDK
// tags its outgoing tool_use messages with the shared `toolSemantic` and
// emits a `mode_transition` event for the runtime to consume.

export function detectCodexToolSemantic(
  toolName: string
): 'plan_enter' | 'plan_proposal' | undefined {
  return planToolSemantic(toolName);
}

export function deriveCodexModeTransition(
  toolName: string,
  input: unknown,
  sourceToolUseId: string | undefined
): { mode: string; reason: 'enter' | 'exit'; plan?: string; sourceToolUseId?: string } | undefined {
  return modeTransitionForPlanTool(toolName, input, sourceToolUseId);
}

// ── Mode → sandbox/approval config args ──────────────────────
//
// NOTE: `sandbox_permissions` via `-c` has no effect in app-server mode
// (sandbox is always workspaceWrite). Keep approval requests enabled for every
// mode and make the decision in handleServerRequest so dynamic mode switches
// (for example EnterPlanMode during a bypass run) take effect immediately.

export function mapModeToConfigArgs(mode?: string): string[] {
  const args: string[] = [];
  switch (mode) {
    case 'plan':
      // Keep on-request; our approval handler will decline all writes
      args.push('-c', 'approval_policy="on-request"');
      break;
    case 'bypassPermissions':
      // Keep requests enabled; our handler auto-approves while this mode is active.
      args.push('-c', 'approval_policy="on-request"');
      break;
    case 'acceptEdits':
    case 'default':
    default:
      // Standard mode: approval requests forwarded to user
      args.push('-c', 'approval_policy="on-request"');
      break;
  }
  return args;
}

// ── Input preparation (phase 1: text-only) ───────────────────

export function prepareAppServerInput(rawInput: string): AppServerInputBlock[] {
  return [{ type: 'text', text: rawInput, text_elements: [] }];
}

// ── Inherited provider env sanitization (inlined from server) ──

const INHERITED_PROVIDER_ENV_KEYS = [
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'MODEL',
  'CLAUDE_MODEL',
  'CLAUDE_CODE_MODEL',
  'CODEX_MODEL',
  'CURSOR_MODEL',
  'KIMI_MODEL',
  'MINIMAX_MODEL',
  'MOONSHOT_MODEL',
] as const;

function sanitizeInheritedProviderEnv(env: Record<string, string>): void {
  for (const key of INHERITED_PROVIDER_ENV_KEYS) {
    delete env[key];
  }
}

// ── MCP config via stable app data cwd ───────────────────────

export function getCodexConfigDir(): string {
  const dataDir = process.env.AGENT_RUNTIME_DATA_DIR
    ? join(process.env.AGENT_RUNTIME_DATA_DIR)
    : process.env.ZCLAUDIA_DATA_DIR
      ? join(process.env.ZCLAUDIA_DATA_DIR)
      : join(homedir(), '.zclaudia');
  return join(dataDir, 'codex-config');
}

export function mcpServersToToml(mcpServers: Record<string, unknown>): string {
  return Object.entries(mcpServers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, config]) => {
      const cfg = config as Record<string, unknown>;
      const lines: string[] = [`[mcp_servers.${name}]`];
      if (cfg.command) lines.push(`command = ${JSON.stringify(cfg.command)}`);
      if (cfg.args && Array.isArray(cfg.args)) {
        lines.push(`args = ${JSON.stringify(cfg.args)}`);
      }
      if (cfg.env && typeof cfg.env === 'object') {
        lines.push(`[mcp_servers.${name}.env]`);
        for (const [k, v] of Object.entries(cfg.env as Record<string, string>).sort(([a], [b]) =>
          a.localeCompare(b)
        )) {
          lines.push(`${k} = ${JSON.stringify(v)}`);
        }
      }
      if (cfg.url) lines.push(`url = ${JSON.stringify(cfg.url)}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

export function buildMcpConfigToml(bridge: ProviderToolBridgeEntry | null): string {
  if (!bridge) return '';
  return mcpServersToToml({ [bridge.name]: bridge.config });
}

/**
 * The injected MCP server as `-c mcp_servers.*` CLI overrides. The app-server
 * resolves the project-level `.codex/config.toml` from each thread's cwd, not
 * the process cwd, so threads running in the real project never see the config
 * written to the stable codex-config dir. CLI overrides apply to every thread
 * regardless of its cwd. Values are JSON-encoded strings/arrays, which are
 * also valid TOML for codex's override parser.
 */
export function buildMcpConfigArgs(bridge: ProviderToolBridgeEntry | null): string[] {
  if (!bridge) return [];
  const cfg = bridge.config as Record<string, unknown>;
  const prefix = `mcp_servers.${bridge.name}`;
  const args: string[] = [];
  if (cfg.command) args.push('-c', `${prefix}.command=${JSON.stringify(cfg.command)}`);
  if (cfg.args && Array.isArray(cfg.args)) {
    args.push('-c', `${prefix}.args=${JSON.stringify(cfg.args)}`);
  }
  if (cfg.env && typeof cfg.env === 'object') {
    for (const [key, value] of Object.entries(cfg.env as Record<string, string>).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      // env values are user-supplied credentials; keep them out of any log
      registerSensitiveLogValues([String(value), JSON.stringify(value)]);
      args.push('-c', `${prefix}.env.${key}=${JSON.stringify(value)}`);
    }
  }
  if (cfg.url) args.push('-c', `${prefix}.url=${JSON.stringify(cfg.url)}`);
  return args;
}

export function upsertTrustedProjectConfig(existing: string, projectPath: string): string {
  const header = `[projects.${JSON.stringify(projectPath)}]`;
  const sectionPattern = new RegExp(
    `(^|\\n)${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n(?:[^\\[][^\\n]*\\n?)*)?`,
    'm'
  );

  if (!sectionPattern.test(existing)) {
    const trimmed = existing.trimEnd();
    return `${trimmed ? `${trimmed}\n\n` : ''}${header}\ntrust_level = "trusted"\n`;
  }

  return existing.replace(sectionPattern, match => {
    if (/^\s*trust_level\s*=.*$/m.test(match)) {
      return match.replace(/^\s*trust_level\s*=.*$/m, 'trust_level = "trusted"');
    }
    return `${match.trimEnd()}\ntrust_level = "trusted"\n`;
  });
}

export function ensureCodexProjectTrusted(configDir: string): void {
  const userCodexConfigPath = join(agentConfigDirectory('codex'), 'config.toml');
  const trustPaths = new Set<string>([configDir]);

  try {
    trustPaths.add(realpathSync(configDir));
  } catch {
    // Best effort only; fall back to the original path.
  }

  let existing = '';
  if (existsSync(userCodexConfigPath)) {
    try {
      existing = readFileSync(userCodexConfigPath, 'utf-8');
    } catch (error) {
      debugLog(`[Codex AppServer] WARN: Failed to read user Codex config: ${error}`);
      return;
    }
  } else {
    mkdirSync(agentConfigDirectory('codex'), { recursive: true });
  }

  let next = existing;
  for (const trustPath of trustPaths) {
    next = upsertTrustedProjectConfig(next, trustPath);
  }

  if (next !== existing) {
    try {
      writeFileSync(userCodexConfigPath, next, 'utf-8');
      debugLog(
        `[Codex AppServer] Trusted project for config loading: ${Array.from(trustPaths).join(', ')}`
      );
    } catch (error) {
      debugLog(`[Codex AppServer] WARN: Failed to update user Codex trust config: ${error}`);
    }
  }
}

/** Last written config content — skip redundant writes */
let lastWrittenConfig = '';

export function writeMcpConfig(bridge: ProviderToolBridgeEntry | null): {
  configDir: string;
  configSignature: string;
} {
  const configDir = getCodexConfigDir();
  try {
    mkdirSync(configDir, { recursive: true });
    // A bridge-less standalone run has no generated project config to load,
    // so it must not modify the user's global Codex trust settings.
    if (bridge) ensureCodexProjectTrusted(configDir);
    const configToml = buildMcpConfigToml(bridge);

    if (configToml !== lastWrittenConfig) {
      const codexDir = join(configDir, '.codex');
      mkdirSync(codexDir, { recursive: true });
      const configPath = join(codexDir, 'config.toml');

      if (configToml) {
        writeFileSync(configPath, configToml, 'utf-8');
        debugLog(`[Codex AppServer] Wrote MCP config: ${configPath}`);
      } else if (existsSync(configPath)) {
        unlinkSync(configPath);
        debugLog(`[Codex AppServer] Removed MCP config: ${configPath}`);
      }
      lastWrittenConfig = configToml;
    }

    return { configDir, configSignature: configToml };
  } catch (error) {
    debugLog(`[Codex AppServer] WARN: Failed to write MCP config: ${error}`);
    return { configDir, configSignature: '' };
  }
}

export function buildEnv(options: {
  env?: Record<string, string>;
  claudiaSessionId?: string;
}): Record<string, string> {
  const mergedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) mergedEnv[key] = value;
  }
  sanitizeInheritedProviderEnv(mergedEnv);
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      mergedEnv[key] = value;
    }
  }
  if (options.claudiaSessionId) {
    mergedEnv.CLAUDIA_SESSION_ID = options.claudiaSessionId;
    mergedEnv.ZCLAUDIA_SESSION_ID = options.claudiaSessionId;
  }
  return mergedEnv;
}

// ── SDK engine mode (design: codex dual-mode §6) ─────────────
//
// SDK mode runs the app-bundled Codex engine with a per-session CODEX_HOME and
// an explicit OpenAI-Responses connection from a bound LLM profile. The user's
// Codex installation, login and global config must not participate: the final
// process environment is built from an allowlist (never merged with
// process.env), and the connection is locked through a dedicated TOML
// provider plus highest-priority `-c` overrides.

import type { RuntimeModelConnection } from '@zclaudia/plugin-sdk/providers';
import { RuntimeContractError } from '@zclaudia/plugin-sdk/providers';

/** Dedicated TOML provider id — never overrides the official built-in `openai`. */
export const CODEX_SDK_PROVIDER_ID = 'zclaudia_profile';

/** Env var that carries the profile API key into the engine process only. */
export const CODEX_SDK_API_KEY_ENV = 'ZCLAUDIA_CODEX_API_KEY';

/** Keys an SDK run keeps from the host process: shell execution, locale, proxy/cert handling. */
const CODEX_SDK_ENVIRONMENT_ALLOWLIST = [
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
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
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
  'ZCLAUDIA_API_URL',
  'ZCLAUDIA_SESSION_ID',
] as const;

function headerEnvVarName(name: string): string {
  const normalized = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
  if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) {
    throw new RuntimeContractError(
      'LLM_OPTION_UNSUPPORTED',
      `requestHeaders name "${name}" cannot be mapped to an environment variable`
    );
  }
  return `ZCLAUDIA_CODEX_HEADER_${normalized}`;
}

export interface CodexSdkEnvironmentInput {
  connection: RuntimeModelConnection;
  /** Session-scoped CODEX_HOME prepared by the host/plugin. */
  codexHome: string;
  claudiaSessionId?: string;
  /** Host-provided run env (bridge/file-push values). */
  baseEnv?: Record<string, string>;
}

/**
 * Build the complete environment for an SDK engine process. Throws on a
 * non-Responses connection: the Codex SDK mode accepts nothing else.
 */
export function buildCodexSdkEnvironment(input: CodexSdkEnvironmentInput): Record<string, string> {
  if (input.connection.protocol !== 'openai-responses') {
    throw new RuntimeContractError(
      'RUNTIME_PROTOCOL_UNSUPPORTED',
      `Codex SDK accepts only the openai-responses protocol (got "${input.connection.protocol}")`
    );
  }
  if (!input.connection.apiKey?.trim()) {
    throw new RuntimeContractError('LLM_AUTH_UNSUPPORTED', 'The model connection has no API key');
  }

  const env: Record<string, string> = {};
  for (const key of CODEX_SDK_ENVIRONMENT_ALLOWLIST) {
    const value = input.baseEnv?.[key] ?? process.env[key];
    if (value !== undefined && value !== '') env[key] = value;
  }

  env.CODEX_HOME = input.codexHome;
  // Auth material lives only in the child process environment — never in TOML,
  // argv, or auth.json. Header values ride dedicated env vars referenced from
  // TOML via env_http_headers (variable names only, values never serialized).
  env[CODEX_SDK_API_KEY_ENV] = input.connection.apiKey;
  for (const [name, value] of Object.entries(input.connection.requestHeaders ?? {})) {
    env[headerEnvVarName(name)] = value;
  }

  if (input.claudiaSessionId) {
    env.CLAUDIA_SESSION_ID = input.claudiaSessionId;
    env.ZCLAUDIA_SESSION_ID = input.claudiaSessionId;
  }
  return env;
}

/** Header variable names referenced by env_http_headers (names only, no values). */
export function sdkHeaderEnvVarNames(connection: RuntimeModelConnection): string[] {
  return Object.keys(connection.requestHeaders ?? {}).map(headerEnvVarName);
}

function tomlString(value: string): string {
  // Basic TOML string: escape backslashes and quotes; control characters are
  // rejected upstream by the host header validation.
  return JSON.stringify(value);
}

function sdkHeaderTable(connection: RuntimeModelConnection): string {
  const entries = Object.keys(connection.requestHeaders ?? {}).map(
    name => `${tomlString(name)} = ${tomlString(headerEnvVarName(name))}`
  );
  return `{ ${entries.join(', ')} }`;
}

export interface CodexSdkConfigInput {
  connection: RuntimeModelConnection;
  model: string;
}

/**
 * The config.toml written into the session CODEX_HOME. It selects the
 * dedicated provider and pins the model; the same values are ALSO passed as
 * `-c` overrides (higher priority than file layers) so project-level config
 * cannot re-route the connection. API keys are never written here.
 */
export function buildSdkConfigToml(input: CodexSdkConfigInput): string {
  const lines = [
    '# Generated by the ZClaudia Codex plugin for a single SDK session.',
    '# Connection credentials are provided via process environment only.',
    `model = ${tomlString(input.model)}`,
    `model_provider = ${tomlString(CODEX_SDK_PROVIDER_ID)}`,
    '',
    `[model_providers.${CODEX_SDK_PROVIDER_ID}]`,
    `name = ${tomlString('ZClaudia LLM Profile')}`,
    `base_url = ${tomlString(input.connection.baseUrl)}`,
    'wire_api = "responses"',
    `env_key = ${tomlString(CODEX_SDK_API_KEY_ENV)}`,
    'requires_openai_auth = false',
    'supports_websockets = false',
  ];
  lines.push(`env_http_headers = ${sdkHeaderTable(input.connection)}`);
  return lines.join('\n') + '\n';
}

/**
 * Highest-priority `-c` overrides locking provider, model and transport for
 * both thread/start and thread/resume. Values are TOML-serialized.
 */
export function buildSdkConfigArgs(input: CodexSdkConfigInput): string[] {
  const args: string[] = [];
  args.push('-c', `model_provider=${tomlString(CODEX_SDK_PROVIDER_ID)}`);
  args.push('-c', `model=${tomlString(input.model)}`);
  const providerPrefix = `model_providers.${CODEX_SDK_PROVIDER_ID}`;
  // P0 finding (codex 0.154.0): `-c` provider overrides must carry EVERY
  // required field — the engine validates the merged provider table and a
  // partial table (e.g. missing `name`) fails config load outright.
  args.push('-c', `${providerPrefix}.name=${tomlString('ZClaudia LLM Profile')}`);
  args.push('-c', `${providerPrefix}.base_url=${tomlString(input.connection.baseUrl)}`);
  args.push('-c', `${providerPrefix}.wire_api="responses"`);
  args.push('-c', `${providerPrefix}.env_key=${tomlString(CODEX_SDK_API_KEY_ENV)}`);
  args.push('-c', `${providerPrefix}.requires_openai_auth=false`);
  args.push('-c', `${providerPrefix}.supports_websockets=false`);
  args.push('-c', `${providerPrefix}.env_http_headers=${sdkHeaderTable(input.connection)}`);
  return args;
}

interface SdkWriteCacheEntry {
  toml: string;
}
const sdkConfigWriteCache = new Map<string, SdkWriteCacheEntry>();

/**
 * Write config.toml into the session CODEX_HOME with atomic replace. The
 * cache key includes the target directory — unlike the legacy shared-config
 * lastWrittenConfig, one backend's directory can never satisfy another's.
 */
export function writeSdkConfig(codexHome: string, toml: string): void {
  if (
    sdkConfigWriteCache.get(codexHome)?.toml === toml &&
    existsSync(join(codexHome, 'config.toml'))
  )
    return;
  const codexDir = codexHome;
  mkdirSync(codexDir, { recursive: true, mode: 0o700 });
  const configPath = join(codexDir, 'config.toml');
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, toml, { mode: 0o600 });
  // Atomic replace: a crash mid-write never leaves a truncated config behind.
  renameSync(tempPath, configPath);
  sdkConfigWriteCache.set(codexHome, { toml });
}

export function resetSdkConfigWriteCacheForTests(): void {
  sdkConfigWriteCache.clear();
}

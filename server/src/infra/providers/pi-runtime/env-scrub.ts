/**
 * Environment scrubbing for Bash child processes (sandboxed and not).
 *
 * DEFAULT POLICY: pass the parent environment through EXCEPT variables that
 * look like secrets. A strict allowlist would break ordinary dev workflows
 * (nvm, homebrew, proxy setups, language toolchains all rely on arbitrary
 * env), so instead we filter names that match SECRET_ENV_NAME_PATTERN or are
 * listed in KNOWN_SECRET_ENV_VARS. Without this, `echo $AWS_SECRET_ACCESS_KEY`
 * leaks credentials into tool output, and the sandbox network allow-list
 * turns that into an exfiltration channel.
 *
 * A name is kept when any of these holds (first match wins):
 *   1. it is in ENV_BASE_ALLOWLIST or starts with an ENV_BASE_ALLOWLIST_PREFIXES
 *      entry (safe names, including ones that would trip the secret pattern,
 *      e.g. SSH_AUTH_SOCK);
 *   2. it does NOT look like a secret;
 *   3. the operator explicitly opted it back in via the
 *      ZCLAUDIA_BASH_ENV_PASSTHROUGH="FOO,BAR" escape hatch.
 * Caller-supplied `extraEnv` (runBash option) is applied AFTER scrubbing and
 * always wins — passing a var explicitly is an intentional act.
 *
 * This is a leak-reduction layer, not a hard boundary: filesystem reads of
 * credential files are blocked separately by the sandbox denyRead list and
 * the sensitive-path guard in bash-guards.ts.
 */

/**
 * Names matching this pattern are treated as secrets. Deliberately broad
 * (UX/approval-layer broad, not security-critical): TOKEN, SECRET, PASSWORD,
 * PASSWD, CREDENTIAL(S), API_KEY / APIKEY / API-KEY, PRIVATE_KEY,
 * ACCESS_KEY, and AUTH as a path segment.
 */
export const SECRET_ENV_NAME_PATTERN =
  /(?:_|^)(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AUTH)(?:_|$)/i;

/** Explicit known-secret names (discoverability; most also match the pattern). */
export const KNOWN_SECRET_ENV_VARS: ReadonlySet<string> = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'MOONSHOT_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'NPM_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AZURE_CLIENT_SECRET',
  'DOCKER_PASSWORD',
]);

/**
 * Clearly-safe names that are ALWAYS kept, even when they would match the
 * secret pattern (SSH_AUTH_SOCK is the notable one).
 */
export const ENV_BASE_ALLOWLIST: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'LANG',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SSH_AUTH_SOCK',
  'DISPLAY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
]);

/** Safe prefixes: locale, XDG dirs, and zclaudia's own config knobs. */
export const ENV_BASE_ALLOWLIST_PREFIXES: readonly string[] = ['LC_', 'XDG_', 'ZCLAUDIA_'];

/** Operator escape hatch: comma-separated names to keep even when secret-looking. */
export const ENV_PASSTHROUGH_KNOB = 'ZCLAUDIA_BASH_ENV_PASSTHROUGH';

export function isSecretEnvName(name: string): boolean {
  if (ENV_BASE_ALLOWLIST.has(name)) return false;
  if (ENV_BASE_ALLOWLIST_PREFIXES.some(prefix => name.startsWith(prefix))) return false;
  return KNOWN_SECRET_ENV_VARS.has(name) || SECRET_ENV_NAME_PATTERN.test(name);
}

function passthroughNames(): ReadonlySet<string> {
  const raw = process.env[ENV_PASSTHROUGH_KNOB];
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)
  );
}

/**
 * Return a scrubbed copy of `env`: secret-looking names removed (except
 * allowlisted / operator-passthrough names). `extraEnv` is merged last and
 * always wins, since an explicit caller-provided var is an intentional act.
 */
export function scrubEnv(
  env: NodeJS.ProcessEnv,
  extraEnv?: Record<string, string>
): NodeJS.ProcessEnv {
  const passthrough = passthroughNames();
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (!passthrough.has(key) && isSecretEnvName(key)) continue;
    out[key] = value;
  }
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) out[key] = value;
  }
  return out;
}

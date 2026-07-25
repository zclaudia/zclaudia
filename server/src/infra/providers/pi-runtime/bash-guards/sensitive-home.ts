/**
 * Sensitive home-path detection for the bash guards.
 *
 * SINGLE SOURCE OF TRUTH: every sensitive target is declared once in
 * {@link SENSITIVE_HOME_SPEC} as `{ literal, kind }`. The regex view
 * ({@link SENSITIVE_HOME_PATHS}) and the literal-prefix view
 * ({@link SENSITIVE_HOME_LITERALS}) used by the obfuscation check are both
 * derived from it — adding a path means editing one entry, not two
 * hand-synchronized lists (the previous setup kept `SENSITIVE_HOME_PATHS` as
 * regexes and `SENSITIVE_HOME_LITERALS` as strings and required editing both).
 *
 * `kind` selects the anchor: `directory` matches the literal as a path prefix
 * (`~/.ssh` also covers `~/.ssh/config`), `file` matches it exactly
 * (`~/.aws/credentials` does not cover `~/.aws/credentials.d/`).
 *
 * {@link SENSITIVE_HOME_ALLOW_BACK} is kept separate on purpose: those paths
 * are NOT sensitive, they just need to override a future broadened PATHS entry
 * (defensive — currently none of them is actually matched, but the override is
 * cheap and keeps intent explicit).
 *
 * HONEST SCOPE (see bash-guards.ts header): this is a UX / approval layer,
 * not a security boundary — pattern matching is always evadable; the sandbox
 * and the human approval prompt are the real isolation.
 */

/** Escape a literal so it can be embedded in a RegExp matching it verbatim. */
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the matching regex for a spec entry. Directory entries anchor as a
 * prefix (the literal or anything below it); file entries anchor exactly.
 */
function regexForSpec(entry: SensitiveHomeSpecEntry): RegExp {
  const escaped = escapeRegex(entry.literal);
  return entry.kind === 'directory' ? new RegExp(`^${escaped}(?:/|$)`) : new RegExp(`^${escaped}$`);
}

export type SensitiveHomeKind = 'directory' | 'file';

export interface SensitiveHomeSpecEntry {
  /** Canonical `~/...` form, also consumed by the literal-prefix check. */
  literal: string;
  kind: SensitiveHomeKind;
}

/**
 * The single declaration of every sensitive home target. Order is not
 * significant for correctness; {@link isSensitiveHomePath} short-circuits on
 * the first PATHS hit after consulting the allowBack list.
 *
 * NOTE: the legacy regex table merged the three shell-history files into one
 * alternation and the two browser-library roots into another. Declaring each
 * as its own entry is functionally equivalent (the check runs once per command)
 * and is what lets the literal list be derived from the same source.
 */
export const SENSITIVE_HOME_SPEC: readonly SensitiveHomeSpecEntry[] = [
  { literal: '~/.ssh', kind: 'directory' },
  { literal: '~/.gnupg', kind: 'directory' },
  { literal: '~/.aws/credentials', kind: 'file' },
  { literal: '~/.config/gcloud', kind: 'directory' },
  { literal: '~/.azure', kind: 'directory' },
  { literal: '~/.docker/config.json', kind: 'file' },
  { literal: '~/.kube/config', kind: 'file' },
  { literal: '~/.config/gh/hosts.yml', kind: 'file' },
  { literal: '~/.npmrc', kind: 'file' },
  { literal: '~/.pypirc', kind: 'file' },
  { literal: '~/.cargo/credentials.toml', kind: 'file' },
  { literal: '~/.netrc', kind: 'file' },
  { literal: '~/.vault-token', kind: 'file' },
  { literal: '~/.terraformrc', kind: 'file' },
  { literal: '~/.bash_history', kind: 'file' },
  { literal: '~/.zsh_history', kind: 'file' },
  { literal: '~/.zhistory', kind: 'file' },
  { literal: '~/Library/Safari', kind: 'directory' },
  { literal: '~/Library/Application Support/Google/Chrome', kind: 'directory' },
  { literal: '~/Library/Application Support/Firefox/Profiles', kind: 'directory' },
];

/**
 * Regex view of {@link SENSITIVE_HOME_SPEC} — the per-entry matchers used by
 * the direct path check. Derived, never hand-edited.
 */
export const SENSITIVE_HOME_PATHS: readonly RegExp[] = SENSITIVE_HOME_SPEC.map(regexForSpec);

/**
 * Literal-prefix view of {@link SENSITIVE_HOME_SPEC} — used by the glob /
 * command-substitution evasion check, which cannot use the regexes. Derived,
 * never hand-edited.
 */
export const SENSITIVE_HOME_LITERALS: readonly string[] = SENSITIVE_HOME_SPEC.map(
  entry => entry.literal
);

/**
 * Paths that, even if a future broadened PATHS entry matches them, must never
 * be flagged — public SSH material and non-secret provider config. Currently
 * none of these is actually matched by {@link SENSITIVE_HOME_PATHS}; the list
 * is retained as explicit, defensive intent. Kept as a standalone list (not
 * derived from the spec) because it describes non-sensitive paths, which do
 * not belong in the sensitive-target spec.
 */
export const SENSITIVE_HOME_ALLOW_BACK: readonly RegExp[] = [
  /^~\/\.ssh\/(?:config|known_hosts|known_hosts\.old)$/,
  /^~\/\.ssh\/[^/]+\.pub$/,
  /^~\/\.aws\/config$/,
  /^~\/\.config\/gh\/config\.yml$/,
];

/**
 * True iff a normalized `~/...` path is sensitive. The allowBack list is
 * consulted first, so a whitelisted sub-path is never flagged even if a
 * sensitive entry happens to match it too.
 */
export function isSensitiveHomePath(normalized: string): boolean {
  if (SENSITIVE_HOME_ALLOW_BACK.some(pattern => pattern.test(normalized))) return false;
  return SENSITIVE_HOME_PATHS.some(pattern => pattern.test(normalized));
}

/**
 * Glob / command-substitution evasion check. A candidate containing `*?[]`
 * can't be resolved statically, so treat it as sensitive when its literal
 * prefix (up to the first metacharacter) overlaps a sensitive path and is
 * long enough to be meaningful (`~/.s` minimum). A `$(...)` substitution
 * directly under a hidden home dot-dir (`~/.$(...)`) is never verifiable —
 * always treat as sensitive. Both cases are UX-layer judgments: they block
 * with a clear reason rather than pretending the path was resolved.
 */
export function isObfuscatedSensitiveHomePath(candidate: string): boolean {
  if (candidate.includes('$(')) return candidate.startsWith('~/.');
  if (!/[*?[\]]/.test(candidate)) return false;
  const literalPrefix = candidate.split(/[*?[\]]/, 1)[0];
  if (literalPrefix.length < 4) return false;
  return SENSITIVE_HOME_LITERALS.some(
    literal => literal.startsWith(literalPrefix) || literalPrefix.startsWith(`${literal}/`)
  );
}

/**
 * Static pattern tables for the bash guards: critical-command signatures and
 * the path-classification regexes reused across the routing / file-bypass /
 * sensitive-path checks.
 *
 * HONEST SCOPE (see bash-guards.ts header): these power a UX / approval layer,
 * not a security boundary. Matching is biased toward false positives (which
 * only cost an approval prompt) over false negatives (which would run
 * unattended). New critical patterns should target shapes that are virtually
 * never legitimate in automation.
 */

export interface CriticalBashPatternEntry {
  pattern: RegExp;
  reason: string;
}

export const CRITICAL_BASH_PATTERNS: ReadonlyArray<CriticalBashPatternEntry> = [
  // Recursive destruction.
  { pattern: /\brm\s+-[a-z]*[rRfF][a-z]*\s+\//i, reason: 'recursive delete of a root-level path' },
  { pattern: /\bsudo\s+rm\b/i, reason: 'privileged file deletion (sudo rm)' },
  {
    pattern: /\bchmod\s+-R\s+[0-7]+\s+\//i,
    reason: 'recursive permission change on a root-level path',
  },
  {
    pattern: /\bchmod\s+-R\s+[ugoa+\-=rwxXst,]+\s+\//,
    reason: 'recursive permission change on a root-level path',
  },
  {
    pattern: /\bchown\s+-R\s+\S+\s+\//i,
    reason: 'recursive ownership change on a root-level path',
  },

  // Fork bomb (a few common spacings).
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:/i, reason: 'fork bomb' },

  // Disk / filesystem destruction.
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: 'write to a raw disk device' },
  // Anchored to command position so `grep "mkfs" docs/` doesn't false-positive.
  { pattern: /(?:^|[\s;&|(])mkfs(?:\.\w+)?\b/i, reason: 'filesystem format (mkfs)' },
  { pattern: /\bdd\s+if=.+of=\/dev\//i, reason: 'dd to a device' },
  { pattern: /\bshred\s+\/dev\//i, reason: 'shred a device' },
  { pattern: /\bcryptsetup\b/i, reason: 'disk encryption manipulation (cryptsetup)' },

  // System-config destruction.
  { pattern: />\s*\/etc\/(?:passwd|shadow|sudoers)\b/i, reason: 'overwrite of a system auth file' },
  {
    pattern: /\btee\s+(?:-a\s+)?\/etc\/(?:passwd|shadow|sudoers)\b/i,
    reason: 'overwrite of a system auth file',
  },

  // Remote-fetch-then-execute (curl/wget piped to a shell or process-subbed).
  {
    pattern: /\b(?:curl|wget|fetch)\b[^|]*\|\s*(?:bash|sh|zsh|fish)\b/i,
    reason: 'remote fetch piped into a shell (fetch-then-execute)',
  },
  // Process-sub variants — `bash <(curl …)`, `source <(curl …)`, `. <(curl …)`. `.` and `source` are
  // anchored to a command boundary so `find . -name` and similar don't false-positive.
  {
    pattern: /(?:^|[\s;&|(])(?:bash|sh|zsh|source|\.)\s+<\(\s*(?:curl|wget|fetch)\b/i,
    reason: 'remote fetch executed via process substitution (fetch-then-execute)',
  },
  // `eval "$(curl …)"` / `eval $(curl …)` / `eval \`curl …\``.
  {
    pattern: /\beval\s+["'`]?\$\(\s*(?:curl|wget|fetch)\b|\beval\s+`\s*(?:curl|wget|fetch)\b/i,
    reason: 'remote fetch evaluated as code (fetch-then-execute)',
  },

  // Process/host control.
  { pattern: /\bkill\s+(?:-\S+\s+)?1\b/, reason: 'kill of PID 1' },
  // Must sit at command position so `npm run reboot-tests` or `echo 'shutdown the queue'`
  // don't false-positive.
  {
    pattern: /(?:^|[\s;&|(])(?:shutdown|poweroff|reboot|halt)(?:\s|$|[;|&])/i,
    reason: 'host shutdown or reboot',
  },
  { pattern: /(?:^|[\s;&|(])init\s+0\b/i, reason: 'host shutdown (init 0)' },

  // Network-shell exfil. The flag may glue directly to its payload
  // (`nc -c/bin/sh`) as well as sit before a space (`nc -e /bin/sh`).
  {
    pattern: /\bnc\b[^|;]*\s-[a-zA-Z]*[ec][a-zA-Z]*(?:[\s/=]|$)/i,
    reason: 'netcat with command execution (reverse shell)',
  },

  // Obfuscated execution: decode-then-run (`echo cm0gLXJmIC8K | base64 -d | bash`).
  {
    pattern: /\bbase64\s+(?:-[a-zA-Z]*[dD][a-zA-Z]*|--decode)\b[^|]*\|\s*(?:bash|sh|zsh|fish)\b/i,
    reason: 'base64-decoded payload piped into a shell (obfuscated execution)',
  },
];

/** Source / config file extensions and well-known project root filenames. */
export const SOURCE_OR_CONFIG_PATH =
  /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|AGENTS\.md|README\.md|[.\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|yaml|yml|toml|css|scss|html|rs|go|py|java|kt|c|cc|cpp|h|hpp|sh|sql|txt))$/i;

/** Generated / temp directories that are safe to treat as non-source. */
export const GENERATED_OR_TEMP_PATH =
  /(?:^|\/)(?:node_modules|dist|build|coverage|target|\.next|\.turbo|\.cache|tmp|temp|logs?)(?:\/|$)/i;

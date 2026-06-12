/**
 * Critical Bash command patterns — a second gate alongside the sandbox.
 *
 * Kept intentionally tight: the cost of a false negative is data loss or a
 * compromised host, while false positives remain actionable through the
 * permission escalation channel. New patterns should target shapes that are
 * virtually never legitimate in automation.
 */

/** Permission-callback tool name for critical-command escalation. */
export const CRITICAL_BASH_APPROVAL_TOOL = 'CriticalBashCommand';

export interface CriticalBashMatch {
  reason: string;
}

const CRITICAL_BASH_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  // Recursive destruction.
  { pattern: /\brm\s+-[a-z]*[rRfF][a-z]*\s+\//i, reason: 'recursive delete of a root-level path' },
  { pattern: /\bsudo\s+rm\b/i, reason: 'privileged file deletion (sudo rm)' },
  { pattern: /\bchmod\s+-R\s+[0-7]+\s+\//i, reason: 'recursive permission change on a root-level path' },
  { pattern: /\bchmod\s+-R\s+[ugoa+\-=rwxXst,]+\s+\//, reason: 'recursive permission change on a root-level path' },
  { pattern: /\bchown\s+-R\s+\S+\s+\//i, reason: 'recursive ownership change on a root-level path' },

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
  { pattern: /\btee\s+(?:-a\s+)?\/etc\/(?:passwd|shadow|sudoers)\b/i, reason: 'overwrite of a system auth file' },

  // Remote-fetch-then-execute (curl/wget piped to a shell or process-subbed).
  { pattern: /\b(?:curl|wget|fetch)\b[^|]*\|\s*(?:bash|sh|zsh|fish)\b/i, reason: 'remote fetch piped into a shell (fetch-then-execute)' },
  // Process-sub variants — `bash <(curl …)`, `source <(curl …)`, `. <(curl …)`. `.` and `source` are
  // anchored to a command boundary so `find . -name` and similar don't false-positive.
  { pattern: /(?:^|[\s;&|(])(?:bash|sh|zsh|source|\.)\s+<\(\s*(?:curl|wget|fetch)\b/i, reason: 'remote fetch executed via process substitution (fetch-then-execute)' },
  // `eval "$(curl …)"` / `eval $(curl …)` / `eval \`curl …\``.
  { pattern: /\beval\s+["'`]?\$\(\s*(?:curl|wget|fetch)\b|\beval\s+`\s*(?:curl|wget|fetch)\b/i, reason: 'remote fetch evaluated as code (fetch-then-execute)' },

  // Process/host control.
  { pattern: /\bkill\s+(?:-\S+\s+)?1\b/, reason: 'kill of PID 1' },
  // Must sit at command position so `npm run reboot-tests` or `echo 'shutdown the queue'`
  // don't false-positive.
  { pattern: /(?:^|[\s;&|(])(?:shutdown|poweroff|reboot|halt)(?:\s|$|[;|&])/i, reason: 'host shutdown or reboot' },
  { pattern: /(?:^|[\s;&|(])init\s+0\b/i, reason: 'host shutdown (init 0)' },

  // Network-shell exfil.
  { pattern: /\bnc\b[^|;]*\s-[a-zA-Z]*[ec][a-zA-Z]*\s/i, reason: 'netcat with command execution (reverse shell)' },
];

export function findCriticalBashPattern(command: string): CriticalBashMatch | undefined {
  for (const { pattern, reason } of CRITICAL_BASH_PATTERNS) {
    if (pattern.test(command)) return { reason };
  }
  return undefined;
}

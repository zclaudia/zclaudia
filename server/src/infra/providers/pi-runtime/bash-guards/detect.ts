/**
 * Top-level guard detectors: critical-command matching and sensitive home-path
 * access. Both combine the pattern tables (patterns.ts) / sensitive-path
 * tables (sensitive-home.ts) with the normalization layer (normalize.ts).
 *
 * See bash-guards.ts header for the honest scope.
 */

import * as os from 'os';
import { CRITICAL_BASH_PATTERNS } from './patterns.js';
import { isObfuscatedSensitiveHomePath, isSensitiveHomePath } from './sensitive-home.js';
import {
  expandAssignedVariables,
  normalizeBashCommandForMatch,
  normalizeHomePath,
  shellWords,
} from './normalize.js';

/** Permission-callback tool name for critical-command escalation. */
export const CRITICAL_BASH_APPROVAL_TOOL = 'CriticalBashCommand';

export interface CriticalBashMatch {
  reason: string;
}

export interface BashSensitivePathMatch {
  path: string;
  reason: string;
}

export function findCriticalBashPattern(command: string): CriticalBashMatch | undefined {
  // Match the raw command, its normalized form (quote-stripped, split flags
  // merged, `--` collapsed), and the variable-expanded forms so cheap
  // obfuscation — `rm -r -f /`, `r"m" -rf /`, `rm -rf -- /`, `K=/; rm -rf $K`
  // — does not slip through.
  const normalized = normalizeBashCommandForMatch(command);
  const expanded = expandAssignedVariables(command);
  const expandedNormalized =
    expanded === command ? expanded : normalizeBashCommandForMatch(expanded);
  const candidates = new Set([command, normalized, expanded, expandedNormalized]);
  for (const { pattern, reason } of CRITICAL_BASH_PATTERNS) {
    for (const candidate of candidates) {
      if (pattern.test(candidate)) return { reason };
    }
  }
  return undefined;
}

export function findBashSensitivePathAccess(command: string): BashSensitivePathMatch | undefined {
  const scan = (input: string): BashSensitivePathMatch | undefined => {
    const pathPattern =
      /(~\/(?:[^"'\s;&|)\\]+|Library\/(?:Safari|Application Support\/(?:Google\/Chrome|Firefox\/Profiles))(?:\/[^"'\s;&|)\\]*)?)|\$HOME\/[^"'\s;&|)\\]+|\$\{HOME\}\/[^"'\s;&|)\\]+)/g;
    // os.homedir() (not process.env.HOME): consistent with bash-tool.ts; on
    // POSIX os.homedir() honors $HOME, so tests overriding HOME still work.
    const home = os.homedir().replace(/\/+$/, '');
    const absoluteHomePattern = home
      ? new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/[^"'\\s;&|)\\\\]+`, 'g')
      : undefined;
    for (const pattern of [pathPattern, absoluteHomePattern].filter((value): value is RegExp =>
      Boolean(value)
    )) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(input))) {
        const candidate = normalizeHomePath(match[0]);
        if (isSensitiveHomePath(candidate) || isObfuscatedSensitiveHomePath(candidate)) {
          return {
            path: candidate,
            reason: `Bash command accesses sensitive home path ${candidate}`,
          };
        }
      }
    }

    // `cd ~ && cat .ssh/id_rsa` style: paths relative to a home `cd` still
    // count. Scan words in the segments following `cd ~` / `cd $HOME` /
    // `cd ${HOME}` (up to the next `cd`) as if prefixed with `~/`.
    const cdHomePattern = /(?:^|[;&|])\s*cd\s+(?:~|\$HOME|\$\{HOME\})(?=\s|&&|;|$)/g;
    let cdMatch: RegExpExecArray | null;
    while ((cdMatch = cdHomePattern.exec(input))) {
      const rest = input.slice(cdMatch.index + cdMatch[0].length);
      const nextCd = rest.slice(1).search(/[;&|]\s*cd\s/);
      const scope = nextCd === -1 ? rest : rest.slice(0, nextCd + 1);
      for (const segment of scope.split(/&&|\|\||[;|]/)) {
        const words = shellWords(segment);
        for (const word of words.slice(1)) {
          if (word.startsWith('-')) continue;
          const candidate = normalizeHomePath(`~/${word}`);
          if (isSensitiveHomePath(candidate) || isObfuscatedSensitiveHomePath(candidate)) {
            return {
              path: candidate,
              reason: `Bash command accesses sensitive home path ${candidate} (relative to cd ~)`,
            };
          }
        }
      }
    }
    return undefined;
  };

  const direct = scan(command);
  if (direct) return direct;
  // Variable indirection (`K=ssh; cat ~/.$K/id_rsa`): the assigned value may
  // spell a sensitive path, so re-scan the expanded form too.
  const expanded = expandAssignedVariables(command);
  return expanded === command ? undefined : scan(expanded);
}

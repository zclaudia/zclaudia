/**
 * Critical Bash command patterns — a second gate alongside the sandbox.
 *
 * HONEST SCOPE: this guard is a UX / approval layer, NOT a security boundary.
 * Pattern matching can always be evaded by sufficiently creative obfuscation;
 * the actual isolation comes from the sandbox (denyRead lists, network
 * allow-list) and from the human approval prompt that critical matches route
 * through. Matching is deliberately biased toward false positives (which only
 * cost an approval prompt) over false negatives (which would run unattended).
 * Before matching, commands go through a normalization layer (quote
 * stripping, split-flag merging, `--` collapsing — see
 * normalizeBashCommandForMatch) that closes the cheap, verified bypasses.
 *
 * New patterns should target shapes that are virtually never legitimate in
 * automation, keeping the approval-prompt cost of a false positive low.
 *
 * This module is the public barrel for the bash-guards subsystem. The
 * implementation is split into focused modules under ./bash-guards/:
 *   - patterns.ts       static pattern tables (critical commands, path classes)
 *   - normalize.ts      shell word splitting, quote stripping, home normalization
 *   - sensitive-home.ts sensitive home-path table (single source of truth) + checks
 *   - routing.ts        LS/Glob/Grep/Read/Edit/Write steering + file-bypass detection
 *   - detect.ts         top-level critical-pattern and sensitive-path detectors
 *
 * Public surface is re-exported unchanged so external callers (bash-tool,
 * eval-tool, tests) keep importing from './bash-guards.js'.
 */

export {
  CRITICAL_BASH_APPROVAL_TOOL,
  findCriticalBashPattern,
  findBashSensitivePathAccess,
  type CriticalBashMatch,
  type BashSensitivePathMatch,
} from './bash-guards/detect.js';

export {
  findBashToolRoutingSuggestion,
  findBashFileBypass,
  type BashToolRoutingSuggestion,
  type BashFileBypassMatch,
  type BashFileBypassKind,
} from './bash-guards/routing.js';

export { normalizeBashCommandForMatch } from './bash-guards/normalize.js';

/**
 * Provable read-only bash classification.
 *
 * `isProvablyReadOnlyBashCommand` returns true only when every simple
 * command in the line is statically known not to write to the filesystem,
 * change the environment, or run arbitrary code. Unknown programs, dynamic
 * syntax and output redirects all fail closed.
 *
 * Mirrors ZCode's `isRuntimeReadOnlyBashCommand`: the verdict downgrades a
 * permission category — it never bypasses the evaluator's guards.
 */

import { analyzeBashCommand, type BashAnalysis } from './analyze.js';
import { evaluateReadonlyPolicy, executableName, type ReadonlyVerdict } from './policies.js';

export type { BashAnalysis, BashInvocation } from './analyze.js';
export { analyzeBashCommand } from './analyze.js';
export { evaluateReadonlyPolicy } from './policies.js';

export interface ReadonlyClassification {
  readOnly: boolean;
  /** Why the command is not provably read-only (absent when readOnly). */
  reason?: string;
}

const DIRECTORY_CHANGE_COMMANDS = new Set(['cd', 'pushd', 'popd']);

export function classifyReadonlyBashCommand(command: string): ReadonlyClassification {
  const analysis: BashAnalysis = analyzeBashCommand(command);
  if (!analysis.ok) return { readOnly: false, reason: analysis.reason };

  const names = analysis.invocations.map(inv => executableName(inv.argv[0] ?? ''));
  // git resolves hooks/config from its cwd; a `cd` in the same line means the
  // argv-level verdict for `git` no longer describes where it will run.
  if (names.includes('git') && names.some(name => DIRECTORY_CHANGE_COMMANDS.has(name))) {
    return { readOnly: false, reason: 'git combined with directory change' };
  }

  for (const invocation of analysis.invocations) {
    const verdict: ReadonlyVerdict = evaluateReadonlyPolicy(invocation);
    if (verdict !== true) {
      return {
        readOnly: false,
        reason:
          verdict === false
            ? `writes or unsafe: ${invocation.text}`
            : `unknown command: ${invocation.text}`,
      };
    }
  }
  return { readOnly: true };
}

export function isProvablyReadOnlyBashCommand(command: string): boolean {
  return classifyReadonlyBashCommand(command).readOnly;
}

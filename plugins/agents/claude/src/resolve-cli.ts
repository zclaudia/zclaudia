import { spawnSync } from 'child_process';
import { resolveExecutableFromPath, type ResolveExecutableOptions } from '@zclaudia/agent-common';
import { evaluateClaudeCliVersion, type ClaudeCliCompatibilityResult } from './compatibility.js';

export type ResolveClaudeCliOptions = ResolveExecutableOptions;

/**
 * Locate a `claude` executable on the given PATH string, mimicking how a shell
 * would resolve the command: scan directories in order and return the first
 * matching executable. Returns undefined when none is found; the runtime must
 * then report that the host CLI is required.
 */
export function resolveClaudeCliFromPath(
  pathEnv: string | undefined,
  options: ResolveClaudeCliOptions = {}
): string | undefined {
  return resolveExecutableFromPath('claude', pathEnv, options);
}

interface VersionCommandResult {
  error?: Error;
  status: number | null;
  stderr?: string | Buffer;
  stdout?: string | Buffer;
}

export interface InspectClaudeCliOptions {
  env?: NodeJS.ProcessEnv;
  run?: (executable: string, args: string[]) => VersionCommandResult;
}

const compatibilityCache = new Map<string, ClaudeCliCompatibilityResult>();

export function parseClaudeCliVersion(output: string): string | undefined {
  return /(?:^|\s)(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?=\s|$)/.exec(output)?.[1];
}

export function inspectClaudeCli(
  executable: string,
  options: InspectClaudeCliOptions = {}
): ClaudeCliCompatibilityResult {
  if (!options.run) {
    const cached = compatibilityCache.get(executable);
    if (cached) return cached;
  }
  const result = options.run
    ? options.run(executable, ['--version'])
    : spawnSync(executable, ['--version'], {
        encoding: 'utf8',
        env: options.env ?? process.env,
        timeout: 5_000,
      });
  if (result.error) {
    throw new Error(`Unable to run Claude Code CLI at ${executable}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = String(result.stderr ?? result.stdout ?? '').trim();
    throw new Error(
      `Unable to read the Claude Code CLI version at ${executable}${details ? `: ${details}` : '.'}`
    );
  }
  const version = parseClaudeCliVersion(
    `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`
  );
  if (!version) {
    throw new Error(`Claude Code CLI at ${executable} returned an unrecognized version.`);
  }
  const compatibility = evaluateClaudeCliVersion(version);
  if (!options.run) compatibilityCache.set(executable, compatibility);
  return compatibility;
}

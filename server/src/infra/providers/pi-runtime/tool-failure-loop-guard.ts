import { generateToolSignature } from '../../../loop-detection.js';
import type { BashOutputDiagnostic } from './bash-output.js';

export const TOOL_FAILURE_HARD_LIMIT = 3;

type ToolFailureDetails = Record<string, unknown> | undefined;

export interface ToolFailureLoopAttempt {
  attempts: number;
  signature: string;
  kind: 'generic' | 'bash_failure';
}

/**
 * Per-run backstop that counts consecutive identical tool FAILURES across all
 * tools, keyed by `generateToolSignature` (the same normalization run-events
 * uses for loop detection). Generalizes NoopEditGuard, which stays in place for
 * Edit's hashline-specific signatures; this guard catches the long tail (Bash
 * retrying the same broken command, LSP/Grep hammering the same bad query).
 *
 * A successful call with the same signature clears its counter. Lives in the
 * buildAgentHooks closure → one instance per run.
 */
export class ToolFailureLoopGuard {
  private readonly counts = new Map<string, number>();

  recordFailure(toolName: string, args: Record<string, unknown> | undefined, details?: ToolFailureDetails): number {
    return this.recordFailureWithResult(toolName, args, details).attempts;
  }

  recordFailureWithResult(
    toolName: string,
    args: Record<string, unknown> | undefined,
    details?: ToolFailureDetails,
  ): ToolFailureLoopAttempt {
    const kind = isBash(toolName) ? 'bash_failure' : 'generic';
    const sig = kind === 'bash_failure'
      ? bashFailureSignature(args, details)
      : generateToolSignature(toolName, args);
    const next = (this.counts.get(sig) ?? 0) + 1;
    this.counts.set(sig, next);
    return { attempts: next, signature: sig, kind };
  }

  recordSuccess(toolName: string, args: Record<string, unknown> | undefined): void {
    const base = isBash(toolName)
      ? bashInputSignature(args)
      : generateToolSignature(toolName, args);
    for (const key of this.counts.keys()) {
      if (key === base || key.startsWith(`${base}|`)) {
        this.counts.delete(key);
      }
    }
  }
}

function isBash(toolName: string): boolean {
  return ['bash', 'execute_command', 'run_terminal_cmd', 'terminal', 'shell'].includes(toolName.toLowerCase());
}

function pickString(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = input?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function bashInputSignature(args: Record<string, unknown> | undefined): string {
  const command = pickString(args, 'command') ?? pickString(args, 'cmd') ?? pickString(args, 'commandLine') ?? '';
  const cwd = pickString(args, 'cwd');
  const normalizedCommand = normalizeText(command);
  return `Bash:${normalizedCommand || '<missing>'}${cwd ? `@${normalizeText(cwd)}` : ''}`;
}

function diagnosticFingerprint(diagnostic: BashOutputDiagnostic): string {
  const location = [
    diagnostic.path,
    diagnostic.line ?? '',
    diagnostic.column ?? '',
  ].join(':');
  const source = diagnostic.source ?? '';
  return [
    location,
    diagnostic.severity,
    source,
    normalizeText(diagnostic.message).slice(0, 200),
  ].join('|');
}

function bashFailureSignature(args: Record<string, unknown> | undefined, details: ToolFailureDetails): string {
  const base = bashInputSignature(args);
  const diagnostics = Array.isArray(details?.diagnostics)
    ? (details.diagnostics as BashOutputDiagnostic[]).slice(0, 10).map(diagnosticFingerprint)
    : [];
  const failedTests = Array.isArray(details?.failedTests)
    ? (details.failedTests as unknown[])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, 10)
      .map(value => normalizeText(value).slice(0, 200))
    : [];

  const parts: string[] = [];
  if (typeof details?.exitCode === 'number') parts.push(`exit=${details.exitCode}`);
  if (details?.timedOut === true) parts.push('timedOut=true');
  if (details?.sandboxFsDenied) parts.push(`sandboxFsDenied=${String(details.sandboxFsDenied)}`);
  if (typeof details?.error === 'string') parts.push(`error=${details.error}`);
  if (diagnostics.length) parts.push(`diagnostics=${diagnostics.join(';;')}`);
  if (failedTests.length) parts.push(`failedTests=${failedTests.join(';;')}`);
  return `${base}|failure:${parts.length ? parts.join(';') : 'failed'}`;
}

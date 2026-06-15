import { generateToolSignature } from '../../../loop-detection.js';

export const TOOL_FAILURE_HARD_LIMIT = 3;

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

  recordFailure(toolName: string, args: Record<string, unknown> | undefined): number {
    const sig = generateToolSignature(toolName, args);
    const next = (this.counts.get(sig) ?? 0) + 1;
    this.counts.set(sig, next);
    return next;
  }

  recordSuccess(toolName: string, args: Record<string, unknown> | undefined): void {
    this.counts.delete(generateToolSignature(toolName, args));
  }
}

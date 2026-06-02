import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import type { ExecutionEnv, Result } from '@earendil-works/pi-agent-core';

/**
 * Create a Node-backed ExecutionEnv bound to a working directory.
 *
 * Design rule (execution-env-adapter spec):
 * - Runtime / per-session usage → cwd = session.project.cwd
 *   (NOT wired here; deferred to skills-full-pi / command-templates)
 * - Process-wide scanners (skills, commands) → cwd = process.cwd()
 *   (Scanners pass absolute paths; cwd is a placeholder)
 *
 * Caller owns the lifecycle. NodeExecutionEnv holds no fds / handles for
 * FS-only usage, so leaking an instance does not leak resources, but
 * cleanup() should be called when the env is known to be done.
 */
export function createExecutionEnv(cwd: string): ExecutionEnv {
  return new NodeExecutionEnv({ cwd });
}

/**
 * Unwrap a pi Result, throwing the wrapped error if not ok.
 *
 * For callers that need to branch on `error.code`, use `if (!r.ok)` directly.
 */
export function unwrapResult<T, E extends Error>(result: Result<T, E>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

export type { ExecutionEnv };

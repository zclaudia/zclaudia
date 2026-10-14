import type { Response } from 'express';
import type { ApiResponse } from '@zclaudia/shared/core/api';

/**
 * Shared error → HTTP mapping for route modules (supervision, workflows, …).
 *
 * Domain services declare transport semantics by throwing errors that carry a
 * numeric `status` and a string `code` (see `PluginPackageError`,
 * `SupervisorError`, `WorkflowGenerationError`); such errors are mapped
 * verbatim, so services can evolve their messages without silently changing
 * HTTP behavior. Plain errors — legacy throw sites and test doubles — fall
 * back to the route's declared message-shape rules and fallback, reproducing
 * the exact response the original inline handlers produced.
 *
 * Lives in utils (lowest layer) so domain route modules can use it without
 * importing the interfaces layer; re-export from interfaces/http if needed.
 */

/** Transport semantics carried by typed domain errors. */
export interface RouteErrorInfo {
  status: number;
  code: string;
}

/** True when the error explicitly declares its HTTP status and API error code. */
export function isRouteHttpError(error: unknown): error is Error & RouteErrorInfo {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & Partial<RouteErrorInfo>;
  return typeof candidate.status === 'number' && typeof candidate.code === 'string';
}

/** One legacy message-shape rule, matched against the error message in order. */
export interface RouteErrorRule {
  match: string | RegExp;
  status: number;
  code: string;
}

export interface RouteErrorPolicy {
  /** Ordered message-shape rules for plain (untyped) errors; first hit wins. */
  rules?: readonly RouteErrorRule[];
  /** Response used when no rule matches. */
  fallback: RouteErrorInfo;
  /** Message used when the thrown value is not an Error instance. */
  nonErrorMessage?: string;
  /** When set, used verbatim instead of the error message. */
  fixedMessage?: string;
}

export function sendRouteError(res: Response, error: unknown, policy: RouteErrorPolicy): void {
  const message =
    policy.fixedMessage ??
    (error instanceof Error ? error.message : (policy.nonErrorMessage ?? String(error)));

  let info: RouteErrorInfo;
  if (isRouteHttpError(error)) {
    info = { status: error.status, code: error.code };
  } else {
    const matched = policy.rules?.find(rule =>
      typeof rule.match === 'string' ? message.includes(rule.match) : rule.match.test(message)
    );
    info = matched ? { status: matched.status, code: matched.code } : policy.fallback;
  }

  res.status(info.status).json({
    success: false,
    error: { code: info.code, message },
  } as ApiResponse<never>);
}

import type { RequestHandler } from 'express';

export const RUNTIME_INITIALIZING_ERROR = {
  code: 'RUNTIMES_INITIALIZING',
  message: 'Agent runtimes are initializing. Retry after startup completes.',
} as const;

const RUNTIME_API =
  /^\/api\/(?:agent|commands|providers|delegation|workflow-step-types|workflow-trigger-sources|agent-profiles|agent-runtimes|managed-runtimes|plugins|projects|sessions|workflows|workflow-runs|workflow-step-runs|automations|claudia)(?:\/|$)/i;

/** Prevent queries and mutations from observing a partially registered catalog. */
export function createRuntimeInitializationMiddleware(isReady: () => boolean): RequestHandler {
  return (req, res, next) => {
    if (isReady() || !RUNTIME_API.test(req.path)) {
      next();
      return;
    }
    res.setHeader('Retry-After', '1');
    res.status(503).json({ success: false, error: RUNTIME_INITIALIZING_ERROR });
  };
}

import type { Response } from 'express';

/**
 * HTTP API error response helper. Lives in utils (lowest layer) so domain
 * and application route modules can use it without importing the
 * interfaces layer; interfaces/http/response.ts re-exports it.
 */
export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  res.status(status).json({
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
  });
}

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Middleware } from './base.js';
import { errorResponse } from './base.js';

/**
 * Authentication middleware
 *
 * Verifies that the client is authenticated before allowing the request to proceed.
 * Local clients (connected directly to the server) are automatically allowed.
 * Remote clients must be authenticated (e.g., via gateway).
 *
 * Benefits:
 * - Single source of truth for authentication check
 * - Eliminates the 9 duplicated auth checks across handlers
 * - Consistent error responses for unauthorized requests
 * - Easy to modify auth logic in one place
 *
 * Example usage:
 * ```typescript
 * router.use(authMiddleware);  // Apply to all routes
 * // OR
 * router.crud('projects', repo, { middleware: [authMiddleware] });  // Apply to specific routes
 * ```
 */
export const authMiddleware: Middleware = async (ctx, next) => {
  const client = ctx.client;

  // Local clients are always allowed (direct WebSocket connection)
  if (client?.isLocal) {
    return next(ctx);
  }

  // Remote clients must be authenticated
  if (!client?.authenticated) {
    return errorResponse(
      ctx.request,
      'UNAUTHORIZED',
      'Authentication required. Please provide a valid API key.'
    );
  }

  // Client is authenticated, proceed to next middleware/handler
  return next(ctx);
};

/**
 * Optional authentication middleware
 *
 * Similar to authMiddleware, but allows unauthenticated requests to proceed.
 * Useful for endpoints that have optional authentication (e.g., read-only operations
 * that work better with auth but don't require it).
 *
 * The handler can check ctx.client.authenticated to determine if the client is authenticated.
 */
export const optionalAuthMiddleware: Middleware = async (ctx, next) => {
  // Always allow the request to proceed
  // Handlers can check ctx.client.authenticated if needed
  return next(ctx);
};

/**
 * Trusted-host WebSocket upgrade guard (one-time capability ticket).
 *
 * Guards the `/ws/host` upgrade path: the desktop host first issues a
 * one-time, short-lived capability over HTTP (POST /api/host-capability),
 * then presents it as a header when connecting. The server consumes the
 * ticket on upgrade — consume invalidates it immediately, so replays fail
 * and no client can promote itself to trusted host by header alone.
 *
 * Ported from ZCode packages/server/src/http.ts (/ws/host middleware),
 * Apache-2.0, Copyright 2026 Z.AI Co., Ltd. Adapted to this repo's
 * middleware style: the consume step and header name are injected (the
 * interfaces layer may not import the root composition layer), so the
 * composition root passes `hostCapabilityStore.consume` and
 * `HOST_CAPABILITY_HEADER`.
 *
 * Example usage (in the server upgrade handler):
 * ```typescript
 * const guard = createHostCapabilityUpgradeGuard(
 *   hostCapabilities.consume,
 *   HOST_CAPABILITY_HEADER
 * );
 * if (!guard(req)) rejectUpgrade(socket, 401, 'Invalid or expired host capability');
 * ```
 */
export function createHostCapabilityUpgradeGuard(
  consume: (capability: string | undefined) => boolean,
  headerName: string
): (req: IncomingMessage) => boolean {
  return (req: IncomingMessage): boolean => {
    const header = req.headers[headerName.toLowerCase()];
    const capability = Array.isArray(header) ? header[0] : header;
    return consume(capability);
  };
}

/**
 * Reject an HTTP upgrade request with a plain HTTP error response.
 *
 * The raw `server.on('upgrade')` handler has no Express `res`, so the
 * rejection is written onto the socket directly (mirrors how the runtime-
 * initialization gate answers 503 on this path).
 */
export function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const reason = status === 401 ? 'Unauthorized' : 'Forbidden';
  const body = JSON.stringify({ success: false, error: { code: String(status), message } });
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n` +
      `\r\n` +
      body
  );
}

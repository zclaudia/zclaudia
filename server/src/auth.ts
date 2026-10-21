import crypto from 'crypto';
import { randomBytes } from 'node:crypto';

// Portions of this file are Copyright 2026 Z.AI Co., Ltd. — adapted from
// ZCode packages/server/src/hostCapability.ts (Apache-2.0).
// Modified by zclaudia: header constant renamed for this repo; the store is
// wired into the `/ws/host` upgrade path via
// interfaces/http/middleware/auth.ts (createHostCapabilityUpgradeGuard).

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Used by gateway HTTP proxy auth and REST API middleware.
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time even on length mismatch
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// One-time host capability tickets (ported from ZCode hostCapability.ts)
// ---------------------------------------------------------------------------

/** Request header carrying the one-time capability on the trusted WS upgrade. */
export const HOST_CAPABILITY_HEADER = 'x-zclaudia-host-capability';

export const DEFAULT_HOST_CAPABILITY_TTL_MS = 30_000;

export interface HostCapability {
  capability: string;
  expiresAt: number;
}

export interface HostCapabilityStoreOptions {
  ttlMs?: number;
  now?: () => number;
  createCapability?: () => string;
}

export interface HostCapabilityStore {
  issue(): HostCapability;
  consume(capability: string | undefined): boolean;
}

/**
 * Short-lived, one-time desktop host capability; exists only in the HTTP
 * server process's memory. The desktop host first issues a capability over
 * HTTP, then presents it as a header when connecting to the trusted WS path
 * (`/ws/host`). Consuming invalidates the ticket immediately — whether the
 * consume succeeded, expired, or was a replay — so a leaked ticket cannot be
 * replayed and no client can promote itself to trusted host by header alone.
 */
export function createHostCapabilityStore(
  options: HostCapabilityStoreOptions = {}
): HostCapabilityStore {
  const ttlMs = options.ttlMs ?? DEFAULT_HOST_CAPABILITY_TTL_MS;
  const now = options.now ?? Date.now;
  const createCapability =
    options.createCapability ?? (() => randomBytes(32).toString('base64url'));
  const expiresByCapability = new Map<string, number>();

  const purgeExpired = (at: number): void => {
    for (const [capability, expiresAt] of expiresByCapability) {
      if (expiresAt <= at) expiresByCapability.delete(capability);
    }
  };

  return {
    issue() {
      const issuedAt = now();
      purgeExpired(issuedAt);
      const capability = createCapability();
      const expiresAt = issuedAt + ttlMs;
      expiresByCapability.set(capability, expiresAt);
      return { capability, expiresAt };
    },
    consume(capability) {
      if (!capability) return false;
      const consumedAt = now();
      const expiresAt = expiresByCapability.get(capability);
      // The legacy mode header is a replayable long-lived privilege claim.
      // A ticket is deleted on every consume — success, expiry, or replay
      // alike — so only the first consume within the TTL earns the
      // trusted-host role.
      expiresByCapability.delete(capability);
      purgeExpired(consumedAt);
      return expiresAt !== undefined && expiresAt > consumedAt;
    },
  };
}

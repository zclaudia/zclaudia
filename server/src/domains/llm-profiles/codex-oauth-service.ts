import { Mutex } from 'async-mutex';
import type { LlmProfileConfig, CodexOAuthCredentials } from '@zclaudia/shared/core/llm-profile';
import { CodexOAuthError } from './codex-oauth-errors.js';
import {
  codexOAuth,
  expiresSoon,
  toCodexCredentials,
  toOAuthCredential,
} from './codex-oauth-pi.js';

export interface OAuthCredentialsWriter {
  updateOAuthCredentials(
    profileId: string,
    creds: CodexOAuthCredentials | null
  ): Promise<void> | void;
}

/**
 * Per-profile single-flight state. The mutex guards the "check-and-set" of
 * `inFlight` so only one caller ever starts a pi-ai request per profile at a
 * time. Callers that arrive while a flight is active share its Promise.
 */
interface FlightEntry {
  mutex: Mutex;
  inFlight: Promise<CodexOAuthCredentials> | null;
}

const flights = new Map<string, FlightEntry>();

export function _resetCodexOAuthLocksForTest(): void {
  flights.clear();
}

function getEntry(profileId: string): FlightEntry {
  let entry = flights.get(profileId);
  if (!entry) {
    entry = { mutex: new Mutex(), inFlight: null };
    flights.set(profileId, entry);
  }
  return entry;
}

/** Ceiling on a single refresh exchange; pi's own refresh takes no deadline. */
const REFRESH_TIMEOUT_MS = 30_000;

const TERMINAL_PATTERNS = [
  /refresh_token_expired/i,
  /refresh_token_invalidated/i,
  /refresh_token_reused/i,
  /invalid_grant/i,
];

function classifyRefreshError(err: unknown): 'TERMINAL' | 'TRANSIENT' {
  const msg = err instanceof Error ? err.message : String(err);
  return TERMINAL_PATTERNS.some(re => re.test(msg)) ? 'TERMINAL' : 'TRANSIENT';
}

function startFlight(
  profile: LlmProfileConfig,
  entry: FlightEntry,
  writer: OAuthCredentialsWriter
): Promise<CodexOAuthCredentials> {
  const promise = (async (): Promise<CodexOAuthCredentials> => {
    try {
      const current = profile.oauthCredentials;
      if (!current) {
        throw new CodexOAuthError(
          'NOT_AUTHENTICATED',
          'NOT_AUTHENTICATED: OAuth credentials missing for openai-codex'
        );
      }
      // pi 0.84 dropped `getOAuthApiKey`, which decided for itself whether a
      // token was close enough to expiry to rotate. `OAuthAuth.refresh` always
      // performs the exchange, so the expiry check is ours to make now.
      if (!expiresSoon(current.expires)) return current;

      const rotated = await codexOAuth().refresh(
        toOAuthCredential(current),
        AbortSignal.timeout(REFRESH_TIMEOUT_MS)
      );
      const fresh = toCodexCredentials(rotated);
      await writer.updateOAuthCredentials(profile.id, fresh);
      return fresh;
    } catch (err) {
      if (err instanceof CodexOAuthError) throw err;
      const cls = classifyRefreshError(err);
      if (cls === 'TERMINAL') {
        await writer.updateOAuthCredentials(profile.id, null);
        throw new CodexOAuthError(
          'REFRESH_FAILED_TERMINAL',
          err instanceof Error ? err.message : 'Refresh failed (terminal)'
        );
      }
      throw new CodexOAuthError(
        'REFRESH_FAILED_TRANSIENT',
        err instanceof Error ? err.message : 'Refresh failed (transient)'
      );
    } finally {
      entry.inFlight = null;
    }
  })();

  entry.inFlight = promise;
  return promise;
}

/**
 * Resolve a fresh access token for a `providerType: openai-codex` profile.
 * Uses pi-ai's `getOAuthApiKey` which transparently refreshes when near expiry.
 *
 * - Concurrent callers per profile.id are coalesced (single-flight): only the
 *   first caller actually invokes pi-ai; the rest await the same Promise.
 * - Rotated credentials are persisted via the writer.
 * - Terminal errors (refresh_token_*, invalid_grant) clear stored credentials.
 * - Transient errors (network) bubble up without touching DB.
 */
export async function refreshIfNeeded(
  profile: LlmProfileConfig,
  writer: OAuthCredentialsWriter
): Promise<CodexOAuthCredentials> {
  if (!profile.oauthCredentials) {
    throw new CodexOAuthError(
      'NOT_AUTHENTICATED',
      'NOT_AUTHENTICATED: Codex profile is not authenticated'
    );
  }

  const entry = getEntry(profile.id);

  // Fast path: join an already-running flight without touching the mutex.
  if (entry.inFlight) {
    return entry.inFlight;
  }

  // Slow path: acquire mutex briefly to do a check-and-set of inFlight.
  // The mutex is released immediately after setting inFlight, NOT after the
  // pi-ai call completes — that is what enables the single-flight coalescing.
  let flight: Promise<CodexOAuthCredentials> | undefined;
  await entry.mutex.runExclusive(() => {
    if (entry.inFlight) {
      flight = entry.inFlight;
    } else {
      flight = startFlight(profile, entry, writer);
    }
  });

  if (!flight) {
    throw new CodexOAuthError('REFRESH_FAILED_TRANSIENT', 'Failed to start OAuth refresh request');
  }
  return flight;
}

import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import type { OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import type { CodexOAuthCredentials } from '@zclaudia/shared/core/llm-profile';

/**
 * The one place that touches pi-ai's Codex OAuth implementation.
 *
 * pi 0.84 removed the standalone `pi-ai/oauth` entry points (`loginOpenAICodex`,
 * `loginOpenAICodexDeviceCode`, `getOAuthApiKey`) — that subpath is now types
 * only. Login and refresh live on the provider as an `OAuthAuth`, which expects
 * an interactive caller: one `login(interaction)` that asks the user to pick a
 * method through `prompt()` and reports progress through `notify()`.
 *
 * We drive that contract from an HTTP flow instead of a terminal, so the method
 * is decided by which endpoint was called rather than by asking. See
 * `codex-oauth-session.ts` for the scripted interaction.
 */

/** Option ids `openaiCodexOAuth.login` accepts for its method `select` prompt. */
export const CODEX_LOGIN_METHOD = {
  browser: 'browser',
  deviceCode: 'device_code',
} as const;

export type CodexLoginMethod = (typeof CODEX_LOGIN_METHOD)[keyof typeof CODEX_LOGIN_METHOD];

/**
 * Refresh margin. pi's own `Models.getAuth()` treats a credential as expiring
 * soon five minutes ahead; we resolve tokens ourselves, so we reproduce it here
 * rather than inherit it.
 */
export const CODEX_REFRESH_MARGIN_MS = 5 * 60 * 1000;

let cached: OAuthAuth | undefined;

/** The provider's OAuth implementation (login / refresh / toAuth). */
export function codexOAuth(): OAuthAuth {
  if (!cached) {
    const oauth = openaiCodexProvider().auth.oauth;
    if (!oauth) {
      throw new Error('pi-ai openai-codex provider no longer exposes OAuth auth');
    }
    cached = oauth;
  }
  return cached;
}

export function _resetCodexOAuthProviderForTest(): void {
  cached = undefined;
}

/** True when the token is expired or close enough to it to be worth rotating. */
export function expiresSoon(expires: number, now = Date.now()): boolean {
  return now + CODEX_REFRESH_MARGIN_MS >= expires;
}

/**
 * pi returns `{ type: 'oauth', access, refresh, expires, accountId }`; we store
 * the four fields without the tag. `accountId` is not part of pi's
 * `OAuthCredential`, but the Codex implementation always sets it (it fails the
 * login outright when the JWT carries no `chatgpt_account_id`), so a missing or
 * non-string value means the shape changed under us and is worth failing on.
 */
export function toCodexCredentials(credential: OAuthCredential): CodexOAuthCredentials {
  const accountId = (credential as { accountId?: unknown }).accountId;
  if (
    typeof credential.access !== 'string' ||
    typeof credential.refresh !== 'string' ||
    typeof credential.expires !== 'number' ||
    typeof accountId !== 'string' ||
    accountId.length === 0
  ) {
    throw new Error('pi-ai returned credentials without expected fields (accountId missing)');
  }
  return {
    access: credential.access,
    refresh: credential.refresh,
    expires: credential.expires,
    accountId,
  };
}

/** Re-tag our stored credentials for the pi-ai calls that expect a credential. */
export function toOAuthCredential(creds: CodexOAuthCredentials): OAuthCredential {
  return { type: 'oauth', ...creds };
}

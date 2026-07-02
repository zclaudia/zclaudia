import { useMemo } from 'react';
import type { LlmProfileConfig } from '@zclaudia/shared';

interface Props {
  profile: LlmProfileConfig;
  isCurrentLocalServer: boolean;
  isTauri: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  inFlight: boolean;
}

function maskAccountId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 10)}…`;
}

function formatExpiry(expiresMs: number): string {
  const remainMs = expiresMs - Date.now();
  if (remainMs <= 0) return 'expired';
  const m = Math.round(remainMs / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

export function CodexOAuthCard({
  profile,
  isCurrentLocalServer,
  onSignIn,
  onSignOut,
  inFlight,
}: Props) {
  const status = useMemo(() => {
    if (!profile.oauthCredentials) return 'not_authenticated' as const;
    if (profile.oauthCredentials.expires <= Date.now()) return 'needs_reauth' as const;
    return 'authenticated' as const;
  }, [profile.oauthCredentials]);

  const flowHint = isCurrentLocalServer
    ? 'Sign in using this machine’s browser'
    : 'Sign in with the device code flow (enter the code at auth.openai.com/codex/device)';

  if (status === 'not_authenticated') {
    return (
      <div className="rounded-lg border border-border bg-secondary/50 p-4">
        <div className="mb-2 text-sm text-muted-foreground">Not signed in to ChatGPT</div>
        <button
          type="button"
          onClick={onSignIn}
          disabled={inFlight}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {inFlight ? 'Signing in…' : 'Sign in with ChatGPT'}
        </button>
        <div className="mt-2 text-xs text-muted-foreground">{flowHint}</div>
      </div>
    );
  }

  if (status === 'needs_reauth') {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="mb-2 text-sm text-destructive">
          Credentials expired. Please sign in again.
        </div>
        <button
          type="button"
          onClick={onSignIn}
          disabled={inFlight}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {inFlight ? 'Signing in…' : 'Sign in again'}
        </button>
      </div>
    );
  }

  const creds = profile.oauthCredentials!;
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="text-sm text-emerald-700 dark:text-emerald-400">
        Signed in as <code className="font-mono text-xs">{maskAccountId(creds.accountId)}</code>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Token expires in {formatExpiry(creds.expires)}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSignIn}
          disabled={inFlight}
          className="rounded-lg border border-emerald-500/50 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-400"
        >
          Sign in again
        </button>
        <button
          type="button"
          onClick={onSignOut}
          disabled={inFlight}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

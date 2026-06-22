import { useEffect, useState } from 'react';
import {
  startCodexOAuth,
  pollCodexOAuthStatus,
  cancelCodexOAuth,
  type CodexOAuthStartResult,
} from '../../services/api/llm-profiles';

interface Props {
  profileId: string;
  method: 'browser' | 'device_code';
  isTauri: boolean;
  onClose: () => void;
  onSuccess: (accountId: string) => void;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 600; // ~20min

export function CodexOAuthLoginModal({ profileId, method, isTauri, onClose, onSuccess }: Props) {
  const [session, setSession] = useState<CodexOAuthStartResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await startCodexOAuth(profileId, method);
        if (cancelled) return;
        setSession(result);
        if (result.method === 'browser' && isTauri) {
          const { open } = await import('@tauri-apps/plugin-shell');
          await open(result.authUrl);
        }
        setPolling(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'OAuth failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, method, isTauri]);

  useEffect(() => {
    if (!polling || !session) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let count = 0;
    const tick = async () => {
      count += 1;
      try {
        const status = await pollCodexOAuthStatus(profileId, session.sessionId);
        if (status.state === 'success') {
          setPolling(false);
          onSuccess(status.accountId);
          return;
        }
        if (status.state === 'error') {
          setPolling(false);
          setError(status.message);
          return;
        }
        if (status.state === 'cancelled') {
          setPolling(false);
          setError('Login cancelled');
          return;
        }
        if (count >= MAX_POLLS) {
          setPolling(false);
          setError('Login timed out');
          return;
        }
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      } catch (err) {
        setPolling(false);
        setError(err instanceof Error ? err.message : 'Poll failed');
      }
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [polling, session, profileId, onSuccess]);

  const handleCancel = async () => {
    if (session) {
      try {
        await cancelCodexOAuth(profileId, session.sessionId);
      } catch {
        // ignore
      }
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2 className="mb-3 text-lg font-medium">Sign in with ChatGPT</h2>

        {!session && !error && <div className="text-sm text-muted-foreground">Starting the OAuth flow…</div>}

        {session && session.method === 'browser' && (
          <div className="text-sm">
            <p>Waiting for the browser to finish signing in…</p>
            <p className="mt-2 text-xs text-muted-foreground">If the browser didn’t open automatically, visit this URL manually:</p>
            <code className="mt-1 block break-all rounded bg-secondary p-2 text-xs">{session.authUrl}</code>
          </div>
        )}

        {session && session.method === 'device_code' && (
          <div className="text-sm">
            <p className="mb-2">Click the button below to open the authorization page in your browser (the code is filled in automatically). Sign in to ChatGPT, then click Allow:</p>
            <a
              href={`${session.verificationUri}?user_code=${encodeURIComponent(session.userCode)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-emerald-700"
            >
              Open the authorization page in your browser ↗
            </a>
            <p className="mt-3 text-xs text-muted-foreground">If the code wasn’t filled in automatically, enter it manually:</p>
            <div className="mt-1 rounded bg-secondary p-3 text-center font-mono text-2xl tracking-widest">
              {session.userCode}
            </div>
            <p className="mt-2 text-xs text-muted-foreground break-all">
              Or visit: <a href={session.verificationUri} target="_blank" rel="noreferrer" className="underline">{session.verificationUri}</a>
            </p>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(session.userCode)}
              className="mt-2 text-xs text-emerald-600 underline dark:text-emerald-400"
            >
              Copy code
            </button>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

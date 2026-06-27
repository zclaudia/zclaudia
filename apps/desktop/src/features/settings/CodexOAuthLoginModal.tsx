import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 backdrop-blur">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        <h2 className="mb-3 text-lg font-medium">Sign in with ChatGPT</h2>

        {!session && !error && <div className="text-sm text-muted-foreground">Starting the OAuth flow…</div>}

        {session && session.method === 'browser' && (
          <div className="text-sm">
            <p>Open the authorization page to finish signing in with ChatGPT.</p>
            <a
              href={session.authUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-emerald-700"
            >
              Open authorization page
            </a>
            <p className="mt-2 text-xs text-muted-foreground">If the button doesn’t open, visit this URL manually:</p>
            <code className="mt-1 block break-all rounded bg-secondary p-2 text-xs">{session.authUrl}</code>
          </div>
        )}

        {session && session.method === 'device_code' && (
          <div className="text-sm">
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Device code authorization must be enabled for Codex.</p>
              <p className="mt-1">
                If OpenAI blocks this page, enable device code login in ChatGPT security settings,
                or ask your workspace admin to enable it, then retry.
              </p>
              <a
                href="https://developers.openai.com/codex/auth#preferred-device-code-authentication-beta"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-emerald-600 underline dark:text-emerald-400"
              >
                View OpenAI authentication docs
              </a>
            </div>
            <p className="mb-2">Open the authorization page, then enter this code when prompted. Sign in to ChatGPT, then click Allow:</p>
            <a
              href={session.verificationUri}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-emerald-700"
            >
              Open authorization page
            </a>
            <p className="mt-3 text-xs text-muted-foreground">Enter this code on the authorization page:</p>
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
          <div className="mt-3 max-h-40 overflow-auto break-words rounded border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
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
    </div>,
    document.body,
  );
}
